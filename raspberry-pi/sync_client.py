"""
Smart School Gate System - Cloud Sync Client
==============================================
Handles synchronization between the local SQLite database
and the cloud (Next.js API backed by Supabase).
Works offline: sync failures are logged and retried.
"""

import base64
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import config
import requests
from database import GateDatabase

logger = logging.getLogger(__name__)


class SyncClient:
    """Manages data synchronization with the cloud API."""

    def __init__(self, database: GateDatabase) -> None:
        """
        Initialize the sync client.

        Args:
            database: GateDatabase instance for local data access.
        """
        self.db = database
        self.base_url = config.CLOUD_API_BASE_URL.rstrip("/")
        self.api_key = config.SYNC_API_KEY
        self.timeout = 30  # HTTP request timeout in seconds

    def _headers(self) -> Dict[str, str]:
        """Build HTTP headers for API requests."""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _is_online(self) -> bool:
        """Quick connectivity check."""
        try:
            requests.get(f"{self.base_url}/sync", timeout=5)
            return True
        except requests.RequestException:
            return False

    # ========================================================
    # Push Logs to Cloud
    # ========================================================

    def push_logs(self) -> Tuple[bool, int]:
        """
        Push unsynced access logs to the cloud API.

        Returns:
            Tuple of (success, number_of_logs_pushed).
        """
        unsynced = self.db.get_unsynced_logs()
        if not unsynced:
            logger.info("No unsynced logs to push.")
            return True, 0

        logger.info(f"Pushing {len(unsynced)} unsynced logs to cloud...")

        # Prepare payload
        payload = []
        for log in unsynced:
            payload.append(
                {
                    "person_id": log.get("person_id"),
                    "person_name": log.get("person_name"),
                    "person_type": log.get("person_type"),
                    "guest_visit_id": log.get("guest_visit_id"),
                    "direction": log.get("direction", "entry"),
                    "method": log["method"],
                    "success": bool(log["success"]),
                    "confidence": log.get("confidence"),
                    "uniform_ok": bool(log["uniform_ok"])
                    if log.get("uniform_ok") is not None
                    else None,
                    "photo_url": log.get("photo_url"),
                    "gate_id": log.get("gate_id", "GATE-01"),
                    "failure_reason": log.get("failure_reason"),
                    "override_operator_id": log.get("override_operator_id"),
                    "override_operator_name": log.get("override_operator_name"),
                    "override_reason": log.get("override_reason"),
                    "override_source": log.get("override_source"),
                    "device_timestamp": log["timestamp"],
                }
            )

        try:
            response = requests.post(
                f"{self.base_url}/logs",
                json={"logs": payload},
                headers=self._headers(),
                timeout=self.timeout,
            )
            response.raise_for_status()

            # Mark as synced
            log_ids = [log["id"] for log in unsynced]
            self.db.mark_logs_synced(log_ids)

            logger.info(f"Successfully pushed {len(log_ids)} logs.")
            return True, len(log_ids)

        except requests.Timeout:
            logger.warning("Log push timed out. Will retry on next sync.")
            return False, 0
        except requests.ConnectionError:
            logger.warning("Cannot connect to cloud. Logs will be pushed later.")
            return False, 0
        except requests.HTTPError as e:
            logger.error(f"Log push HTTP error: {e.response.status_code} - {e}")
            return False, 0
        except Exception as e:
            logger.error(f"Unexpected error pushing logs: {e}")
            return False, 0

    # ========================================================
    # Pull Updates from Cloud
    # ========================================================

    def pull_updates(self) -> Tuple[bool, Dict[str, int]]:
        """
        Pull enrolled people, guest cards, guest visits, and settings updates from the cloud API.

        Returns:
            Tuple of (success, counts_dict) where counts_dict has keys:
            'students', 'cards', 'guest_visits', 'settings'.
        """
        last_sync = self.db.get_last_sync_time()
        logger.info(f"Pulling updates since {last_sync}...")

        counts = {"students": 0, "cards": 0, "guest_visits": 0, "settings": 0}
        uniform_ref_download_failures = 0

        try:
            response = requests.get(
                f"{self.base_url}/sync",
                params={"last_sync": last_sync},
                headers=self._headers(),
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            # Process student updates
            students = data.get("students", [])
            for student in students:
                # Handle face_embedding (base64 encoded from cloud)
                if student.get("face_embedding"):
                    try:
                        student["face_embedding"] = base64.b64decode(
                            student["face_embedding"]
                        )
                    except Exception:
                        student["face_embedding"] = None

                self.db.upsert_student(student)
                counts["students"] += 1

            # Process guest card updates
            cards = data.get("guest_cards", [])
            for card in cards:
                self.db.upsert_guest_card(card)
                counts["cards"] += 1

            # Process QR guest visit updates
            guest_visits = data.get("guest_visits", [])
            for visit in guest_visits:
                self.db.upsert_guest_visit(visit)
                counts["guest_visits"] += 1

            # Process system settings updates
            settings = data.get("settings", [])
            for setting in settings:
                key = setting.get("key")
                value = setting.get("value")
                if key and value is not None:
                    self.db.upsert_setting(key, value)
                    counts["settings"] += 1

                    # If this is a uniform reference image, download it for offline use
                    if key.startswith("uniform_ref_") and value.startswith("http"):
                        download_ok = self._download_uniform_reference(key, value)
                        if not download_ok:
                            uniform_ref_download_failures += 1

            # Update last sync time
            sync_time = data.get("sync_time", datetime.now().isoformat())
            self.db.set_last_sync_time(sync_time)

            logger.info(
                f"Sync complete: {counts['students']} people, "
                f"{counts['cards']} cards, {counts['guest_visits']} guest visits, "
                f"{counts['settings']} settings updated."
            )

            if uniform_ref_download_failures > 0:
                logger.warning(
                    f"Uniform reference download failures: {uniform_ref_download_failures}"
                )
            return True, counts

        except requests.Timeout:
            logger.warning("Pull updates timed out. Will retry later.")
            return False, counts
        except requests.ConnectionError:
            logger.warning("Cannot connect to cloud. Will pull updates later.")
            return False, counts
        except requests.HTTPError as e:
            logger.error(f"Pull updates HTTP error: {e.response.status_code}")
            return False, counts
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response from cloud: {e}")
            return False, counts
        except Exception as e:
            logger.error(f"Unexpected error pulling updates: {e}")
            return False, counts

    def _download_uniform_reference(self, key: str, url: str) -> bool:
        """Download and save a uniform reference image locally."""
        import os

        import cv2
        import numpy as np

        # Ensure directory exists
        save_dir = os.path.join(os.path.dirname(__file__), "data", "uniforms")
        os.makedirs(save_dir, exist_ok=True)

        file_path = os.path.join(save_dir, f"{key}.jpg")

        try:
            logger.info(f"Downloading uniform reference image for '{key}'...")
            response = requests.get(url, timeout=15)
            response.raise_for_status()

            # Validate that payload decodes into an image before writing to disk.
            image_array = np.frombuffer(response.content, dtype=np.uint8)
            decoded = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if decoded is None or decoded.size == 0:
                logger.error(f"Downloaded payload for {key} is not a valid image.")
                return False

            with open(file_path, "wb") as f:
                f.write(response.content)
            logger.info(f"Saved uniform reference to {file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to download uniform reference {key}: {e}")
            return False

    # ========================================================
    # Check Sync Required Flag
    # ========================================================

    def check_sync_required(self) -> bool:
        """
        Check if the admin has triggered a manual sync via the dashboard.

        Returns:
            True if sync is required.
        """
        try:
            response = requests.get(
                f"{self.base_url}/settings",
                params={"key": "sync_required"},
                headers=self._headers(),
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()

            sync_required = data.get("value", "false").lower() == "true"
            if sync_required:
                logger.info("Admin-triggered sync detected!")
                # Reset the flag
                self._reset_sync_flag()
            return sync_required

        except Exception as e:
            logger.debug(f"Could not check sync flag: {e}")
            return False

    def _reset_sync_flag(self) -> None:
        """Reset the sync_required flag in the cloud."""
        try:
            requests.put(
                f"{self.base_url}/settings",
                json={"key": "sync_required", "value": "false"},
                headers=self._headers(),
                timeout=10,
            )
        except Exception as e:
            logger.debug(f"Could not reset sync flag: {e}")

    # ========================================================
    # Full Sync
    # ========================================================

    def full_sync(self) -> Tuple[bool, str]:
        """
        Perform a full sync: push logs then pull updates.

        Returns:
            Tuple of (overall_success, summary_message).
        """
        logger.info("=" * 50)
        logger.info("Starting full sync...")
        logger.info("=" * 50)

        push_ok, push_count = self.push_logs()
        pull_ok, pull_counts = self.pull_updates()

        overall_ok = push_ok and pull_ok
        summary = (
            f"Sync {'completed' if overall_ok else 'partially failed'}: "
            f"pushed {push_count} logs, "
            f"pulled {pull_counts['students']} people / "
            f"{pull_counts['cards']} cards / "
            f"{pull_counts.get('guest_visits', 0)} guest visits / "
            f"{pull_counts['settings']} settings"
        )
        logger.info(summary)

        if config.SIMULATION_MODE:
            print(f"\n🔄 {summary}")

        return overall_ok, summary
