# Smart Access Control System — Python/Local Backend

## Overview

Offline-first campus gate access control system running on a Raspberry Pi, laptop, or any computer with a webcam. Performs face recognition, uniform detection for students, fingerprint verification, RFID guest card access, QR-based guest visitor workflows, and manual override logging.

This is the **AI brain and gate control** component. The **cloud dashboard** lives in `../web-dashboard`.

## Features

- **Face Recognition** — Matches faces against enrolled faculty, staff, and students using `dlib`/`face_recognition`
- **Student Uniform Detection** — Verifies each student's prescribed department uniform using YOLO11 Nano or color-based detection. Uniform policy is resolved per-department from cloud settings.
- **Department-Based Uniform Policies** — Synced from cloud; each student's department is matched against the policy to select the correct expected uniform class.
- **All-Person Access Decisions** — Faculty and staff pass on face recognition only; students additionally require uniform compliance. Guests use QR or RFID.
- **QR Guest Visitor Workflow** — `/qr-verify` endpoint validates temporary visitor QR tokens and logs entry/exit events with guest visit IDs.
- **Manual Override Endpoint** — `/manual-override` records guard-authorized gate openings.
- **Entry/Exit Tracking** — All access events carry a `direction` field (`entry` or `exit`). The `/access-verify` endpoint selects entry (face + uniform for students) or exit (face only) logic.
- **Fingerprint Fallback** — R307 optical sensor used when face recognition fails.
- **RFID Legacy Guest** — MFRC522 for existing RFID guest cards.
- **Gate Control** — MG996R servo motor via Raspberry Pi GPIO (simulated on non-Pi hardware). Enabled in Brain API via `BRAIN_API_GATE_CONTROL_ENABLED`.
- **Text-to-Speech** — Audio welcome/denial via `pyttsx3`.
- **Offline-First SQLite** — All logs, persons, guest visits, QR tokens, and policies stored locally. No internet required.
- **Cloud Sync** — Pushes access logs and pulls enrolled people, guest visits, guest cards, uniform policies, and system settings.

## Hardware Requirements (Production)

| Component | Model | Connection |
|-----------|-------|------------|
| Single Board Computer | Raspberry Pi 4B (4GB+) | — |
| Camera | Pi Camera v2 or USB webcam | CSI / USB |
| Fingerprint Sensor | R307 Optical | UART (USB-TTL) |
| RFID Reader | MFRC522 | SPI |
| Servo Motor | SG90 / MG996R | GPIO PWM |
| Power Supply | 5V 3A | USB-C |

## Quick Start (Simulation on Laptop)

### 1. Prerequisites

- Python 3.9+
- Webcam (built-in or USB)
- pip

### 2. Install Dependencies

```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate   # Linux/Mac
venv\Scripts\activate      # Windows

# Install packages
pip install -r requirements.txt
```

> **Note:** On Windows, you may need to install Visual Studio Build Tools for `dlib`/`face_recognition`. Alternatively, install pre-built wheels:
> ```bash
> pip install dlib-binary
> pip install face-recognition
> ```

### 3. Configure

Edit `config.py`:

```python
SIMULATION_MODE = True              # Set True for laptop testing
SCHOOL_NAME = "Your School Name"
CAMERA_INDEX = 0                    # Your webcam index
CLOUD_API_BASE_URL = "http://localhost:3000/api"  # Web dashboard URL
```

### 4. Run

```bash
python main.py
```

### 4.1 Test With Vercel + Phone Camera

You can run gate simulation locally while syncing to a Vercel deployment.

1. Deploy `web-dashboard` to Vercel.
2. Set in `config.py`:

```python
SIMULATION_MODE = True
CLOUD_API_BASE_URL = "https://<your-vercel-domain>/api"
```

3. Use your phone as camera source (same Wi-Fi as laptop):
: Install an IP camera app (e.g., IP Webcam or DroidCam).
: Start stream and copy URL (example: `http://192.168.1.10:8080/video`).
: Set in `config.py`:

```python
CAMERA_SOURCE = "http://192.168.1.10:8080/video"
```

4. Run Pi app locally:

```bash
python main.py
```

5. Open the Vercel dashboard from your phone browser to monitor logs/settings.

Notes:

