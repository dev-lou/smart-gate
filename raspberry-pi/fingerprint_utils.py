"""
Smart School Gate System - Fingerprint Sensor Utilities
=========================================================
Handles R307 fingerprint sensor operations.
In SIMULATION_MODE, uses keyboard input to mock sensor behavior.
"""

import logging
import time
from typing import Optional, Tuple

import config

logger = logging.getLogger(__name__)

# Try to import pyfingerprint for real hardware
FINGERPRINT_HW_AVAILABLE = False
if not config.SIMULATION_MODE:
    try:
        from pyfingerprint.pyfingerprint import PyFingerprint
        FINGERPRINT_HW_AVAILABLE = True
        logger.info("pyfingerprint library loaded.")
    except ImportError:
        logger.warning(
            "pyfingerprint not available. "
            "Set SIMULATION_MODE=True in config.py to use mock."
        )


class FingerprintSensor:
    """Interface for R307 fingerprint sensor, with simulation support."""

    def __init__(self) -> None:
        """Initialize the fingerprint sensor."""
        self.simulation: bool = config.SIMULATION_MODE
        self.sensor = None
        self.timeout: int = config.FINGERPRINT_TIMEOUT

        if not self.simulation and FINGERPRINT_HW_AVAILABLE:
            try:
                self.sensor = PyFingerprint(
                    config.FINGERPRINT_PORT,
                    config.FINGERPRINT_BAUD_RATE,
                    0xFFFFFFFF,
                    0x00000000
                )
                if not self.sensor.verifyPassword():
                    raise ValueError("Fingerprint sensor password mismatch!")
                logger.info(
                    f"Fingerprint sensor initialized on "
                    f"{config.FINGERPRINT_PORT}. "
                    f"Templates stored: {self.sensor.getTemplateCount()}"
                )
            except Exception as e:
                logger.error(f"Failed to initialize fingerprint sensor: {e}")
                self.sensor = None
                self.simulation = True
                logger.info("Falling back to simulation mode for fingerprint.")
        else:
            logger.info("Fingerprint sensor running in SIMULATION mode.")

    def wait_for_finger(self) -> bool:
        """
        Wait for a finger to be placed on the sensor.

        Returns:
            True if finger detected, False if timeout.
        """
        if self.simulation:
            print("\n" + "=" * 50)
            print("🔐 FINGERPRINT SCANNER (Simulation)")
            print("=" * 50)
            print("Place your finger on the sensor...")
            print(f"(Press Enter to simulate finger placement, "
                  f"or type 'skip' to cancel)")
            try:
                user_input = input("> ").strip().lower()
                if user_input == 'skip':
                    return False
                return True
            except (EOFError, KeyboardInterrupt):
                return False
        else:
            if not self.sensor:
                return False
            logger.info("Waiting for finger placement...")
            start_time = time.time()
            while (time.time() - start_time) < self.timeout:
                try:
                    if self.sensor.readImage():
                        return True
                except Exception as e:
                    logger.error(f"Fingerprint read error: {e}")
                    return False
                time.sleep(0.1)
            logger.info("Fingerprint timeout - no finger detected.")
            return False

    def verify_fingerprint(self) -> Tuple[bool, Optional[str], float]:
        """
        Scan and verify a fingerprint against stored templates.

        Returns:
            Tuple of (match_found, template_id, confidence_score).
        """
        if self.simulation:
            return self._simulate_verify()
        else:
            return self._hardware_verify()

    def _simulate_verify(self) -> Tuple[bool, Optional[str], float]:
        """Simulate fingerprint verification."""
        print("Scanning fingerprint...")
        time.sleep(0.5)  # Simulate scan time
        print("Enter fingerprint template ID (or 'none' for no match):")
        try:
            template_id = input("> ").strip()
            if template_id.lower() == 'none' or not template_id:
                print("❌ No fingerprint match.")
                return False, None, 0.0
            else:
                print(f"✅ Fingerprint matched! Template ID: {template_id}")
                return True, template_id, 0.95
        except (EOFError, KeyboardInterrupt):
            return False, None, 0.0

    def _hardware_verify(self) -> Tuple[bool, Optional[str], float]:
        """Verify fingerprint using real R307 sensor."""
        if not self.sensor:
            logger.error("Fingerprint sensor not initialized.")
            return False, None, 0.0

        try:
            # Read and convert the image
            self.sensor.convertImage(0x01)

            # Search for template
            result = self.sensor.searchTemplate()
            position = result[0]
            accuracy = result[1]

            if position == -1:
                logger.info("Fingerprint not found in database.")
                return False, None, 0.0
            else:
                # Convert position to string template ID
                template_id = str(position)
                confidence = accuracy / 100.0 if accuracy <= 100 else accuracy / 1000.0
                logger.info(
                    f"Fingerprint match at position {position} "
                    f"(accuracy={accuracy})"
                )
                return True, template_id, min(confidence, 1.0)

        except Exception as e:
            logger.error(f"Fingerprint verification error: {e}")
            return False, None, 0.0

    def enroll_fingerprint(self, template_id: Optional[int] = None) -> Tuple[bool, str]:
        """
        Enroll a new fingerprint (for future use).

        Args:
            template_id: Specific position to store template (optional).

        Returns:
            Tuple of (success, message).
        """
        if self.simulation:
            print("\n📝 FINGERPRINT ENROLLMENT (Simulation)")
            print("Place finger for enrollment...")
            try:
                input("Press Enter to simulate first scan > ")
                print("Remove finger and place again...")
                input("Press Enter to simulate second scan > ")
                pos = template_id or 0
                print(f"✅ Fingerprint enrolled at position {pos}")
                return True, str(pos)
            except (EOFError, KeyboardInterrupt):
                return False, "Enrollment cancelled"
        else:
            if not self.sensor:
                return False, "Sensor not available"

            try:
                # First scan
                logger.info("Place finger for enrollment (1st scan)...")
                while not self.sensor.readImage():
                    time.sleep(0.1)
                self.sensor.convertImage(0x01)

                # Second scan
                logger.info("Remove finger and place again (2nd scan)...")
                time.sleep(2)
                while not self.sensor.readImage():
                    time.sleep(0.1)
                self.sensor.convertImage(0x02)

                # Create template
                if self.sensor.compareCharacteristics() == 0:
                    return False, "Scans did not match"

                self.sensor.createTemplate()

                # Store template
                if template_id is not None:
                    position = self.sensor.storeTemplate(
                        template_id, 0x01
                    )
                else:
                    position = self.sensor.storeTemplate()

                return True, str(position)

            except Exception as e:
                logger.error(f"Fingerprint enrollment error: {e}")
                return False, str(e)

    def get_template_count(self) -> int:
        """Get the number of stored fingerprint templates."""
        if self.simulation:
            return 0
        elif self.sensor:
            try:
                return self.sensor.getTemplateCount()
            except Exception:
                return 0
        return 0

    def cleanup(self) -> None:
        """Release sensor resources."""
        self.sensor = None
        logger.info("Fingerprint sensor resources released.")
