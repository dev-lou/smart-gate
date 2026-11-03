# System Architecture

## Overview

The Smart Gate System uses a **distributed edge + cloud architecture** where all AI
inference runs **in the browser** on a tablet. There is no server-side AI, no Python
backend, and no Raspberry Pi. Three tiers:

1. **Edge** — the tablet kiosk: detection, recognition, confirmation, policy, decision, log.
2. **Cloud** — Supabase: records, enrolment photos, staff auth, kiosk health, briefing cache.
3. **Control** — the ESP32: one servo, its own hotspot, and a button.

```
┌──────────────────────────────────────────────────────────────────┐
│                   1. EDGE LAYER (Tablet Kiosk)                    │
│                                                                  │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │ Camera feed  │──►│ MediaPipe face   │──►│ ArcFace ONNX     │  │
│  │ (environment)│   │ detector (WASM)  │   │ (Web Worker)     │  │
│  └──────────────┘   └──────────────────┘   └────────┬─────────┘  │
│                                                     │            │
│                          ┌──────────────────┐       │            │
│                          │ Confirmation +   │◄──────┘            │
│                          │ policy (5 reads, │                    │
│                          │ 0.08 margin)     │                    │
│                          └────────┬─────────┘                    │
│                                   │                              │
│                          ┌────────▼─────────┐                    │
│                          │ Access decision  │                    │
│                          │ + audit logging  │                    │
│                          └────────┬─────────┘                    │
│                                   │                              │
│                    ┌──────────────▼───────────────┐              │
│                    │ IndexedDB                     │              │
│                    │ • students + embeddings       │              │
│                    │ • access logs (offline queue) │              │
│                    │ • settings                    │              │
│                    └──────────────┬───────────────┘              │
└───────────────────────────────────┼──────────────────────────────┘
                                    │ HTTPS sync
┌───────────────────────────────────┼──────────────────────────────┐
│                   2. CLOUD LAYER (Supabase)                      │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐    │
│  │ PostgreSQL       │  │ Storage          │  │ Auth         │    │
│  │ • students       │  │ (student-photos) │  │ (anon key)   │    │
│  │ • guests         │  │                  │  │              │    │
│  │ • access_logs    │  │                  │  │              │    │
│  │ • system_settings│  │                  │  │              │    │
│  │ • daily_briefings│  │                  │  │              │    │
│  └──────────────────┘  └──────────────────┘  └──────────────┘    │
└───────────────────────────────────┼──────────────────────────────┘
                                    │
┌───────────────────────────────────┼──────────────────────────────┐
│                   3. WEB LAYER (Vercel)                          │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐    │
│  │ Admin dashboard  │  │ Guard station    │  │ Kiosk PWA    │    │
│  │ (3000)           │  │ (3001)           │  │ (3002)       │    │
│  │ • auth           │  │ • 5-angle enrol  │  │ • face AI    │    │
│  │ • logs, health   │  │ • guest passes   │  │ • policy     │    │
│  │ • AI briefing    │  │ • recent enrols  │  │ • gate ctrl  │    │
│  └──────────────────┘  └──────────────────┘  └──────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

## AI Pipeline (In-Browser)

```
Every 3rd video frame
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│ 1. FACE DETECTION (main thread)                          │
│    MediaPipe Tasks Vision · BlazeFace short range (WASM)  │
│    Output: bounding boxes, normalised 0-1                 │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 2. CROP + PREPROCESS (main thread)                       │
│    Crop face region → resize 112×112                      │
│    Normalisation: (pixel - 127.5) / 127.5                 │
└────────────────────────┬─────────────────────────────────┘
                         │ postMessage
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 3. EMBEDDING (web worker)                                │
│    ONNX Runtime Web · WebGPU → WebGL → WASM fallback      │
│    ArcFace w600k_mbf → 512-dim, L2-normalised             │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 4. MATCH (main thread)                                   │
│    Cosine similarity vs EVERY enrolled angle (5/student)  │
│    Best score wins; floor 0.70                            │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 5. CONFIRMATION                                          │
│    5 consecutive reads for the SAME identity (~2.5s)      │
│    Winner must lead runner-up by 0.08                     │
│    Otherwise: unknown face, no decision, no log           │
└────────────────────────┬─────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 6. POLICY + DECISION                                     │
│    lockdown_mode        → deny (LOCKDOWN_ACTIVE)          │
│    guest pass expired   → deny (GUEST_EXPIRED)            │
│    confirmed face       → grant (POLICY_PASS /            │
│                            GUEST_PASS_VALID)              │
│    Gate command → wait for S:OPEN → log open/unconfirmed  │
│    Row (reason_code + decision_note) → IndexedDB         │
└──────────────────────────────────────────────────────────┘
```

### Why confirmation exists

One hot frame is not a verdict. Field observation showed motion-blurred frames
scoring ~0.61 for the wrong student, so a single-frame match could grant access
to a lookalike. The confirmation gate requires the same identity to win five
consecutive ticks and to stand clear of the runner-up; the real student confirms
in about 2.5 seconds of holding still, while a stranger flickering between
identities never does.

## Web Worker Architecture

A single shared Web Worker handles all ONNX inference, so the camera preview
never stalls and only one runtime is loaded.

```
┌─────────────────────────────────────────────────────────────┐
│                    MAIN THREAD                               │
│                                                             │
│  face.ts ──sendToWorker("get_embedding", data)──►           │
│  workerManager.ts ─── worker.postMessage(msg) ───►          │
└──────────────────────────────────────┬──────────────────────┘
                                       │
