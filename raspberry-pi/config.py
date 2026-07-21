"""
Smart School Gate System - Configuration
==========================================
All configurable parameters for the gate controller.
Set SIMULATION_MODE = True to run on a laptop without real hardware.
"""

import os

BASE_DIR: str = os.path.dirname(os.path.abspath(__file__))

# ============================================================
# SIMULATION MODE
# Set True to mock hardware (servo, RFID, fingerprint)
# and use laptop webcam instead of Pi Camera.
# ============================================================
SIMULATION_MODE: bool = True

# ============================================================
# Deployment Hardening
# ============================================================
ENABLE_STARTUP_PREFLIGHT: bool = True  # Run startup checks before entering gate loop
FAIL_ON_PREFLIGHT_WARNING: bool = (
    True  # Block startup if required components are not healthy
)
REQUIRE_CLOUD_ON_STARTUP: bool = False  # Keep False for true offline-first operation
ALLOW_EMPTY_ENROLLMENT_STARTUP: bool = (
    False  # If False, require at least one active enrolled student
)

WATCHDOG_ENABLED: bool = True  # Restart process loop on unexpected runtime failure
WATCHDOG_RESTART_DELAY_SEC: int = 5  # Wait time before watchdog restart
WATCHDOG_MAX_RESTARTS: int = 5  # 0 = unlimited restarts

# ============================================================
# School Information
# ============================================================
SCHOOL_NAME: str = "Smart Academy"

# ============================================================
# Face Recognition
# ============================================================
FACE_RECOGNITION_THRESHOLD: float = (
    0.6  # Cosine similarity threshold (0-1, higher = stricter)
)
FACE_DETECTION_MODEL: str = "hog"  # "hog" (faster, CPU) or "cnn" (more accurate, GPU)
CAMERA_INDEX: int = 0  # Camera device index (0 = default webcam)
CAMERA_SOURCE: str = (
    ""  # Optional camera source URL/device path (e.g., phone IP camera URL)
)
FRAME_RESIZE_FACTOR: float = 0.25  # Resize frames for faster face detection
FRAME_PROCESS_INTERVAL: int = 3  # Process every Nth frame for performance
MAX_FACE_DISTANCE: float = 0.6  # Maximum face distance for match (lower = stricter)

# ============================================================
# Uniform Detection
# ============================================================
UNIFORM_DETECTION_ENABLED: bool = True
FACULTY_REQUIRES_UNIFORM: bool = (
    False  # If False, faculty can pass without uniform check
)
USE_YOLO_FOR_UNIFORM: bool = False  # True = YOLO11, False = color-based fallback
YOLO_MODEL_PATH: str = "models/uniform_yolo11n/best.pt"  # Path to trained YOLO11 model
# YOLO11 Nano - released Sept 2024, current recommended model for Raspberry Pi edge deployment
YOLO_UNIFORM_MIN_CONFIDENCE: float = (
    0.45  # Minimum confidence for YOLO uniform class match
)
UNIFORM_MIN_CONFIDENCE_FOR_GRANT: float = 0.72  # Final guardrail before granting access
UNIFORM_REQUIRE_REFERENCE_IMAGE: bool = (
    True  # Fail uniform check if no reference image exists
)
UNIFORM_FAIL_CLOSED_ON_ERROR: bool = True  # Fail uniform check if detector errors occur
YOLO_UNIFORM_CLASS_MAP: dict = {
    # Keys are local uniform_type values, values are class names in YOLO dataset/model.
    # Keep class names lowercase for robust matching.
    "default": ["uniform_default", "uniform"],
    "blue_vest": ["uniform_blue_vest", "blue_vest", "uniform"],
    "red_badge": ["uniform_red_badge", "red_badge", "badge", "uniform"],
    "green_vest": ["uniform_green_vest", "green_vest", "uniform"],
}
UNIFORM_SIMILARITY_THRESHOLD: float = 0.68  # Lower = more tolerant, Higher = stricter