- The Raspberry Pi Python app still runs on your laptop/Pi (not on Vercel).
- Vercel hosts cloud API/dashboard only.
- If phone stream is unstable, lower phone camera resolution/FPS in the app.

### 4.2 Phone Kiosk Test (Face + Uniform + Fingerprint Fallback)

You can test a mobile kiosk page (`/kiosk`) while using the Raspberry Pi folder as the brain.

1. Start brain API from the Raspberry Pi folder:

```bash
python brain_api.py
```

2. Expose brain API with a tunnel (for Vercel kiosk access), for example Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:8088
```

3. Open kiosk page on phone:

- Local: `http://<dashboard-host>/kiosk`
- Vercel: `https://<your-vercel-domain>/kiosk`

4. Paste your tunnel URL into "Brain API URL" on kiosk page.

5. Use kiosk controls:

- `Start Camera` -> opens phone front camera preview
- `Start Scan` -> continuous face + uniform checks
- `Single Check` -> one-shot detection
- `Fingerprint Fallback Test` -> enter template ID and verify

This lets you test detection UX directly on phone while Python logic stays in `raspberry-pi`.

### 5. Controls

| Key | Action |
|-----|--------|
| `q` | Quit the system |
| `s` | Trigger manual cloud sync |
| `r` | Simulate RFID card scan |
| `f` | Simulate fingerprint scan |

### 6. What You Will See In Simulation

- When access is granted, the terminal prints `GATE OPENED` and a short turnstile ring animation.
- The gate uses one-cycle behavior by default (`GATE_SINGLE_CYCLE_MODE = True`), so repeated detections while open are ignored until it auto-locks.
- After `GATE_OPEN_DURATION`, it prints `GATE CLOSED` (locked again).
- Voice output says: `Welcome to <School Name>, <Student Name>!` when `TTS_ENABLED = True`.
- If you want real laptop audio during simulation, keep `SIMULATION_PLAY_AUDIO = True` and install `pyttsx3`.

### 7. Pre-Deployment Sync Verification (Recommended)

Run this before buying hardware to confirm cloud-to-local cache reliability:

```bash
python sync_health_check.py
```

The check performs a real sync and then validates:

- local student/card/settings cache counts
- uniform reference URL keys in local `system_settings`
- local offline uniform image files under `data/uniforms`
- image decode validity (not corrupted downloads)

If all checks pass, it prints: `RESULT: PASS`.

### 8. Fingerprint Enrollment Workflow (Student + Faculty)

Do not rely on manually typing template IDs during account creation.
Use the enrollment CLI on the Raspberry Pi to bind live sensor templates:

```bash
python fingerprint_enroll_cli.py
```

What it does:

- lists active people with no fingerprint yet (students and faculty)
- lets operator select one profile
- performs real/simulated sensor enrollment
- writes assigned template ID back to local SQLite

This keeps enrollment controlled while allowing the actual user/faculty member
to register their own finger on the sensor.

### 8. Startup Preflight and Watchdog (Unattended Deployment)

For unattended gate operation, the app now supports startup preflight checks and watchdog restarts.

Recommended settings in `config.py` for production:

```python
SIMULATION_MODE = False
ENABLE_STARTUP_PREFLIGHT = True
FAIL_ON_PREFLIGHT_WARNING = True
REQUIRE_CLOUD_ON_STARTUP = False  # Keep offline-first behavior
ALLOW_EMPTY_ENROLLMENT_STARTUP = False

WATCHDOG_ENABLED = True
WATCHDOG_RESTART_DELAY_SEC = 5
WATCHDOG_MAX_RESTARTS = 0  # Unlimited
```

Preflight validates database, camera frame capture, enrollment availability,
uniform reference cache files, and (optionally) cloud reachability.

If startup checks fail, the system does not open the gate loop.
If runtime exits unexpectedly, watchdog restarts it automatically.

## 9. Train a Custom YOLO11 Uniform Model (Recommended)

If color-based matching still allows lookalike clothes, train a custom YOLO model for your school's exact uniforms.

1. Install dependencies (inside your Python env):

```bash
pip install -r requirements.txt
```

2. Prepare your YOLO dataset:

- Put images in `yolo/dataset/images/train` and `yolo/dataset/images/val`
- Put label txt files in `yolo/dataset/labels/train` and `yolo/dataset/labels/val`
- Configure classes in `yolo/data/uniform_dataset.yaml`

