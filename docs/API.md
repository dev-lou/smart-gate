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
    uniform_type: "uniform_bsit",
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

## 2. Web Serial Protocol (Kiosk ↔ Arduino)

The kiosk communicates with the Arduino gate controller via **Web Serial API** over USB (9600 baud).

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

### JavaScript API

```typescript
// arduino.ts — browser-side
import { connectToArduino, openGate, closeGate, onArduinoEvent } from "@/lib/arduino";

// Connect (user clicks button → browser prompt)
await connectToArduino();

// Open gate
await openGate();  // Sends 'O'

// Close gate
await closeGate(); // Sends 'C'

// Listen for button press
onArduinoEvent((event) => {
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
  → YOLO inference or color fallback → { ok, confidence, detail }
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

### Arduino Module (`lib/arduino.ts`)

```typescript
connectToArduino(): Promise<void>
  → Opens Web Serial port (9600 baud)

tryAutoConnect(): Promise<boolean>
  → Attempts to find already-paired Arduino

openGate(): Promise<void>
  → Sends 'O' → servo rotates to 90°

closeGate(): Promise<void>
  → Sends 'C' → servo rotates to 0°

isSerialSupported(): boolean
  → Checks if browser supports Web Serial API
```

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
    sync_id (idempotency key), ...
  }

ObjectStore: "settings"
  Key: key (string)
  Data: { key, value }
```
