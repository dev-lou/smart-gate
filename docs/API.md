# API Reference

The Smart Gate System has **no server-side API** — all AI inference runs in the browser. The system uses three communication channels:

1. **Supabase REST API** — Data sync between services and cloud
2. **Web Serial Protocol** — Communication between kiosk and Arduino
3. **Service Worker Cache API** — Offline model storage

---

## 1. Supabase REST API

All three services (kiosk, guard, dashboard) communicate with Supabase directly using the `@supabase/supabase-js` client. There is no intermediary server.

### Authentication

All requests use the **Supabase anon key** with **Row Level Security (RLS)** policies:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Endpoints (via Supabase Client)

#### Students

```typescript
// Fetch active students (kiosk sync)
const { data } = await supabase
  .from("students")
  .select("*")
  .eq("is_active", true);

// Insert new student (guard enrollment)
const { error } = await supabase
  .from("students")
  .insert({
    name: "Juan Dela Cruz",
    student_id: "2024-001",
    department: "BSIT",
    uniform_type: "cici_male_uniform",
    photo_url: JSON.stringify(["url1.jpg", "url2.jpg", "url3.jpg"]),
    is_active: true,
  });
```

#### Access Logs

```typescript
// Upload unsynced logs (kiosk sync)
const { error } = await supabase
  .from("access_logs")
  .insert(logs);

// Fetch logs (dashboard)
const { data } = await supabase
  .from("access_logs")
  .select("*")
  .order("device_timestamp", { ascending: false })
  .limit(100);
```

#### System Settings

```typescript
// Fetch all settings (kiosk sync)
const { data } = await supabase
  .from("system_settings")
  .select("key, value");

// Update a setting
const { error } = await supabase
  .from("system_settings")
  .upsert({ key: "uniform_detection_enabled", value: "true" });
```

#### Storage (Photos)

```typescript
// Upload student photo (guard enrollment)
const { error } = await supabase.storage
  .from("student-photos")
  .upload(`enrollments/${timestamp}_${studentId}_front.jpg`, file);

// Get public URL
const { data } = supabase.storage
  .from("student-photos")
  .getPublicUrl(photoPath);
```

---

## 2. Gate Control Protocol (Kiosk ↔ Gate Controller)

The kiosk talks to the gate controller over **two interchangeable transports** — same protocol, same semantics:

| Transport | Hardware | Connection |
|-----------|----------|------------|
| **WebSocket (primary)** | ESP32 DevKit V1 | Tablet joins the ESP32's own hotspot (`SmartGate-Gate1`) and connects to `ws://192.168.4.1:81` — no cable, no internet, no broker. Override the address with `NEXT_PUBLIC_GATE_WS_URL`. |
| **Web Serial (fallback)** | Arduino Uno | USB-OTG to tablet, 9600 baud (Chrome/Edge only) |

The kiosk auto-selects: Wi-Fi first, USB fallback (`lib/gate.ts`).

### Commands (Browser → Arduino)

| Command | Byte | Description |
|---------|------|-------------|
| **Open gate** | `O` | Rotates servo from 0° to 90° |
| **Close gate** | `C` | Rotates servo from 90° to 0° |
| **Status query** | `S` | Returns current state (IDLE/OPENING/OPEN/CLOSING) |

### Events (Arduino → Browser)

| Event | Byte | Description |
|-------|------|-------------|
| **Button press** | `B` | Physical override button pressed |
| **Ready** | `R` | Arduino boot complete |
| **Acknowledge** | `K` | Command received and processed |

### State Machine

```
IDLE ───('O')──→ OPENING ───(servo 90°)──→ OPEN
  ↑                                            │
  │                                            │
  └────('C')─────── CLOSING ←───(auto 5s)─────┘
                          │
                          │ (servo 0°)
                          ▼
                        IDLE
```

### Feedback Loop

The kiosk does **not** blindly trust the open command:

1. Kiosk sends `O`, then queries status
2. The controller broadcasts its state on every change (`S:IDLE` → `S:OPENING` → `S:OPEN`)
3. Kiosk waits up to 3s for `S:OPEN` (`confirmGateOpen()`)
4. UI shows **"Gate OPEN — please enter"**; the access log records `gate_state: open` (or `unconfirmed` on timeout)

### JavaScript API

```typescript
// lib/gate.ts — unified gate layer (Wi-Fi first, USB fallback)
import {
  connectToGate, tryAutoConnect, openGate, closeGate,
  confirmGateOpen, onGateEvent, getGateState,
} from "@/lib/gate";

// Auto-connect on boot: ESP32 WebSocket, then Arduino Web Serial
const conn = await tryAutoConnect(); // { connected, transport: "wifi" | "usb" | null }

// Open gate + confirm it physically opened (feedback loop)
await openGate();                    // Sends 'O'
const opened = await confirmGateOpen(3000); // true when S:OPEN received

// Close gate
await closeGate();                   // Sends 'C'

// Live gate state (IDLE / OPENING / OPEN / CLOSING / ERROR)
const state = getGateState();

// Listen for button press (physical override)
onGateEvent((event) => {
  if (event.type === "button_press") {
    console.log("Manual override button pressed");
  }
});
```

---

## 3. Service Worker Cache API

