"""
Smart School Gate System - Gate Controller
============================================
Controls the servo motor to open/close the gate.
In SIMULATION_MODE, prints status messages instead
of using GPIO.
"""

import logging
import threading
import time
from typing import Optional

import config

logger = logging.getLogger(__name__)

# Try to import GPIO library
GPIO_AVAILABLE = False
if not config.SIMULATION_MODE:
    try:
        import RPi.GPIO as GPIO
        GPIO_AVAILABLE = True
        logger.info("RPi.GPIO library loaded.")
    except ImportError:
        try:
            from gpiozero import Servo
            GPIO_AVAILABLE = True
            logger.info("gpiozero library loaded.")
        except ImportError:
            logger.warning(
                "Neither RPi.GPIO nor gpiozero available. "
                "Set SIMULATION_MODE=True in config.py."
            )

# Try to import pyttsx3 for TTS
TTS_AVAILABLE = False
try:
    import pyttsx3
    TTS_AVAILABLE = True
except ImportError:
    logger.warning("pyttsx3 not available. TTS disabled.")


class GateController:
    """Controls the physical gate servo motor and audio feedback."""

    def __init__(self) -> None:
        """Initialize the gate controller."""
        self.simulation: bool = config.SIMULATION_MODE
        self.servo_pin: int = config.SERVO_PIN
        self.open_angle: int = config.SERVO_OPEN_ANGLE
        self.close_angle: int = config.SERVO_CLOSE_ANGLE
        self.open_duration: int = config.GATE_OPEN_DURATION
        self.is_open: bool = False
        self._lock = threading.Lock()
        self._close_timer: Optional[threading.Timer] = None
        self._cycle_count: int = 0

        # Initialize servo
        self.servo = None
        if not self.simulation and GPIO_AVAILABLE:
            self._init_gpio()
        else:
            logger.info("Gate controller running in SIMULATION mode.")

        # Initialize TTS engine
        self.tts_engine = None
        if config.TTS_ENABLED and TTS_AVAILABLE:
            try:
                self.tts_engine = pyttsx3.init()
                self.tts_engine.setProperty('rate', config.TTS_RATE)
                self.tts_engine.setProperty('volume', config.TTS_VOLUME)
                logger.info("TTS engine initialized.")
            except Exception as e:
                logger.error(f"TTS initialization failed: {e}")
                self.tts_engine = None

    def _init_gpio(self) -> None:
        """Initialize GPIO for servo control."""
        try:
            GPIO.setmode(GPIO.BCM)
            GPIO.setup(self.servo_pin, GPIO.OUT)
            self.servo = GPIO.PWM(self.servo_pin, 50)  # 50Hz for servo
            self.servo.start(0)
            self._set_angle(self.close_angle)
            logger.info(f"Servo initialized on GPIO {self.servo_pin}")
        except Exception as e:
            logger.error(f"GPIO initialization failed: {e}")
            self.simulation = True

    def _set_angle(self, angle: int) -> None:
        """Set servo to a specific angle."""
        if self.servo:
            duty = 2.0 + (angle / 18.0)
            self.servo.ChangeDutyCycle(duty)
            time.sleep(0.5)
            self.servo.ChangeDutyCycle(0)

    def _animate_turnstile_cycle(self) -> None:
        """Render a short subway-style turnstile cycle in simulation mode."""
        if not self.simulation or not config.GATE_SIMULATION_ANIMATION:
            return

        frames = ["◐", "◓", "◑", "◒"]
        print("\n🚇 Turnstile cycle started")
        for i in range(12):
            frame = frames[i % len(frames)]
            print(f"\r   Gate ring: {frame}  rotating", end="", flush=True)
            time.sleep(0.12)
        print("\r   Gate ring: ◎  cycle complete")

    def open_gate(self, duration: Optional[int] = None) -> None:
        """
        Open the gate for a specified duration.

        Args:
            duration: Seconds to keep gate open. Uses config default if None.
        """
        with self._lock:
            if self.is_open:
                if config.GATE_SINGLE_CYCLE_MODE:
                    logger.info("Gate cycle already active; ignoring duplicate trigger.")
                    return

                logger.info("Gate already open, resetting timer.")
                if self._close_timer:
                    self._close_timer.cancel()
            else:
                self.is_open = True
                self._cycle_count += 1

                if self.simulation:
                    print("\n🚪 ═══════════════════════════")
                    print(f"    🟢 GATE OPENED (cycle #{self._cycle_count})")
                    print("═══════════════════════════════")
                    logger.info("SIMULATION: Gate opened.")
                    self._animate_turnstile_cycle()
                else:
                    self._set_angle(self.open_angle)
                    logger.info("Gate opened (servo).")

            # Schedule auto-close
            close_time = duration or self.open_duration
            self._close_timer = threading.Timer(
                close_time, self.close_gate
            )
            self._close_timer.daemon = True
            self._close_timer.start()
            logger.info(f"Gate will auto-close in {close_time} seconds.")

    def close_gate(self) -> None:
        """Close the gate."""
        with self._lock:
            if not self.is_open:
                return

            self.is_open = False

            if self.simulation:
                print("\n🚪 ═══════════════════════════")
                print("    🔴 GATE CLOSED")
                print("═══════════════════════════════")
                logger.info("SIMULATION: Gate closed.")
            else:
                self._set_angle(self.close_angle)
                logger.info("Gate closed (servo).")

    def speak(self, message: str) -> None:
        """
        Play a text-to-speech message.

        Args:
            message: Text to speak.
        """
        if not config.TTS_ENABLED:
            return

        if self.simulation:
            print(f"🔊 TTS: \"{message}\"")
            logger.info(f"SIMULATION TTS: {message}")

            if not config.SIMULATION_PLAY_AUDIO:
                return

        if self.tts_engine:
            try:
                self.tts_engine.say(message)
                self.tts_engine.runAndWait()
            except Exception as e:
                logger.error(f"TTS playback error: {e}")
        else:
            logger.warning(f"TTS not available. Message: {message}")

    def welcome(self, student_name: str, school_name: Optional[str] = None) -> None:
        """
        Play a welcome message and open the gate.

        Args:
            student_name: Name of the recognized student.
            school_name: School name (uses config default if None).
        """
        school = school_name or config.SCHOOL_NAME
        message = f"Welcome to {school}, {student_name}!"

        if self.simulation:
            print(f"\n✅ ═══════════════════════════════════")
            print(f"   ACCESS GRANTED: {student_name}")
            print(f"   🔊 \"{message}\"")
            print(f"═══════════════════════════════════════")

        self.speak(message)
        self.open_gate()

    def deny_access(self, reason: str = "Unrecognized person") -> None:
        """
        Play a denial message.

        Args:
            reason: Reason for denial.
        """
        message = f"Access denied. {reason}."

        if self.simulation:
            print(f"\n❌ ═══════════════════════════════════")
            print(f"   ACCESS DENIED: {reason}")
            print(f"═══════════════════════════════════════")

        self.speak(message)

    def guest_welcome(self, holder_name: str) -> None:
        """
        Welcome a guest card holder.

        Args:
            holder_name: Name of the guest card holder.
        """
        message = f"Welcome, {holder_name}. Guest access granted."

        if self.simulation:
            print(f"\n✅ ═══════════════════════════════════")
            print(f"   GUEST ACCESS: {holder_name}")
            print(f"   🔊 \"{message}\"")
            print(f"═══════════════════════════════════════")

        self.speak(message)
        self.open_gate()

    def alert(self, message: str) -> None:
        """Play an alert message (e.g., for errors or warnings)."""
        self.speak(message)

    def cleanup(self) -> None:
        """Release all resources."""
        if self._close_timer:
            self._close_timer.cancel()

        if not self.simulation and self.servo:
            try:
                self.servo.stop()
                GPIO.cleanup()
            except Exception:
                pass

        if self.tts_engine:
            try:
                self.tts_engine.stop()
            except Exception:
                pass

        logger.info("Gate controller resources released.")