┌──────────────────────────────────────┼──────────────────────┐
│                 WEB WORKER THREAD    ▼                      │
│                                                             │
│  inference.worker.ts ── onmessage ──► switch(type)          │
│                                                             │
│  Session (loaded once, reused):                             │
│  ┌─────────────────────┐                                    │
│  │ faceSession         │  ArcFace w600k_mbf                │
│  │ 512-dim embeddings  │  Execution: WebGPU                │
│  └─────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Student / Guest Enrolment

```
Guard opens Guard Station (3001)
        │
        ▼
1. Fill details (name, ID, course, year, section) or guest (host, valid_until)
        │
        ▼
2. Capture 5 photos (front, left 45°, right 45°, and two more angles)
        │
        ▼
3. Upload 5 JPEGs to Supabase Storage (bucket: student-photos)
        │
        ▼
4. Record created in Supabase (photo_url = JSON array)
        │
        ▼
5. Kiosk sync downloads the record
        │
        ▼
6. Kiosk generates one ArcFace embedding per photo
        │
        ▼
7. Student or guest ready for recognition
```

### Access Grant Flow

```
Person approaches the kiosk camera
        │
        ▼
1. Frame captured (every 3rd frame)
        │
        ▼
2. MediaPipe detects the face
        │
        ▼
3. Crop → 112×112 → Web Worker → 512-dim embedding
        │
        ▼
4. Cosine similarity against all enrolled embeddings
        │
        ▼
5. Confirmation: 5 matching reads + 0.08 margin?
        │                                   │
       no                                 yes
        │                                   │
        ▼                                   ▼
  unknown face (soft beep),        6. Policy check
  no decision, no log                 lockdown → deny
                                      guest expired → deny
                                      otherwise → grant
                                            │
                                            ▼
                                 7. Gate command → S:OPEN
                                    log with reason_code
```

### Sync Flow (IndexedDB ↔ Supabase)

```
Background sync (on init + online event)
        │
        ▼
1. Check connectivity
        ▼
2. Download students, guests, settings (parallel)
        ▼
3. Store in IndexedDB; generate embeddings for new photos
        ▼
4. Upload unsynced access logs (batches of 50, sync_id idempotent)
        ▼
5. Mark uploaded logs as synced
        ▼
6. Reload enrolled faces from IndexedDB
```

## Gate Control

```
Kiosk ──► ESP32 (SoftAP SmartGate-Gate1, ws://192.168.4.1:81)
      ──► Arduino Uno over USB serial (fallback)
```

| Direction | Message | Meaning |
|-----------|---------|---------|
| Browser → gate | `O` | Open |
| Browser → gate | `C` | Close |
| Browser → gate | `S` | Status query |
| Gate → browser | `R` | Ready |
| Gate → browser | `K` | Acknowledged |
| Gate → browser | `B` | Physical button pressed |
| Gate → browser | `S:IDLE` / `S:OPENING` / `S:OPEN` / `S:CLOSING` / `S:ERROR` | State report |

The kiosk does not trust an open command. It waits for `S:OPEN` and reports one
of three outcomes:

- **OPEN** — the controller confirmed the barrier released (`gate_state: open`)
- **AWAITING** — a controller is linked but has not confirmed (`unconfirmed`)
- **SENT** — no controller linked, demo mode (`simulated`)

Reporting a silent command as success made an unwired gate look like a working
one; the three-state model removes that ambiguity from the UI and the log.

## Security Model

| Layer | Measure |
|-------|---------|
| **Supabase** | Row Level Security (RLS) policies per table |
| **Supabase Auth** | Staff sessions for Guard and Dashboard writes |
| **Decision policy** | Lockdown and guest expiry evaluated before any grant |
| **Offline** | IndexedDB scoped to the browser origin |
| **Gate** | Local hotspot with WPA2; no internet exposure |
| **Camera** | Browser permission prompt, unlocked by Tap-to-Start |
| **Service Worker** | HTTPS-only registration |
| **AI key** | `GEMINI_API_KEY` is server-side only (dashboard route) |

## Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Face detection | < 10 ms | ~5 ms (MediaPipe WASM) |
| Face recognition | < 100 ms | ~30–50 ms (WebGPU) |
| Full pipeline | < 500 ms | ~200–300 ms |
| Camera FPS | 30 | every 3rd frame is processed |
| Embedding dim | 512 | 512 (ArcFace) |
| Confirmation | ~2.5 s | 5 consecutive reads |
| Cold start | < 10 s | ~3–5 s (model download, then cached) |

## Dependencies

```
kiosk ─┬─ @mediapipe/tasks-vision    Face detection (WASM)
       ├─ onnxruntime-web            AI inference engine
       ├─ @supabase/supabase-js      Cloud sync
       ├─ idb                        IndexedDB wrapper
       ├─ next + react               Frontend framework
       └─ tailwindcss                Styling

guard ─┬─ @supabase/supabase-js      Cloud storage
       ├─ next + react               Frontend framework
       └─ tailwindcss                Styling

dashboard ─┬─ @supabase/supabase-js  Cloud operations
           ├─ next + react           Frontend framework
           └─ tailwindcss            Styling
```

## CI/CD Pipeline

```
Push/PR
   │
   ▼
1. Prettier check (blocking) + ESLint (informational)
2. TypeScript check — dashboard, guard, kiosk (3 parallel jobs)
3. Build — dashboard, guard, kiosk (3 parallel jobs)
4. Unit tests — vitest, 83 tests
5. Deploy (gated) — 3 Vercel projects
   Weekly: CodeQL security scan
```