The kiosk PWA uses a Service Worker to cache AI models for offline use.

### Pre-cached Resources

| Resource | Size | Source |
|----------|------|--------|
| MediaPipe WASM runtime | ~4 MB | `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision` |
| ArcFace model (w600k_mbf.onnx) | ~6 MB | `huggingface.co/WePrompt/buffalo_sc` |
| YOLO11n model (when available) | ~6 MB | Configurable URL |

### Cache Strategy

- **AI models**: Cache-first (downloaded once, served from cache)
- **Supabase responses**: Network-first (fresh data when online)
- **Page shell**: Cache-first (instant loading)

---

## 4. Kiosk Internal API (TypeScript)

The kiosk exposes pure functions for the main AI loop:

### Face Module (`lib/face.ts`)

```typescript
initFaceDetector(): Promise<boolean>
  → Loads MediaPipe WASM model

initFaceRecognizer(): Promise<boolean>
  → Downloads ArcFace ONNX → creates inference session

detectFaces(video: HTMLVideoElement, canvas: HTMLCanvasElement): FaceResult[]
  → Returns bounding boxes [{ bbox: [x,y,w,h], confidence }]

getFaceEmbedding(video, bbox, canvas): Float32Array | null
  → Crops face → sends to Web Worker → returns 512-dim embedding

matchFace(embedding, enrolledFaces): MatchResult
  → Cosine similarity against all enrolled → { matched, person, confidence }
```

### Uniform Module (`lib/uniform.ts`)

```typescript
initUniformDetector(): Promise<boolean>
  → Downloads YOLO11n ONNX → creates inference session

checkUniform(video, faceBbox, expectedUniform, canvas): UniformCheckResult
  → YOLO inference (or fail-closed denial if no model is loaded) → { ok, confidence, detail }
```

### Database Module (`lib/db.ts`)

```typescript
getEnrolledFaces(): Promise<EnrolledFace[]>
  → Returns students with embeddings from IndexedDB

addLog(log: AccessLog): Promise<void>
  → Writes access log to IndexedDB (offline queue)

getActiveStudents(): Promise<StoredStudent[]>
  → Returns all active students

getDatabaseStats(): Promise<{ studentCount, logCount, unsyncedCount }>
```

### Sync Module (`lib/supabase.ts`)

```typescript
initSupabase(): void
  → Initializes Supabase client

fullSync(): Promise<SyncStatus>
  → Downloads students → uploads logs → returns { studentsDownloaded, logsUploaded, error }

uploadLogs(): Promise<{ uploaded: number; errors: number }>
  → Uploads unsynced logs in batches of 50
```

### Gate Modules

```typescript
// lib/gate.ts — facade: transport selection + unified events
import { tryAutoConnect, connectToGate, openGate, closeGate, confirmGateOpen, getGateState, onGateEvent, disconnectGate } from "@/lib/gate";

// lib/gateWs.ts — ESP32 WebSocket transport
import { connectWs, disconnectWs, openGateWs, closeGateWs, queryStatusWs, onWsEvent, parseGateMessage, getLastGateState } from "@/lib/gateWs";

// lib/arduino.ts — Arduino Web Serial transport (fallback)
import { connectToArduino, tryAutoConnect, openGate, closeGate, onArduinoEvent, isSerialSupported } from "@/lib/arduino";
```

### Heartbeat Module (`lib/heartbeat.ts`)

```typescript
startHeartbeat(provider: () => HeartbeatInput | Promise<HeartbeatInput>, intervalMs = 60_000)
  → Sends one heartbeat immediately, then every 60s (upsert into kiosk_heartbeats)

stopHeartbeat(): void
  → Stops the loop

// HeartbeatInput: { kioskName, cameraOk, gateConnected, gateState, studentsCount, unsyncedLogs, lastSync, fps, lastError }
```

**`kiosk_heartbeats` table (migration 007):** one row per kiosk (`kiosk_id` PK), updated every 60s. The Dashboard flags a kiosk **OFFLINE** when `updated_at` is older than 90s.

---

## 5. Guard Station Data Flow

The Guard Station does **not** have a backend API. It uses Supabase directly:

```
Guard fills form + captures 3 photos
        │
        ▼
1. Upload 3 JPEG files to Supabase Storage (bucket: student-photos)
        │
        ▼
2. Get public URLs for each photo
        │
        ▼
3. Insert student record with photo_urls (JSON array) into students table
        │
        ▼
4. Kiosk sync picks up new student on next sync
```

---

## 6. IndexedDB Schema (Kiosk Offline Storage)

```typescript
Database: "smart-gate-kiosk" (Version 1)

ObjectStore: "students"
  Key: id (UUID)
  Data: {
    id, name, student_id, department, uniform_type,
    photo_url, embeddings: Float32Array[],
    is_active, updated_at
  }

ObjectStore: "logs"
  Key: id (auto-increment)
  Index: "synced" (0 = unsynced, 1 = synced)
  Data: {
    person_id, person_name, direction, method,
    success, confidence, uniform_ok, synced,
    gate_state ("open" | "unconfirmed" | null),
    sync_id (idempotency key), ...
  }

ObjectStore: "settings"
  Key: key (string)
  Data: { key, value }
```