3. Train:

```bash
python yolo/train_uniform_yolo.py --data yolo/data/uniform_dataset.yaml --model yolo11n.pt --epochs 120 --imgsz 640
```

4. Validate + export:

```bash
python yolo/export_uniform_yolo.py --weights models/uniform_yolo11n/weights/best.pt --data yolo/data/uniform_dataset.yaml --format onnx
```

5. Enable YOLO runtime in `config.py`:

```python
USE_YOLO_FOR_UNIFORM = True
YOLO_MODEL_PATH = "models/uniform_yolo11n/weights/best.pt"
YOLO_UNIFORM_MIN_CONFIDENCE = 0.45
```

Then restart `brain_api.py`.

## Brain API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | System status |
| `/access-verify` | POST | Entry/exit with logging |
| `/verify` | POST | Access decision (no log) |
| `/verify-face` | POST | Face-only stage |
| `/verify-uniform` | POST | Uniform-only stage |
| `/analyze` | POST | Full face+uniform analysis |
| `/fingerprint-verify` | POST | Fingerprint fallback |
| `/qr-verify` | POST | Guest QR token validation |
| `/manual-override` | POST | Log guard manual gate open |
| `/detect-uniform` | POST | Uniform detection only |
| `/sync-now` | POST | Force cloud sync |

Key `config.py` flags:

```python
BRAIN_API_GATE_CONTROL_ENABLED = False  # Set True if brain_api.py owns the servo
```

## File Structure

```
raspberry-pi/
├── main.py              # Continuous gate loop (camera + RFID + fingerprint)
├── brain_api.py         # HTTP API for kiosk/tablet face + QR + override
├── config.py            # All configuration parameters
├── database.py          # SQLite: persons, guest visits, logs, QR tokens
├── face_utils.py        # Face detection & recognition (dlib)
├── uniform_utils.py     # Uniform detection (YOLO11 or color)
├── fingerprint_utils.py # R307 fingerprint sensor
├── rfid_utils.py        # MFRC522 RFID reader
├── gate_controller.py   # MG996R servo & TTS
├── sync_client.py       # Cloud sync (push logs, pull persons/visits/settings)
├── requirements.txt     # Python dependencies
└── README.md            # This file
```

## Access Control Flow

```
Camera Frame
    │
    ▼
┌─────────────┐     ┌──────────────┐
│ Face Detect  │────▶│ Face Match   │
└─────────────┘     └──────────────┘
                          │
                    ┌─────┴─────┐
                    ▼           ▼
              [Matched]    [No Match]
                    │           │
                    ▼           ▼
            ┌──────────┐  ┌─────────────┐
            │ Uniform  │  │ Fingerprint │
            │  Check   │  │  Fallback   │
            └──────────┘  └─────────────┘
                │               │
          ┌─────┴────┐    ┌────┴────┐
          ▼          ▼    ▼         ▼
       [Pass]     [Fail] [Match] [Fail]
          │          │      │       │
          ▼          ▼      ▼       ▼
      GATE OPEN   DENIED  GATE   DENIED
                          OPEN

    RFID Card ──▶ UID Lookup ──▶ GATE OPEN / DENIED
```

## Deploying to Raspberry Pi

1. Flash Raspberry Pi OS (64-bit) to SD card
2. Enable SPI (for MFRC522) and Serial (for R307) via `raspi-config`
3. Clone this directory to the Pi
4. Install system dependencies:
   ```bash
   sudo apt update
   sudo apt install python3-pip python3-venv cmake libatlas-base-dev
   ```
5. Install Python packages:
   ```bash
   pip install -r requirements.txt
   pip install RPi.GPIO mfrc522 pyfingerprint
   ```
6. Set `SIMULATION_MODE = False` in `config.py`
7. Configure GPIO pins in `config.py`
8. Run: `python main.py`

## Auto-Start on Boot

Create a systemd service:

```ini
# /etc/systemd/system/smart-gate.service
[Unit]
Description=Smart Gate System
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/smart-gate-system/raspberry-pi
ExecStart=/home/pi/smart-gate-system/raspberry-pi/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable smart-gate
sudo systemctl start smart-gate
```
