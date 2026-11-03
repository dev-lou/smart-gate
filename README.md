# Smart Gate System 🏫🔐

> **A 2026 Industry-Standard Smart Gate Access Control System**
>
> Capstone project featuring **in-browser face recognition (ArcFace, 512-d embeddings)**, **guest e-pass + lockdown policy**, and a **tablet kiosk PWA** — the AI runs on-device via Web Worker.
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
│  • Face recog     │      │  • 5 photo angles │      │  • Auth (login)  │
│  • Confirm + policy│     │  • Student/guest  │      │  • Access logs   │
│  • Gate control   │      │  • Recent enrolls │      │  • Kiosk health  │
│  • Offline-first  │      │                   │      │  • ID QR codes   │
│  • IndexedDB sync │      └──────────────────┘      └──────────────────┘
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ESP32 (Wi-Fi)    │  ← 10% Hardware
│  Servo · Button   │    (Arduino over USB = fallback)
└──────────────────┘
```

## What Makes This System Different

| Traditional Smart Gate | Smart Gate (This Project) |
|------------------------|---------------------------|
| Server-side AI (GPU server or Raspberry Pi) | **In-browser AI** via Web Worker (no server needed) |
| Python + OpenCV + dlib | **TypeScript + MediaPipe + ONNX Runtime Web** |
| Requires constant internet | **Offline-first** — recognition and decisions work without internet |
| Heavy hardware (RPi + camera + wiring) | **Just a tablet + microcontroller** |
| Separate Python backend | **Zero backend** — all logic in the browser |
| One decision per scan, no policy layer | **Guest e-pass, lockdown, explainable reason codes** |

## Tech Stack (2026)

| Technology | Purpose | Why |
|-----------|---------|-----|
| **Next.js 16** | Frontend framework | App Router, PWA support |
| **TypeScript** | Language | Type safety across all 3 services |
| **pnpm** | Package manager | Fast, disk-efficient monorepo |
| **Turborepo** | Task orchestration | Cached builds, parallel execution |
| **Supabase** | Cloud database | PostgreSQL, Auth, Storage |
| **IndexedDB (idb)** | Offline storage | Queue decisions and logs offline |
| **MediaPipe Tasks Vision** | Face detection | Fast WASM face detector |
| **ArcFace + ONNX** | Face recognition | 512-d embeddings, in-browser |
| **ONNX Runtime Web** | AI inference engine | WebGPU → WebGL → WASM fallback |
| **ESP32 Wi-Fi (WebSocket)** | Gate control (primary) | Tablet ↔ ESP32 over its own hotspot |
| **Web Serial API** | Gate control (fallback) | Arduino via USB-OTG |
| **WebAudio + MP3** | Kiosk voice | Offline voice lines, no TTS dependency |
| **Tailwind CSS** | Styling | Consistent UI across services |
| **Vercel** | Deployment | Native Next.js support |

## Quick Start

### Prerequisites
- Node.js 20+ with **pnpm 9+**
- Android tablet with Chrome (or any device with camera)
- Supabase account (free tier)
- ESP32 DevKit V1 (WROOM-32) + Servo + Button **(recommended)**
- Or Arduino Uno + Servo + Button (fallback — Web Serial)
- No hardware at all works too (simulation mode)

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USER/smart-gate.git
cd smart-gate
pnpm install
```

