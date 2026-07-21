# System Architecture

## Overview

The Smart Gate System uses a **distributed edge + cloud architecture** where all AI inference runs **in the browser** on a tablet device. There is no server-side AI, no Python backend, and no Raspberry Pi. The system follows a three-tier design:

```
┌──────────────────────────────────────────────────────────────────┐
│                   1. EDGE LAYER (Tablet Kiosk)                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Camera Feed  │  │  MediaPipe Face  │  │  ArcFace ONNX    │  │
│  │  (facingMode  │──►  Detector        │──►  Face Recognizer │  │
│  │   =environment)│  │  (WASM)         │  │  (Web Worker)    │  │
│  └──────────────┘  └──────────────────┘  └────────┬─────────┘  │
│                                                   │             │
│                          ┌──────────────────┐     │             │
│                          │  YOLO11n Uniform  │◄────┘             │
│                          │  Detector (Worker)│                   │
│                          └────────┬─────────┘                   │
│                                   │                             │
│                          ┌────────▼─────────┐                   │
│                          │  Access Decision  │                   │
│                          │  + Audit Logging   │                   │
│                          └────────┬─────────┘                   │
│                                   │                             │
│                    ┌───────────────▼───────────────┐            │
│                    │      IndexedDB (idb)           │            │
│                    │  • Students + embeddings      │            │
│                    │  • Access logs (offline queue) │            │
│                    │  • System settings            │            │
│                    └───────────────┬───────────────┘            │
└────────────────────────────────────┼────────────────────────────┘
                                     │ HTTPS Sync
┌────────────────────────────────────┼────────────────────────────┐
│                   2. CLOUD LAYER (Supabase)                      │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   PostgreSQL      │  │   Storage        │  │   Auth       │  │
│  │   • students      │  │   (student-photos)│  │   (anon key) │  │
│  │   • access_logs   │  │                  │  │              │  │
│  │   • system_settings│  │                  │  │              │  │
│  │   • course_uniforms│  │                  │  │              │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└────────────────────────────────────┼────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────┐
│                   3. WEB LAYER (Vercel)                          │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   Admin Dashboard │  │   Guard Station  │  │   Kiosk PWA   │  │
│  │   (port 3000)     │  │   (port 3001)    │  │   (port 3002) │  │
│  │                   │  │                  │  │              │  │
│  │  • Supabase Auth  │  │  • 3-photo       │  │  • Face AI   │  │
│  │  • Login page     │  │  • Camera enroll │  │  • Gate ctrl │  │
│  │                   │  │  • Uniform assign│  │  • Offline    │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## AI Pipeline (In-Browser)

The AI pipeline runs entirely on the tablet's browser, leveraging WebGPU for acceleration:

```
Every 3rd video frame (for performance)
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│  1. FACE DETECTION (Main Thread)                        │
│  ─────────────────────────────────────────────────────  │
│  Library: MediaPipe Tasks Vision                        │
│  Model: BlazeFace Short Range (float16)                 │
│  Format: WASM (WebAssembly)                             │
│  Speed: ~5ms per frame on Android tablet                │
│  Output: Bounding boxes [x, y, w, h] normalized 0-1    │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  2. FACE CROP + PREPROCESS (Main Thread)                 │
│  ─────────────────────────────────────────────────────  │
│  Crop face region from frame                             │
│  Resize to 112×112 (ArcFace spec)                       │
│  Output: RGB pixel data                                  │
└────────────────────────┬─────────────────────────────────┘
                         │ Send to Web Worker
                         ▼