# Default uniform color range in HSV (for color-based detection)
# These detect a blue uniform by default. Adjust for your school colors.
UNIFORM_COLOR_LOWER: tuple = (100, 50, 50)  # HSV lower bound
UNIFORM_COLOR_UPPER: tuple = (130, 255, 255)  # HSV upper bound
UNIFORM_MIN_AREA_RATIO: float = (
    0.15  # Minimum percentage of body area showing uniform color
)

# Uniform types configuration
UNIFORM_TYPES: dict = {
    "default": {
        "color_lower": (100, 50, 50),
        "color_upper": (130, 255, 255),
        "description": "Blue uniform",
        "similarity_threshold": 0.68,
    },
    "blue_vest": {
        "color_lower": (100, 50, 50),
        "color_upper": (130, 255, 255),
        "description": "Blue vest",
        "similarity_threshold": 0.67,
    },
    "red_badge": {
        "color_lower": (0, 100, 100),
        "color_upper": (10, 255, 255),
        "description": "Red badge/vest",
        "similarity_threshold": 0.66,
    },
    "green_vest": {
        "color_lower": (35, 50, 50),
        "color_upper": (85, 255, 255),
        "description": "Green vest",
        "similarity_threshold": 0.66,
    },
}

# ============================================================
# Fingerprint Sensor (R307)
# ============================================================
FINGERPRINT_REQUIRES_UNIFORM: bool = (
    True  # Require uniform check after fingerprint match?
)
FINGERPRINT_PORT: str = "/dev/ttyUSB0"  # Serial port for R307 sensor
FINGERPRINT_BAUD_RATE: int = 57600
FINGERPRINT_TIMEOUT: int = 10  # Seconds to wait for finger placement

# ============================================================
# RFID (MFRC522)
# ============================================================
RFID_ENABLED: bool = True

# ============================================================
# Gate Servo Motor
# ============================================================
SERVO_PIN: int = 18  # GPIO pin for servo signal (BCM numbering)
SERVO_OPEN_ANGLE: int = 90  # Angle for gate open position
SERVO_CLOSE_ANGLE: int = 0  # Angle for gate closed position
GATE_OPEN_DURATION: int = 5  # Seconds to keep gate open
GATE_SINGLE_CYCLE_MODE: bool = (
    True  # Ignore repeated open triggers until gate locks again
)
GATE_SIMULATION_ANIMATION: bool = (
    True  # Show terminal turnstile animation in simulation mode
)
BRAIN_API_GATE_CONTROL_ENABLED: bool = (
    False  # Set True only if brain_api.py owns gate hardware
)

# ============================================================
# Audio / TTS
# ============================================================
TTS_ENABLED: bool = True
TTS_RATE: int = 150  # Speech rate (words per minute)
TTS_VOLUME: float = 1.0  # Volume (0.0 - 1.0)
SIMULATION_PLAY_AUDIO: bool = (
    True  # In SIMULATION_MODE, still speak via pyttsx3 when available
)

# ============================================================
# Cloud Sync
# ============================================================
CLOUD_API_BASE_URL: str = "http://localhost:3000/api"  # Next.js API base URL
SYNC_INTERVAL_MINUTES: int = 60  # Sync every N minutes
SYNC_API_KEY: str = ""  # Optional API key for auth

# ============================================================
# Database
# ============================================================
DATABASE_PATH: str = os.path.join(BASE_DIR, "smart_gate.db")

# ============================================================
# Logging
# ============================================================
LOG_LEVEL: str = "INFO"  # DEBUG, INFO, WARNING, ERROR
LOG_FILE: str = os.path.join(BASE_DIR, "gate_system.log")

# ============================================================
# GPIO Pins (BCM Numbering) - for additional hardware
# ============================================================
SYNC_BUTTON_PIN: int = 17  # Physical sync button GPIO pin
LED_GREEN_PIN: int = 27  # Green LED (access granted)
LED_RED_PIN: int = 22  # Red LED (access denied)
BUZZER_PIN: int = 23  # Buzzer for alerts