### 2. Set Up Supabase
1. Create a [Supabase](https://supabase.com) project
2. In **SQL Editor**, run `database/schema.sql`
3. Then apply the migrations in `database/migrations/` in numeric order (any you
   have not already run). The current set includes:
   - `003` — log idempotency for crash-safe sync
   - `006` — compatibility + secure authenticated writes
   - `007` — gate feedback (`gate_state`) + `kiosk_heartbeats`
   - `008` — Storage policies for Guard photo upload (**required**)
   - `009` — school branding + kiosk voice toggle
   - `014` — face-match threshold raised to 0.70
   - `015` — guest e-pass fields, lockdown mode, explainable decision columns
   - `018` — school-ID QR fallback + face-match threshold floor

   > ✅ **Verify what the live database actually has:** paste `database/verify.sql`
   > into the SQL Editor — one paste returns a PASS/FAIL row per migration.
   > Then run `pnpm preflight` for a live anon-key audit.
4. Create a **Storage bucket** named `student-photos` (Public)
5. Copy your **Project URL** + **anon key** from Project Settings → API

### 3. Configure Environment
```bash
cp services/kiosk/.env.example services/kiosk/.env.local
cp services/guard/.env.example services/guard/.env.local
cp services/dashboard/.env.example services/dashboard/.env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run Development
```bash
pnpm dev            # all 3 services
pnpm dev:kiosk      # Port 3002
pnpm dev:guard      # Port 3001
pnpm dev:dashboard  # Port 3000
```

## Kiosk Workflow

```
Student approaches gate
        │
        ▼
┌─── FACE DETECTION ──────────────────────┐
│  MediaPipe detects a face every 3rd frame│
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── FACE RECOGNITION ────────────────────┐
│  ArcFace w600k_mbf → 512-dim embedding   │
│  Cosine similarity vs every enrolled angle│
│  Floor: 0.70                             │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── CONFIRMATION ────────────────────────┐
│  5 consecutive matching reads (~2.5 s)   │
│  Winner must lead the runner-up by 0.08  │
│  Otherwise → unknown face, no decision   │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── POLICY ──────────────────────────────┐
│  Lockdown active?        → deny          │
│  Guest pass expired?     → deny          │
│  Student face match      → grant         │
│  Every outcome gets a reason code        │
└────────────────┬─────────────────────────┘
                 │
                 ▼
┌─── GATE + LOG ──────────────────────────┐
│  Command ESP32, wait for S:OPEN          │
│  Log OPEN / AWAITING / SENT honestly     │
│  IndexedDB row → syncs when online       │
└──────────────────────────────────────────┘
```

## Policy Model

The gate grants on **face match + policy**, not on appearance:

| Rule | Behaviour |
|------|-----------|
| **Lockdown** | `lockdown_mode = true` denies everyone with `LOCKDOWN_ACTIVE`; manual guard override still works |
| **Guest e-pass** | Guests are enrolled with a host and an expiry; an expired pass is denied with `GUEST_EXPIRED` |
| **Students** | A confirmed face match is the whole check, logged as `POLICY_PASS` |
| **Explainability** | Every row carries `reason_code` + `decision_note` the guard can read |

## Monorepo Structure

```
smart-gate/
├── services/
│   ├── kiosk/                   # 📱 Tablet Kiosk PWA (port 3002)
│   │   ├── src/app/page.tsx     # Main kiosk UI + recognition loop
│   │   ├── src/lib/
│   │   │   ├── face.ts          # MediaPipe + ArcFace
│   │   │   ├── scanPolicy.ts    # Confirmation, re-arm, gate outcomes
│   │   │   ├── gate.ts          # Unified gate layer (Wi-Fi first, USB fallback)
│   │   │   ├── gateWs.ts        # ESP32 WebSocket transport
│   │   │   ├── arduino.ts       # Arduino Web Serial transport
│   │   │   ├── heartbeat.ts     # Kiosk health (every 60s)
│   │   │   ├── voice.ts         # Offline chimes + voice lines
│   │   │   ├── db.ts            # IndexedDB offline storage
│   │   │   ├── supabase.ts      # Cloud sync
│   │   │   └── inference.worker.ts
│   │   └── public/audio/        # welcome.mp3, denied.mp3, override.mp3
│   ├── guard/                   # 🛡️ Guard Station (port 3001) — 5-angle enrollment
│   └── dashboard/               # 📊 Admin (port 3000) — logs, health, reports, QR codes
├── database/
│   ├── schema.sql
│   └── migrations/              # 003 → 017
├── hardware/
│   ├── esp32/smart_gate_esp32.ino   # primary: SoftAP + WebSocket
│   └── arduino/smart_gate.ino       # fallback: USB serial
└── docs/
    ├── ARCHITECTURE.md  ·  API.md  ·  SETUP.md
    ├── DEMO_RUNBOOK.md  ·  CHAPTER_IV_RESULTS.md
    └── Smart_Gate_Defense.pptx      # defense deck
```

## What Each Service Does

### 📱 Kiosk (Port 3002)
- Full-screen camera kiosk with **Tap-to-Start** (unlocks camera + audio in one gesture)
- **MediaPipe** face detection, **ArcFace** 512-d recognition in a shared Web Worker
- **Confirmation gate**: 5 consecutive reads + 0.08 margin before any decision
- **Policy**: lockdown, guest-pass expiry, student match — each with a reason code
- **Gate feedback loop** — waits for `S:OPEN` before claiming the gate opened
- **Voice** — synthesized chimes plus offline MP3 lines, with device TTS fallback
- **Privacy-safe public screen** — no names or scores shown at the gate
- **Operator Panel** behind a gear icon: FPS, sync, models, gate state, bind gate, voice, reboot
- **Offline queue** — decisions queue in IndexedDB and sync when online
- **Heartbeat** every 60s for the dashboard's kiosk-health view
- Mobile-first layout for the mounted tablet

### 🛡️ Guard Station (Port 3001)
- Enrol students with **5 photo angles** (front, left 45°, right 45°, plus two more)
- Capture guest e-passes with host name and expiry
- Syncs photos to Supabase Storage and creates student/guest records

### 📊 Admin Dashboard (Port 3000)
- Supabase Auth login
- Access logs with plain-language decision text and reason codes
- Student management, kiosk health, settings
- **School-ID QR** per student (auto-generated, printable) — scanned as the fallback when a face cannot be recognised

## Hardware

| Component | Purpose | Connection |
|-----------|---------|-----------|
| **ESP32 DevKit V1** (recommended) | Gate controller over Wi-Fi | Tablet joins `SmartGate-Gate1` → `ws://192.168.4.1:81` |
| **Arduino Uno** (fallback) | Gate controller over USB | USB-OTG (Web Serial) |
| **Servo Motor** | Opens/closes gate | PWM (ESP32 GPIO 13 / Uno pin 9) |
| **Physical Button** | Manual override | ESP32 GPIO 4 / Uno pin 2 |
| **LED** (built-in) | Status indicator | Blink patterns |
| **Phone charger + USB cable** | Powers the ESP32 | Any 5V charger |

**Protocol (both transports):** `O` = open, `C` = close, `S` = status query; events `R` = ready, `K` = ack, `B` = button press, `S:IDLE`/`S:OPEN`/… = gate state reports.

## Development

```bash
pnpm format          # Prettier
pnpm typecheck       # TypeScript, all services
pnpm build           # Production build
pnpm preflight       # Audit the live database
cd services/kiosk && npx vitest run   # 83 unit tests
```

The unit suite covers the logic that can be tested without a camera: face matching
maths, the confirmation/re-arm policy, gate message parsing, heartbeat row building,
audio throttling, and log-noise filtering.

## Key Design Principles

- **90% Software / 10% Hardware** — AI runs in the browser, not on a server
- **Offline-first** — recognition, policy and gate control work with the network off
- **One shared Worker** — a single ONNX runtime for all inference
- **One person, one row** — the scanner only re-arms after the gate area is empty
- **Honest states** — the log records `open`, `unconfirmed` or `simulated`, never a guess
- **Explainable denials** — every denial names its reason in a code and a sentence
- **Five-angle enrolment** — more angles, fewer misses
- **Crash-safe sync** — idempotency keys prevent duplicate log rows

## License

Developed for academic purposes as a capstone project.
