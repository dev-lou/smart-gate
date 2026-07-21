"""
Smart School Gate System - Main Application
=============================================
Entry point for the Raspberry Pi gate controller.
Runs the continuous access control loop with face recognition,
uniform detection, fingerprint, and RFID verification.
"""

import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime
from typing import List, Tuple

import config
import cv2
from database import GateDatabase
from face_utils import FaceRecognizer
from fingerprint_utils import FingerprintSensor
from gate_controller import GateController
from rfid_utils import RFIDReader
from sync_client import SyncClient
from uniform_utils import UniformDetector

# ============================================================
# Logging Setup
# ============================================================
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(config.LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("SmartGate")


class SmartGateSystem:
    """Main application orchestrator for the smart gate system."""

    def __init__(self) -> None:
        """Initialize all subsystems."""
        logger.info("=" * 60)
        logger.info("  Smart School Gate System - Starting Up")
        logger.info(f"  School: {config.SCHOOL_NAME}")
        logger.info(f"  Simulation Mode: {config.SIMULATION_MODE}")
        logger.info("=" * 60)

        # Initialize subsystems
        self.db = GateDatabase()
        self.face_recognizer = FaceRecognizer()
        self.uniform_detector = UniformDetector()
        self.fingerprint_sensor = FingerprintSensor()
        self.rfid_reader = RFIDReader()
        self.gate = GateController()
        self.sync_client = SyncClient(self.db)

        # State
        self.running: bool = False
        self.camera = None
        self.sync_thread: threading.Thread = None
        self.sync_button_thread: threading.Thread = None
        self.frame_count: int = 0
        self.last_sync_time: float = time.time()

        # Load known faces from database
        self._load_face_data()

        logger.info("All subsystems initialized successfully.")

    def _load_face_data(self) -> None:
        """Load enrolled person face encodings from the local database."""
        people = self.db.get_all_active_people()
        count = self.face_recognizer.load_known_faces(people)
        logger.info(
            f"Loaded {count} face encodings from {len(people)} active enrolled people."
        )

    def _init_camera(self) -> bool:
        """Initialize the camera."""
        try:
            source = (
                config.CAMERA_SOURCE.strip() if hasattr(config, "CAMERA_SOURCE") else ""
            )
            if source:
                self.camera = cv2.VideoCapture(source)
                source_desc = source
            else:
                self.camera = cv2.VideoCapture(config.CAMERA_INDEX)
                source_desc = f"index={config.CAMERA_INDEX}"

            if not self.camera.isOpened():
                logger.error("Failed to open camera!")
                return False
            # Set camera resolution
            self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            logger.info(f"Camera initialized ({source_desc})")
            return True
        except Exception as e:
            logger.error(f"Camera initialization failed: {e}")
            return False

    def _display_name_for_person(self, person: dict, fallback_name: str) -> str:
        """Return display name with role-aware prefix for speech/UI logs."""
        person_type = (
            str(person.get("person_type", "student")).lower() if person else "student"
        )
        if person_type == "faculty":
            return f"Faculty {fallback_name}"
        if person_type == "staff":
            return f"Staff {fallback_name}"
        return fallback_name

    def _collect_expected_uniform_ref_keys(self) -> List[str]:
        """Resolve expected uniform reference keys from local settings."""
        import json

        keys: List[str] = []
        raw_list = self.db.get_setting("uniform_ref_list", "").strip()
        if raw_list:
            try:
                parsed = json.loads(raw_list)
                if isinstance(parsed, list):
                    keys.extend([str(k).strip() for k in parsed if str(k).strip()])
            except json.JSONDecodeError:
                logger.warning("Invalid JSON in local setting 'uniform_ref_list'.")

        if not keys:
            try:
                cursor = self.db.conn.cursor()
                cursor.execute(
                    """
                    SELECT key FROM system_settings
                    WHERE key LIKE 'uniform_ref_%'
                      AND key NOT LIKE 'uniform_ref_name_%'
                      AND key <> 'uniform_ref_list'
                    ORDER BY key ASC
                    """
                )
                keys = [str(row[0]) for row in cursor.fetchall()]
            except Exception as e:
                logger.warning(f"Unable to query uniform reference keys: {e}")

        # Unique, deterministic order
        return sorted(list({k for k in keys if k}))

    def _run_startup_preflight(self) -> bool:
        """Run deployment preflight checks before opening the gate loop."""
        logger.info("Running startup preflight checks...")
        failures: List[str] = []
        warnings: List[str] = []

        # 1) Database health
        try:
            cursor = self.db.conn.cursor()
            cursor.execute("SELECT 1")
        except Exception as e:
            failures.append(f"Database not ready: {e}")

        # 2) Enrollment availability
        try:
            active_people = self.db.get_all_active_people()
            if not active_people and not config.ALLOW_EMPTY_ENROLLMENT_STARTUP:
                failures.append("No active enrolled people in local cache.")
            elif not active_people:
                warnings.append("No active enrolled people in local cache.")
        except Exception as e:
            failures.append(f"Failed to read enrolled people from local database: {e}")

        # 3) Camera
        if not self._init_camera():
            failures.append("Camera initialization failed.")
        else:
            ret, _ = self.camera.read()
            if not ret:
                failures.append("Camera opened but frame capture failed.")

        # 4) Uniform reference cache integrity (only if enabled)
        if config.UNIFORM_DETECTION_ENABLED:
            ref_keys = self._collect_expected_uniform_ref_keys()
            if not ref_keys:
                warnings.append("No uniform reference keys found in local settings.")
            else:
                missing_files = []
                invalid_files = []
                for ref_key in ref_keys:
                    local_path = os.path.join(
                        os.path.dirname(__file__), "data", "uniforms", f"{ref_key}.jpg"
                    )
                    if not os.path.exists(local_path):
                        missing_files.append(ref_key)
                        continue

                    img = cv2.imread(local_path)
                    if img is None or img.size == 0:
                        invalid_files.append(ref_key)

                if missing_files:
                    warnings.append(
                        f"Missing local uniform refs: {', '.join(missing_files)}"
                    )
                if invalid_files:
                    warnings.append(
                        f"Invalid local uniform refs: {', '.join(invalid_files)}"
                    )

        # 5) Sensor readiness
        if not config.SIMULATION_MODE:
            if self.fingerprint_sensor.simulation:
                warnings.append(
                    "Fingerprint sensor unavailable; running in simulation fallback."
                )

            if config.RFID_ENABLED and self.rfid_reader.simulation:
                warnings.append(
                    "RFID reader unavailable; running in simulation fallback."
                )

        # 6) Cloud reachability (optional)
        if config.REQUIRE_CLOUD_ON_STARTUP:
            if not self.sync_client._is_online():
                failures.append("Cloud API not reachable at startup.")

        logger.info("Preflight summary:")
        if warnings:
            for item in warnings:
                logger.warning(f"  - {item}")
        if failures:
            for item in failures:
                logger.error(f"  - {item}")

        if failures:
            logger.error("Startup preflight FAILED.")
            return False

        if warnings and config.FAIL_ON_PREFLIGHT_WARNING:
            logger.error(
                "Startup blocked due to warnings (FAIL_ON_PREFLIGHT_WARNING=True)."
            )
            return False

        logger.info("Startup preflight PASSED.")
        return True

    # ========================================================
    # Main Access Control Logic
    # ========================================================

    def process_frame(self, frame) -> None:
        """
        Process a single camera frame for access control.

        The pipeline:
        1. Detect face → match against database
        2. If face matched → check uniform
        3. If both pass → open gate + welcome
        4. If face fails → offer fingerprint fallback
        5. Check RFID in parallel
        """
        self.frame_count += 1

        # Only process every Nth frame for performance
        if self.frame_count % config.FRAME_PROCESS_INTERVAL != 0:
            return

        # Step 1: Face Detection & Recognition
        student_id, student_name, confidence, face_location = (
            self.face_recognizer.identify_face(frame)
        )

        # Draw face box on frame for display
        if face_location:
            if student_id:
                color = (0, 255, 0)  # Green for match
                label = f"{student_name} ({confidence:.0%})"
            else:
                color = (0, 0, 255)  # Red for no match
                label = f"Unknown ({confidence:.0%})"
            self.face_recognizer.draw_face_box(frame, face_location, label, color)

        if student_id:
            # Step 2: Uniform Check
            student = self.db.get_student_by_id(student_id)
            person_type = (
                str(student.get("person_type", "student")).lower()
                if student
                else "student"
            )
            display_name = self._display_name_for_person(
                student or {}, student_name or "Unknown"
            )
            should_check_uniform = (
                config.UNIFORM_DETECTION_ENABLED and person_type == "student"
            )

            body_region = None
            if face_location:
                body_region = self.uniform_detector.get_body_region_from_face(
                    face_location, frame.shape
                )

            if should_check_uniform:
                uniform_type = self.db.get_uniform_type_for_person(student or {})
                uniform_ok, uniform_conf, uniform_detail = (
                    self.uniform_detector.check_uniform(
                        frame, uniform_type, body_region
                    )
                )
            else:
                uniform_ok, uniform_conf, uniform_detail = (
                    True,
                    1.0,
                    "Uniform check skipped for non-student",
                )

            if uniform_ok:
                # Step 3: Access Granted!
                self.gate.welcome(display_name)
                self.db.log_access(
                    method="face",
                    success=True,
                    person_id=student_id,
                    person_name=display_name,
                    confidence=confidence,
                    uniform_ok=uniform_ok,
                    person_type=person_type,
                )
                logger.info(f"ACCESS GRANTED (face): {display_name}")
                # Pause to avoid re-triggering
                time.sleep(config.GATE_OPEN_DURATION)
            else:
                # Uniform failed
                self.gate.deny_access(f"Uniform check failed for {display_name}")
                self.db.log_access(
                    method="face",
                    success=False,
                    person_id=student_id,
                    person_name=display_name,
                    person_type=person_type,
                    confidence=confidence,
                    uniform_ok=False,
                    failure_reason=f"Uniform check failed: {uniform_detail}",
                )
                logger.info(
                    f"ACCESS DENIED (uniform fail): {display_name} - {uniform_detail}"
                )
                time.sleep(3)

        elif face_location:
            # Face detected but not recognized
            logger.info("Face detected but not recognized. Offering fallback...")

            if config.SIMULATION_MODE:
                print("\n⚠️  Face not recognized!")
                print("Options: [1] Try fingerprint  [2] Skip")
                try:
                    choice = input("> ").strip()
                    if choice == "1":
                        self._fingerprint_fallback(
                            frame=frame, face_location=face_location
                        )
                except (EOFError, KeyboardInterrupt):
                    pass
            else:
                # In real deployment, automatically trigger the fingerprint check
                self._fingerprint_fallback(frame=frame, face_location=face_location)

            self.db.log_access(
                method="face",
                success=False,
                confidence=confidence,
                failure_reason="Face not recognized",
            )

    def _fingerprint_fallback(self, frame=None, face_location=None) -> None:
        """Handle fingerprint verification as a fallback when face fails."""
        logger.info("Starting fingerprint fallback...")

        if self.fingerprint_sensor.wait_for_finger():
            match, template_id, fp_confidence = (
                self.fingerprint_sensor.verify_fingerprint()
            )

            if match and template_id:
                # Look up student by fingerprint ID
                student = self.db.get_student_by_fingerprint(template_id)

                if student:
                    person_type = str(student.get("person_type", "student")).lower()
                    display_name = self._display_name_for_person(
                        student, student["name"]
                    )
                    should_check_uniform = (
                        config.FINGERPRINT_REQUIRES_UNIFORM and person_type == "student"
                    )

                    if should_check_uniform and frame is not None:
                        logger.info(
                            f"Fingerprint matched for {display_name}. Checking uniform..."
                        )
                        body_region = None
                        if face_location:
                            body_region = (
                                self.uniform_detector.get_body_region_from_face(
                                    face_location, frame.shape
                                )
                            )

                        uniform_type = self.db.get_uniform_type_for_person(student)
                        uniform_ok, uniform_conf, uniform_detail = (
                            self.uniform_detector.check_uniform(
                                frame, uniform_type, body_region
                            )
                        )

                        if not uniform_ok:
                            self.gate.deny_access(
                                f"Uniform check failed for {display_name}"
                            )
                            self.db.log_access(
                                method="fingerprint",
                                success=False,
                                person_id=student["id"],
                                person_name=display_name,
                                person_type=person_type,
                                confidence=fp_confidence,
                                uniform_ok=False,
                                failure_reason=f"Uniform check failed: {uniform_detail}",
                            )
                            logger.info(
                                f"ACCESS DENIED (fingerprint match, uniform fail): {display_name} - {uniform_detail}"
                            )
                            time.sleep(3)
                            return

                    self.gate.welcome(display_name)
                    self.db.log_access(
                        method="fingerprint",
                        success=True,
                        person_id=student["id"],
                        person_name=display_name,
                        person_type=person_type,
                        confidence=fp_confidence,
                        uniform_ok=True
                        if (should_check_uniform and frame is not None)
                        else None,
                    )
                    logger.info(f"ACCESS GRANTED (fingerprint): {display_name}")
                    time.sleep(config.GATE_OPEN_DURATION)
                else:
                    self.gate.deny_access(
                        "Fingerprint matched but no enrolled person found"
                    )
                    self.db.log_access(
                        method="fingerprint",
                        success=False,
                        confidence=fp_confidence,
                        failure_reason="Template not linked to enrolled person",
                    )
            else:
                self.gate.deny_access("Fingerprint not recognized")
                self.db.log_access(
                    method="fingerprint",
                    success=False,
                    failure_reason="Fingerprint not in database",
                )

    def _check_rfid(self) -> bool:
        """
        Check for RFID card swipe (non-blocking).

        Returns:
            True if a valid guest card was detected and gate was opened.
        """
        card_uid = self.rfid_reader.read_card(timeout=0.5)
        if card_uid:
            guest = self.db.get_guest_card(card_uid)
            if guest:
                self.gate.guest_welcome(guest["holder_name"])
                self.db.log_access(
                    method="rfid",
                    success=True,
                    person_name=guest["holder_name"],
                    person_type="guest",
                    confidence=1.0,
                )
                logger.info(f"GUEST ACCESS (RFID): {guest['holder_name']}")
                return True
            else:
                self.gate.deny_access("Unknown RFID card")
                self.db.log_access(
                    method="rfid",
                    success=False,
                    person_type="guest",
                    failure_reason=f"Unknown card UID: {card_uid}",
                )
                logger.info(f"ACCESS DENIED (unknown RFID): {card_uid}")
        return False

    # ========================================================
    # Sync Management
    # ========================================================

    def _sync_loop(self) -> None:
        """Background thread: periodic cloud sync."""
        while self.running:
            try:
                # Check if it's time for periodic sync
                elapsed = time.time() - self.last_sync_time
                if elapsed >= config.SYNC_INTERVAL_MINUTES * 60:
                    logger.info("Periodic sync triggered.")
                    self.sync_client.full_sync()
                    self._load_face_data()  # Reload faces after sync
                    self.last_sync_time = time.time()

                # Check if admin triggered manual sync
                if self.sync_client.check_sync_required():
                    logger.info("Admin-triggered sync detected.")
                    self.sync_client.full_sync()
                    self._load_face_data()
                    self.last_sync_time = time.time()

            except Exception as e:
                logger.error(f"Sync loop error: {e}")

            # Sleep between checks (every 30 seconds)
            for _ in range(30):
                if not self.running:
                    break
                time.sleep(1)

    def _sync_button_listener(self) -> None:
        """
        Listen for physical sync button press.
        In simulation mode, listens for Enter key.
        """
        while self.running:
            try:
                if config.SIMULATION_MODE:
                    # In simulation, this runs in its own thread
                    # We check a flag set by the main loop
                    time.sleep(1)
                else:
                    # Real hardware: GPIO button
                    try:
                        import RPi.GPIO as GPIO

                        GPIO.setup(
                            config.SYNC_BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP
                        )
                        GPIO.wait_for_edge(
                            config.SYNC_BUTTON_PIN, GPIO.FALLING, timeout=1000
                        )
                        if GPIO.input(config.SYNC_BUTTON_PIN) == GPIO.LOW:
                            logger.info("Physical sync button pressed!")
                            self.trigger_sync()
                    except Exception:
                        time.sleep(1)
            except Exception as e:
                logger.error(f"Sync button listener error: {e}")
                time.sleep(1)

    def trigger_sync(self) -> None:
        """Trigger an immediate sync."""
        logger.info("Manual sync triggered!")
        if config.SIMULATION_MODE:
            print("\n🔄 Manual sync started...")
        success, summary = self.sync_client.full_sync()
        self._load_face_data()
        self.last_sync_time = time.time()

    # ========================================================
    # Main Loop
    # ========================================================

    def run(self) -> str:
        """Start the main gate control loop."""
        self.running = True

        if config.ENABLE_STARTUP_PREFLIGHT:
            if not self._run_startup_preflight():
                logger.error("Cannot start gate loop: preflight failed.")
                self.running = False
                return "startup_failed"
        else:
            # Initialize camera
            if not self._init_camera():
                logger.error("Cannot start without camera. Exiting.")
                self.running = False
                return "startup_failed"

        # Start background sync thread
        self.sync_thread = threading.Thread(
            target=self._sync_loop, daemon=True, name="SyncThread"
        )
        self.sync_thread.start()

        # Start sync button listener
        self.sync_button_thread = threading.Thread(
            target=self._sync_button_listener, daemon=True, name="SyncButtonThread"
        )
        self.sync_button_thread.start()

        logger.info("Gate system is RUNNING. Press 'q' to quit, 's' to sync.")

        if config.SIMULATION_MODE:
            print("\n" + "=" * 60)
            print("  🏫 SMART GATE SYSTEM - ACTIVE")
            print(f"  School: {config.SCHOOL_NAME}")
            print("  Press 'q' to quit | 's' to manual sync")
            print("  Press 'r' to simulate RFID | 'f' for fingerprint")
            print("=" * 60 + "\n")

        try:
            while self.running:
                # Capture frame
                ret, frame = self.camera.read()
                if not ret:
                    logger.warning("Failed to capture frame. Retrying...")
                    time.sleep(0.1)
                    continue

                # Process frame for face recognition
                self.process_frame(frame)

                # Display frame (with annotations)
                cv2.imshow("Smart Gate Camera", frame)

                # Handle keyboard input
                key = cv2.waitKey(1) & 0xFF

                if key == ord("q"):
                    logger.info("Quit key pressed.")
                    break
                elif key == ord("s"):
                    self.trigger_sync()
                elif key == ord("r"):
                    # Simulate RFID scan
                    if config.SIMULATION_MODE:
                        self._check_rfid()
                elif key == ord("f"):
                    # Simulate fingerprint scan
                    if config.SIMULATION_MODE:
                        self._fingerprint_fallback(frame=frame, face_location=None)

        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received.")
        finally:
            self.shutdown()

        return "normal_exit"

    def shutdown(self) -> None:
        """Gracefully shut down all subsystems."""
        logger.info("Shutting down Smart Gate System...")
        self.running = False

        # Release camera
        if self.camera:
            self.camera.release()
        cv2.destroyAllWindows()

        # Cleanup subsystems
        self.face_recognizer.cleanup()
        self.uniform_detector.cleanup()
        self.fingerprint_sensor.cleanup()
        self.rfid_reader.cleanup()
        self.gate.cleanup()

        # Final sync attempt
        try:
            logger.info("Attempting final sync before shutdown...")
            self.sync_client.push_logs()
        except Exception as e:
            logger.error(f"Final sync failed: {e}")

        # Close database
        self.db.close()

        logger.info("Smart Gate System shut down complete.")


def main() -> None:
    """Entry point."""
    # Handle SIGINT/SIGTERM gracefully
    shutdown_requested = {"value": False}

    def signal_handler(sig, frame):
        logger.info(f"Signal {sig} received. Shutting down...")
        shutdown_requested["value"] = True

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    restart_count = 0

    while not shutdown_requested["value"]:
        system = SmartGateSystem()
        exit_reason = system.run()

        if shutdown_requested["value"]:
            break

        if exit_reason == "normal_exit":
            logger.info("System exited normally.")
            break

        if not config.WATCHDOG_ENABLED:
            logger.error("System exited unexpectedly and watchdog is disabled.")
            break

        restart_count += 1
        if (
            config.WATCHDOG_MAX_RESTARTS > 0
            and restart_count > config.WATCHDOG_MAX_RESTARTS
        ):
            logger.error("Watchdog restart limit reached. Stopping system.")
            break

        delay = max(1, int(config.WATCHDOG_RESTART_DELAY_SEC))
        logger.warning(
            f"Watchdog restart #{restart_count} in {delay}s "
            f"(last exit reason: {exit_reason})."
        )
        time.sleep(delay)

    logger.info("Main process terminated.")


if __name__ == "__main__":
    main()
