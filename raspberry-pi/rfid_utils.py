"""
Smart School Gate System - RFID Reader Utilities
==================================================
Handles MFRC522 RFID card reading for guest access.
In SIMULATION_MODE, uses keyboard input to mock card swipes.
"""

import logging
import time
from typing import Optional

import config

logger = logging.getLogger(__name__)

# Try to import MFRC522 for real hardware
RFID_HW_AVAILABLE = False
if not config.SIMULATION_MODE:
    try:
        from mfrc522 import SimpleMFRC522
        RFID_HW_AVAILABLE = True
        logger.info("MFRC522 library loaded.")
    except ImportError:
        logger.warning(
            "mfrc522 not available. "
            "Set SIMULATION_MODE=True in config.py to use mock."
        )


class RFIDReader:
    """Interface for MFRC522 RFID reader, with simulation support."""

    def __init__(self) -> None:
        """Initialize the RFID reader."""
        self.simulation: bool = config.SIMULATION_MODE
        self.enabled: bool = config.RFID_ENABLED
        self.reader = None

        if not self.simulation and RFID_HW_AVAILABLE:
            try:
                self.reader = SimpleMFRC522()
                logger.info("RFID reader (MFRC522) initialized.")
            except Exception as e:
                logger.error(f"Failed to initialize RFID reader: {e}")
                self.reader = None
                self.simulation = True
                logger.info("Falling back to simulation mode for RFID.")
        else:
            logger.info("RFID reader running in SIMULATION mode.")

    def read_card(self, timeout: float = 2.0) -> Optional[str]:
        """
        Read an RFID card UID.

        Args:
            timeout: Seconds to wait for card (only for hardware mode).

        Returns:
            Card UID as string, or None if no card detected.
        """
        if not self.enabled:
            return None

        if self.simulation:
            return self._simulate_read()
        else:
            return self._hardware_read(timeout)

    def _simulate_read(self) -> Optional[str]:
        """Simulate RFID card reading via keyboard input."""
        print("\n" + "=" * 50)
        print("📇 RFID SCANNER (Simulation)")
        print("=" * 50)
        print("Tap your RFID card...")
        print("(Enter card UID, or press Enter to skip)")
        try:
            uid = input("> ").strip()
            if uid:
                print(f"📇 Card detected: UID = {uid}")
                return uid
            else:
                return None
        except (EOFError, KeyboardInterrupt):
            return None

    def _hardware_read(self, timeout: float) -> Optional[str]:
        """Read RFID card using real MFRC522 hardware."""
        if not self.reader:
            logger.error("RFID reader not initialized.")
            return None

        try:
            # Non-blocking read attempt
            card_id, text = self.reader.read_no_block()
            if card_id:
                uid = str(card_id).strip()
                logger.info(f"RFID card detected: {uid}")
                return uid
            return None
        except Exception as e:
            logger.error(f"RFID read error: {e}")
            return None

    def read_card_blocking(self) -> Optional[str]:
        """
        Read an RFID card (blocking until a card is presented).

        Returns:
            Card UID as string.
        """
        if self.simulation:
            return self._simulate_read()

        if not self.reader:
            return None

        try:
            logger.info("Waiting for RFID card (blocking)...")
            card_id, text = self.reader.read()
            uid = str(card_id).strip()
            logger.info(f"RFID card read: {uid}")
            return uid
        except Exception as e:
            logger.error(f"RFID blocking read error: {e}")
            return None

    def write_card(self, text: str) -> bool:
        """
        Write data to an RFID card (for provisioning).

        Args:
            text: Text to write to the card.

        Returns:
            True if write was successful.
        """
        if self.simulation:
            print(f"📝 Simulated card write: '{text}'")
            return True

        if not self.reader:
            return False

        try:
            self.reader.write(text)
            logger.info(f"Wrote to RFID card: {text}")
            return True
        except Exception as e:
            logger.error(f"RFID write error: {e}")
            return False

    def cleanup(self) -> None:
        """Release RFID reader resources."""
        if not self.simulation and RFID_HW_AVAILABLE:
            try:
                import RPi.GPIO as GPIO
                GPIO.cleanup()
            except Exception:
                pass
        self.reader = None
        logger.info("RFID reader resources released.")