┌──────────────────────────────────────────────────────────┐
│  3. FACE RECOGNITION (Web Worker - Separate Thread)      │
│  ─────────────────────────────────────────────────────  │
│  Engine: ONNX Runtime Web (v1.21.0)                     │
│  Execution: WebGPU → WebGL → WASM (fallback chain)     │
│  Model: ArcFace w600k_mbf (512-dim embeddings)          │
│  Inference: ~30-50ms on WebGPU                          │
│  Normalization: (pixel - 127.5) / 127.5                 │
│  Output: 512-dim L2-normalized embedding                │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  4. FACE MATCHING (Main Thread)                          │
│  ─────────────────────────────────────────────────────  │
│  Cosine similarity against ALL enrolled embeddings      │
│  (3 angles per student: front, left 45°, right 45°)     │
│  Best score wins, threshold: 0.6                        │
│  On match: retrieve student info + course + uniform     │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  5. UNIFORM DETECTION (Web Worker - Optional)            │
│  ─────────────────────────────────────────────────────  │
│  Engine: ONNX Runtime Web                                │
│  Model: YOLO11n (custom-trained, ~6MB ONNX)             │
│  Input: 640×640 body region                              │
│  Post-processing: Non-Maximum Suppression (IoU 0.5)     │
│  Check: detected class matches expected uniform type     │
│  Fallback: color similarity check (no model loaded)     │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│  6. ACCESS DECISION                                      │
│  ─────────────────────────────────────────────────────  │
│  Face matched? + Uniform policy enabled?                 │
│  Check uniform OK? → GRANTED (open gate)                │
│  Face matched + Uniform FAIL → DENIED (log reason)      │
│  Face unknown → Continue scanning                        │
│  All decisions logged to IndexedDB                       │
│  Logs synced to Supabase when online                     │
└──────────────────────────────────────────────────────────┘
```

## Web Worker Architecture

A single shared Web Worker handles all ONNX inference to save memory:

```
┌─────────────────────────────────────────────────────────────┐
│                    MAIN THREAD                               │
│                                                             │
│  face.ts ←─── sendToWorker("get_embedding", data) ───┐     │
│  uniform.ts ←── sendToWorker("yolo_infer", data) ────┤     │
│                                                      │     │
│  workerManager.ts ─── worker.postMessage(msg) ───────┤     │
└──────────────────────────────────────────────────────┼─────┘
                                                       │
┌──────────────────────────────────────────────────────┼─────┐
│                 WEB WORKER THREAD                     │     │
│                                                      ▼     │
│  inference.worker.ts ─── onmessage ─→ switch(type)        │
│                                                             │
│  Sessions (loaded once, reused):                            │
│  ┌─────────────────────┐  ┌──────────────────────┐        │
│  │ faceSession         │  │ yoloSession          │        │
│  │ ArcFace w600k_mbf   │  │ YOLO11n (custom)     │        │
│  │ 512-dim embeddings  │  │ Object detection     │        │
│  │ Execution: WebGPU   │  │ Execution: WebGPU    │        │
│  └─────────────────────┘  └──────────────────────┘        │
│                                                             │
│  Both sessions use the same ONNX Runtime Web WASM binary    │
│  (loaded once from CDN, cached by browser)                 │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Student Enrollment Flow

```
Guard opens Guard Station (port 3001)
        │
        ▼
1. Fill student info (name, ID, course, year, section)
        │
        ▼
2. Capture 3 photos (Front, Left 45°, Right 45°)
        │
        ▼
3. Submit → Supabase Storage (3 JPEG files)
        │
        ▼
4. Student record created in Supabase (photo_urls = JSON array)
        │
        ▼
5. Kiosk syncs → downloads student records
        │
        ▼
6. Kiosk processes each photo → generates 3 ArcFace embeddings
        │
        ▼
7. Student ready for recognition ✓
```

### Access Grant Flow

```
Student approaches kiosk camera
        │
        ▼
1. Camera captures frame (every 3rd frame ≈ 10 FPS)
        │
        ▼
2. MediaPipe detects face bounding box
        │
        ▼
3. Face cropped → resized to 112×112 → sent to Web Worker
        │
        ▼
4. Web Worker runs ArcFace → returns 512-dim embedding
        │
        ▼
5. Compare against all enrolled embeddings (cosine similarity)
        │
        ▼
6. Identity known? → Check uniform policy
   Identity unknown? → Continue scanning
        │
        ▼
7. Uniform check: YOLO11n detects uniform type
        │
        ▼
8. Decision:
   ✅ Face match + Uniform OK → Open gate + log
   ❌ Face match + Uniform FAIL → Deny + log reason
   ❌ No match → Continue scanning
```

### Sync Flow (IndexedDB ↔ Supabase)

