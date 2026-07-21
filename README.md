# Smart Gate System 🏫🔐

> **A 2026 Industry-Standard Smart Gate Access Control System**
>
> Capstone project featuring **in-browser face recognition (ArcFace 99.4% LFW)**, **YOLO11n uniform detection**, and a **tablet kiosk PWA** — all AI runs on-device via Web Worker.
>
> **90% Software / 10% Hardware** — no server-side AI, no Raspberry Pi, no Python.

[![CI](https://github.com/YOUR_USER/smart-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USER/smart-gate/actions/workflows/ci.yml)
[![CodeQL](https://github.com/YOUR_USER/smart-gate/actions/workflows/codeql.yml/badge.svg)](https://github.com/YOUR_USER/smart-gate/actions/workflows/codeql.yml)

---

## System Overview

```
                         ┌────────────────────────────────┐
                         │        SUPABASE CLOUD          │
                         │  PostgreSQL · Auth · Storage   │
                         └────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  📱 KIOSK (PWA)   │      │  🛡️ GUARD STATION │      │  📊 ADMIN        │
│   Port 3002       │      │   Port 3001       │      │   DASHBOARD      │
│                   │      │                   │      │   Port 3000      │
│  • Face detect    │      │  • Camera enroll  │      │                  │
│  • Face recog     │      │  • 3-photo angles │      │  • Auth (login)  │
│  • Uniform check  │      │  • Course/Uniform │      │  • Supabase      │
│  • Gate control   │      │  • Recent enrolls │      │    connected     │
│  • Offline-first  │      └──────────────────┘      │                  │
│  • IndexedDB sync │                                 └──────────────────┘
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ARDUINO (USB)   │  ← 10% Hardware
│  Servo Motor     │
│  Button (manual) │
└──────────────────┘
```

## What Makes This System Different

| Traditional Smart Gate | Smart Gate (This Project) |
|------------------------|---------------------------|
| Server-side AI (GPU server or Raspberry Pi) | **In-browser AI** via Web Worker (no server needed) |
| Python + OpenCV + dlib | **TypeScript + MediaPipe + ONNX Runtime Web** |
| Requires constant internet | **Offline-first** — full AI works without internet |
| Heavy hardware (RPi + camera + wiring) | **Just a tablet + Arduino** (USB-OTG) |
| Separate Python backend | **Zero backend** — all logic in the browser |
| Single monolith | **3 independent services** on Vercel |

## Tech Stack (2026)

| Technology | Purpose | Why |
|-----------|---------|-----|
| **Next.js 16** | Frontend framework | Industry standard, App Router, PWA support |
| **TypeScript** | Language | Type safety across all 3 services |
| **pnpm** | Package manager | Fast, disk-efficient monorepo |
| **Turborepo** | Task orchestration | Cached builds, parallel execution |
| **Supabase** | Cloud database | PostgreSQL, Auth, Storage, Realtime |
| **IndexedDB (idb)** | Offline storage | Full offline face recognition |
| **MediaPipe Tasks Vision** | Face detection | Fastest WASM face detector (~5ms per frame) |
| **ArcFace + ONNX** | Face recognition | **99.4% LFW accuracy**, in-browser with WebGPU |
| **YOLO11n + ONNX** | Uniform detection | Custom-trained on your uniforms |
| **ONNX Runtime Web** | AI inference engine | Runs ONNX models in browser via Web Worker |
| **Web Serial API** | Hardware communication | Arduino control from browser (USB-OTG) |
| **Tailwind CSS** | Styling | Utility-first, consistent design across services |
| **Vercel** | Deployment | Free tier, native Next.js support |

## Quick Start

### Prerequisites
- Node.js 20+ with **pnpm 9+**
- Android tablet with Chrome (or any device with camera)
- Supabase account (free tier)
- Arduino Uno + Servo + Button (optional — simulation mode works)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USER/smart-gate.git
cd smart-gate
pnpm install
```

### 2. Set Up Supabase

1. Create a [Supabase](https://supabase.com) project
2. Go to **SQL Editor** → run `database/schema.sql`
3. Run **all migrations** in `database/migrations/` in order:
   - `002_uniform_types.sql` — uniform type definitions
   - `003_add_sync_id.sql` — log idempotency for crash-safe sync
4. Create a **Storage bucket** named `student-photos` (Public)
5. Copy your **Project URL** + **anon key** from Project Settings → API

### 3. Configure Environment

```bash
# Each service needs .env.local with the same Supabase credentials
cp services/kiosk/.env.example services/kiosk/.env.local
cp services/guard/.env.example services/guard/.env.local
cp services/dashboard/.env.example services/dashboard/.env.local
```

Edit each `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run Development

```bash
# Run all 3 services in parallel:
pnpm dev

# Or individually:
pnpm dev:kiosk      # Port 3002 — Tablet Kiosk
pnpm dev:guard      # Port 3001 — Guard Station
pnpm dev:dashboard  # Port 3000 — Admin Dashboard
```

### 5. Open in Browser

| Service | URL | What It Does |
|---------|-----|-------------|
| **Dashboard** | http://localhost:3000 | Login page (Supabase Auth) |
| **Guard Station** | http://localhost:3001 | Enroll students with 3-photo capture |
| **Kiosk** | http://localhost:3002 | Face recognition + uniform detection gate |

## Kiosk Workflow

```
Student approaches gate
        │
        ▼
┌─── FACE DETECTION ──────────────────────┐
│  MediaPipe detects face in camera frame  │
│  Runs every 3rd frame for performance    │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── FACE RECOGNITION ────────────────────┐
│  ArcFace w600k_mbf ONNX → 512-dim embed  │
│  Match against enrolled students         │
│  Cosine similarity threshold: 0.6        │
│  → Identity known + course info          │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── UNIFORM DETECTION ───────────────────┐
│  YOLO11n checks body region via Web Worker│
│  Detected class vs. expected uniform type │
│  Fallback: color-based check             │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── ACCESS DECISION ─────────────────────┐
│  Face match ✅ + Uniform ✅ → Gate opens │
│  Face match ✅ + Uniform ❌ → Denied     │
│  Face ❌ → Continue scanning             │
│  All events logged to IndexedDB         │
│  Synced to Supabase when online         │
└─────────────────────────────────────────┘
```

## Monorepo Structure

```
smart-gate/
├── .editorconfig                # Editor settings (spaces, UTF-8, LF)
├── .gitignore                   # Clean ignores (Node, env, IDE, ONNX)
├── .npmrc                       # npm/pnpm config
├── .prettierrc                  # Formatter settings
├── turbo.json                   # Turborepo pipeline config
├── pnpm-workspace.yaml          # pnpm workspace definition
├── package.json                 # Root — shared scripts & devDeps
│
├── .github/
│   ├── workflows/               # CI/CD pipelines
│   │   ├── ci.yml               # Matrix CI (lint → typecheck → build → test)
│   │   ├── deploy.yml           # Gated deploy to Vercel
│   │   └── codeql.yml           # Weekly security scan
│   ├── dependabot.yml           # Automated dependency updates
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
│
├── services/
│   ├── kiosk/                   # 📱 Tablet Kiosk PWA (port 3002)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx     # Main kiosk UI + AI loop
│   │   │   │   ├── layout.tsx   # PWA metadata + ErrorBoundary
│   │   │   │   └── globals.css  # Kiosk-specific styles
│   │   │   ├── components/
│   │   │   │   └── ErrorBoundary.tsx  # Crash recovery UI
│   │   │   └── lib/
│   │   │       ├── face.ts      # MediaPipe + ArcFace integration
│   │   │       ├── uniform.ts   # YOLO11n uniform detection
│   │   │       ├── arduino.ts   # Web Serial API gate control
│   │   │       ├── db.ts        # IndexedDB offline storage
│   │   │       ├── supabase.ts  # Cloud sync module
│   │   │       ├── inference.worker.ts  # ONNX Runtime Web Worker
│   │   │       ├── workerManager.ts     # Shared worker singleton
│   │   │       └── __tests__/
│   │   │           └── pure-functions.test.ts  # 28 unit tests
│   │   ├── public/
│   │   │   ├── sw.js            # Service Worker for offline PWA
│   │   │   ├── manifest.json    # PWA manifest
│   │   │   ├── icon-192.png     # PWA icons
│   │   │   ├── icon-192.svg
│   │   │   ├── icon-512.png
│   │   │   └── icon-512.svg
│   │   ├── vitest.config.ts
│   │   └── .env.example
│   │
│   ├── guard/                   # 🛡️ Guard Station (port 3001)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx     # 3-photo enrollment + student form
│   │   │   │   ├── layout.tsx   # Root layout
│   │   │   │   └── globals.css  # Shared styles
│   │   │   └── lib/
│   │   │       └── supabase.ts  # Supabase client
│   │   └── .env.example
│   │
│   └── dashboard/               # 📊 Admin Dashboard (port 3000)
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx     # Redirects to /login
│       │   │   ├── layout.tsx   # Root layout
│       │   │   ├── login/
│       │   │   │   └── page.tsx # Supabase Auth login
│       │   │   └── globals.css  # Shared styles
│       │   └── lib/
│       │       └── supabase.ts  # Supabase client
│       └── .env.example
│
├── database/
│   ├── schema.sql               # Full PostgreSQL schema
│   └── migrations/
│       ├── 002_uniform_types.sql    # Uniform type definitions
│       └── 003_add_sync_id.sql      # Log idempotency (crash-safe sync)
│
├── hardware/
│   └── arduino/
│       └── smart_gate.ino       # Arduino firmware (state machine)
│
├── docs/
│   ├── CAPSTONE_REPORT.html     # Comprehensive technical report
│   ├── ARCHITECTURE.md          # Architecture documentation
│   ├── SETUP.md                 # Setup guide
│   ├── API.md                   # API reference
│   ├── uniform-training.html    # YOLO training visual guide
│   └── UNIFORM_TRAINING.md      # YOLO training guide (markdown)
│
├── turbo.json                   # Turborepo pipeline config
├── .prettierrc                  # Formatting rules
├── .editorconfig                # Editor defaults
├── .gitignore                   # Project ignores
└── package.json                 # Root workspace config
```

## What Each Service Does

### 📱 Kiosk (Port 3002)
The core of the system — runs on a tablet mounted at the gate entrance. Fully offline-capable PWA that:
- Opens the camera in full-screen kiosk mode
- Detects faces via **MediaPipe Tasks Vision** (WASM)
- Recognizes faces via **ArcFace ONNX** (99.4% LFW, WebGPU accelerated)
- Checks uniforms via **YOLO11n ONNX** (custom-trained, runs in Web Worker)
- Controls gate via **Web Serial API** (Arduino USB-OTG)
- Logs all access attempts to **IndexedDB** — syncs to Supabase when online
- Single-page app with no routing — optimized for tablet kiosk use

### 🛡️ Guard Station (Port 3001)
Enrollment interface for security guards to register students:
- **3-photo capture** — Front, Left 45°, Right 45° for best recognition accuracy
- Student information form (name, student ID, course, year, section)
- Course-based uniform type selection
- Syncs photos to **Supabase Storage** and creates student records
- Recent enrollments feed for quick verification

### 📊 Admin Dashboard (Port 3000)
Simple login portal for administrators:
- **Supabase Auth** login page
- Scaffolded for future expansion (student management, logs, settings)
- Authenticates administrators via Supabase Auth

## Hardware

| Component | Purpose | Connection |
|-----------|---------|-----------|
| **Arduino Uno** | Gate controller | USB-OTG to tablet |
| **Servo Motor** (pin 9) | Opens/closes gate | PWM control |
| **Physical Button** (pin 2) | Manual override | Pull-down resistor |
| **LED** (built-in) | Status indicator | Blink patterns |

**Protocol:** Serial (9600 baud) — commands: `O` = open, `C` = close, `S` = status query

**Firmware:** `hardware/arduino/smart_gate.ino` — state machine with debounced button, auto-close timer (5s), and auto-reconnect support.

## Deployment

Each service deploys independently to **Vercel**:

| Service | Vercel Project | Root Directory |
|---------|---------------|----------------|
| Kiosk | `smart-gate-kiosk` | `services/kiosk` |
| Guard | `smart-gate-guard` | `services/guard` |
| Dashboard | `smart-gate-dashboard` | `services/dashboard` |

Set the following environment variables in each Vercel project:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### CI/CD Pipelines

- **CI** (`ci.yml`): Runs on every push/PR — Prettier → TypeScript (all 3) → Build (all 3) → Tests (28 unit tests)
- **Deploy** (`deploy.yml`): Gated by checks — manual dispatch with per-service selection
- **CodeQL** (`codeql.yml`): Weekly security vulnerability scan
- **Dependabot**: Weekly automated dependency PRs

## Sync Architecture

``` 
Offline (Tablet)            Online (Connected)
┌──────────────────┐       ┌────────────────────┐
│  IndexedDB        │       │      Supabase      │
│  ┌────────────┐   │       │  ┌──────────────┐  │
│  │ Students    │──┼──sync──┼─▶│ students     │  │
│  │ (embeddings)│   │       │  │ (with photos)│  │
│  ├────────────┤   │       │  ├──────────────┤  │
│  │ Logs       │──┼──sync──┼─▶│ access_logs  │  │
│  │ (queued)   │   │       │  │ (dedup via   │  │
│  ├────────────┤   │       │  │  sync_id)    │  │
│  │ Settings   │──┼──sync──┼─▶│ settings     │  │
│  └────────────┘   │       │  └──────────────┘  │
│                   │       │                     │
│  Models cached    │       │  ArcFace + YOLO     │
│  in Cache API    │       │  models hosted       │
│  (SW managed)    │       │  on HuggingFace/CDN  │
└──────────────────┘       └─────────────────────┘
```

## Training the Uniform Model

See **[docs/uniform-training.html](docs/uniform-training.html)** for the complete visual guide.

**Quick steps:**
1. Take 100+ photos per uniform type
2. Label on [Roboflow](https://roboflow.com) (free tier)
3. Export in YOLO11 format
4. Convert to ONNX
5. Upload to Vercel project or CDN
6. Update `YOLO_MODEL_URL` in kiosk config

## Key Design Principles

- **90% Software / 10% Hardware** — AI runs in the browser, not on a server
- **Offline-First** — Full face recognition + uniform detection without internet
- **In-Browser AI** — MediaPipe + ONNX Runtime Web via Web Worker
- **Single Shared Worker** — One Web Worker for all ONNX inference (memory-efficient)
- **3-Photo Enrollment** — Front, left 45°, right 45° for best recognition accuracy (ArcFace)
- **WebGPU Acceleration** — GPU inference when available, falls back to WebGL → WASM
- **Crash-Safe Sync** — Idempotency keys prevent duplicate logs; 30s timeout guards against sync deadlocks
- **Graceful Degradation** — YOLO model not loaded? Falls back to color check. Arduino disconnected? Shows warning.
- **Audit Trail** — Every access attempt logged, synced to cloud when online

## Development

```bash
# Format code
pnpm format

# Type-check all services
pnpm typecheck

# Build all services
pnpm build

# Run tests (kiosk)
cd services/kiosk && npx vitest run
```

## License

Developed for academic purposes as a capstone project.