```
Background Sync (triggered on init + online event)
        │
        ▼
1. Check Supabase connectivity
        │
        ▼
2. Download students & settings (parallel)
        │
        ▼
3. Download students → store in IndexedDB
        │
        ▼
4. Process new student photos → generate embeddings
        │
        ▼
5. Upload unsynced access logs (batches of 50)
        │
        ▼
6. Mark uploaded logs as synced
        │
        ▼
7. Reload enrolled faces from IndexedDB
```

## Hardware Layer

```
┌────────────────────────────────────────────────────────────┐
│  Arduino Smart Gate Controller                              │
│                                                             │
│  USB-OTG ←→ Tablet (Web Serial API)                        │
│                                                             │
│  State Machine:                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                │
│  │  IDLE   │───►│ ACTIVE  │───►│  OPEN   │                │
│  │         │    │         │    │         │                │
│  │ Wait for│    │ Button  │    │ Servo   │                │
│  │ command │◄───│ pressed │◄───│ rotated │                │
│  └─────────┘    └─────────┘    └─────────┘                │
│                                                             │
│  Serial Protocol:                                           │
│  PC → Arduino: 'O' = open gate                              │
│  PC → Arduino: 'C' = close gate                             │
│  Arduino → PC: 'B' = button press event                     │
│  Arduino → PC: 'R' = ready signal                           │
│  Arduino → PC: 'K' = command acknowledge                    │
└─────────────────────────────────────────────────────────────┘
```

## Security Model

| Layer | Measure |
|-------|---------|
| **Supabase** | Row Level Security (RLS) policies per table |
| **Supabase Auth** | Anon key with RLS for data isolation |
| **CORS** | Vercel handles cross-origin requests |
| **Offline** | IndexedDB scoped to browser origin |
| **Web Serial** | User must click to pair with Arduino |
| **Camera** | Browser permission prompt |
| **Service Worker** | HTTPS-only registration |

## Performance Targets

| Metric | Target | Actual |
|--------|--------|--------|
| Face detection | < 10ms | ~5ms (MediaPipe WASM) |
| Face recognition | < 100ms | ~30-50ms (WebGPU) |
| YOLO inference | < 200ms | ~50-100ms (WebGPU) |
| Full pipeline | < 500ms | ~200-300ms |
| Camera FPS | 30 | Limited to every 3rd frame |
| Embedding dim | 512 | 512 (ArcFace) |
| Match accuracy | > 95% | ~99.4% LFW (ArcFace) |
| Cold start | < 10s | ~3-5s (model download) |

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
Push/PR to main/develop
        │
        ▼
┌─── CI WORKFLOW ──────────────────────────────────┐
│                                                   │
│  1. Lint + Format (1 job)                        │
│     ├─ Prettier check (blocking)                 │
│     └─ ESLint (informational)                    │
│                                                   │
│  2. TypeScript Check (3 parallel jobs)            │
│     ├─ Dashboard tsc --noEmit                    │
│     ├─ Guard tsc --noEmit                        │
│     └─ Kiosk tsc --noEmit                        │
│                                                   │
│  3. Build (3 parallel jobs)                       │
│     ├─ pnpm --filter dashboard build             │
│     ├─ pnpm --filter guard build                 │
│     └─ pnpm --filter kiosk build                 │
│                                                   │
│  4. Unit Tests                                    │
│     └─ vitest run (28 tests)                     │
│                                                   │
│  5. CI Summary (PR comment table)                │
└───────────────────────────────────────────────────┘
        │ Push to main
        ▼
┌─── DEPLOY WORKFLOW ─────────────────────────────┐
│                                                   │
│  1. Check (TypeScript + Build + Test)            │
│                                                   │
│  2. Deploy to Vercel (matrix: 3 services)        │
│     ├─ dashboard.smart-gate.vercel.app           │
│     ├─ guard.smart-gate.vercel.app               │
│     └─ kiosk.smart-gate.vercel.app               │
└───────────────────────────────────────────────────┘
        │ Weekly
        ▼
┌─── CODEQL WORKFLOW ────────────────────────────┐
│  • Security vulnerability scan                  │
│  • security-and-quality queries                 │
│  • JavaScript/TypeScript analysis               │
└──────────────────────────────────────────────────┘
```
