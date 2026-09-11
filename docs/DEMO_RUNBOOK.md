# 🎓 Defense-Day Demo Runbook (September 2026)

One page. Follow this order and the live demo cannot fail.

---

## ⏱️ Before Defense Day (do this at home, NOT at the venue)

| # | Task | Where | Status |
|---|------|-------|--------|
| 1 | Fill real Supabase credentials in all 3 `.env.local` files | `services/{kiosk,guard,dashboard}/.env.local` | ☐ |
| 2 | Run `database/migrations/005_align_uniforms_to_model.sql` in Supabase SQL Editor | Supabase → SQL Editor | ☐ |
| 3 | Run `database/migrations/006_compatibility_security.sql` in Supabase SQL Editor | Supabase → SQL Editor | ☐ |
| 4 | Run `database/migrations/007_gate_health.sql` in Supabase SQL Editor (gate feedback + kiosk health table) | Supabase → SQL Editor | ☐ |
| 5 | Run `database/migrations/008_guard_storage_policies.sql` in Supabase SQL Editor (Guard photo upload — enrollment fails without it) | Supabase → SQL Editor | ☐ |
| 6 | Run `database/migrations/009_school_branding.sql` in Supabase SQL Editor (initials badge + voice setting) | Supabase → SQL Editor | ☐ |
| 7 | Verify with one paste: run `database/verify.sql` → every row PASS (uniform classes 0..8, unique `sync_id` index, RLS + Storage policies) | Supabase SQL Editor | ☐ |
| 8 | Flash `hardware/esp32/smart_gate_esp32.ino` to the ESP32 (Arduino IDE + WebSockets library) | Arduino IDE | ☐ |
| 9 | Enroll **3 demo students** (2 correct uniforms, 1 wrong uniform for the "denied" demo), then run `pnpm preflight` → no blocking issues | Guard Station `:3001` | ☐ |
| 10 | On the tablet: open kiosk **once while online** → let models load (~5 s) → tap sync → wait for "Profiles" count = enrolled students | Kiosk `:3002` | ☐ |
| 11 | **Airplane-mode test**: turn off all network → reload kiosk → face recognition + uniform detection must still work, gate must open, logs must queue | Tablet | ☐ |
| 12 | Reconnect network → logs auto-sync, heartbeat row appears in Dashboard → Kiosk Health | Tablet + Dashboard `:3000` | ☐ |
| 13 | `pnpm build` green on laptop (backup demo machine) | Terminal | ☐ |

> ⚠️ The tablet must be **loaded online once** (step 10) so the service worker caches
> the face models + student photos. After that, everything runs offline.

---

## 🎬 At the Venue — Boot Order (exact sequence)

1. **Power the ESP32 first** (phone charger) — wait for 3 LED blinks. No ESP32? Plug the Arduino in via USB-OTG instead.
2. On the tablet, join Wi-Fi **`SmartGate-Gate1`** (password `smartgate123`) — *or* skip this if using the Arduino USB fallback.
3. Open the kiosk on the tablet → **Tap to Start** (this grants camera + unlocks audio in one tap) → status pill shows **Gate: IDLE** (Wi-Fi icon).
   - USB fallback: tap the gear (top-right) → Operator Panel → **Bind Gate** → select the Arduino in the serial prompt.
4. **Put the tablet in airplane mode** and say: *"Face recognition, uniform detection, AND gate control run 100% on-device — no internet, no school Wi-Fi needed."* (This is your strongest feature — show it.)
5. Demo student A → **face matched + uniform OK → gate opens** (green "ACCESS GRANTED — Gate OPEN" + chime + *"Welcome to ISUFST"* voice line).
6. Demo student B wearing the **wrong uniform** → **denied** (red "ACCESS DENIED" + buzz + voice: "Please see the guard").
7. Press the **physical button** → manual override gate open (guard fallback).
8. Reconnect network → show the sync panel: logs that queued offline are now synced ("Synced: 0 students, N logs").
9. Optional wow: open Dashboard → **Kiosk Health** → your kiosk shows ONLINE with camera OK, gate linked, live gate state.

## 🗣️ What to say (30-second script)

> "This is a smart gate kiosk. Everything runs in the browser — face detection, ArcFace face
> recognition at 99.4% LFW accuracy, and a custom-trained YOLO11 model that checks the student's
> uniform against their course. It's offline-first: all AI models and student data live on the
> tablet, and access logs queue locally and sync to Supabase when a connection is available.
> The ESP32 controls the physical gate over Wi-Fi — its own hotspot, no internet needed."

## 🔥 If Something Goes Wrong

| Symptom | Fix |
|---------|-----|
| "System Fault" / camera error | Tap **Reboot Terminal** (top of error screen) → re-grant camera |
| Gate won't connect / status pill stuck on "Connect Gate" | Tablet not on `SmartGate-Gate1` Wi-Fi, or ESP32 unpowered → check LED blinks, rejoin hotspot, tap Connect Gate |
| No sound on grant/deny | Voice was toggled off → gear icon → Operator Panel → **Voice ON**. If still silent: reboot the tablet and do the Tap-to-Start again (audio needs one tap after every boot) |
| Need to see FPS/sync/models during demo | Tap the **gear icon** (top-right) → Operator Panel shows everything; tap gear again to hide before the committee looks at the screen |
| No profiles / "Awaiting Subject" forever | Sync panel → Force Sync → wait for Profiles count to update. If sync reports an access-log column error, run migration `006_compatibility_security.sql`. |
| Guard enrollment fails: "new row violates row-level security policy" | Run migration `008_guard_storage_policies.sql` (Storage policies on `student-photos`). |
| Wrong service says a table/column is missing | Run `database/verify.sql` in the SQL Editor — it names the exact migration to re-run. |
| Uniform check says "Uniform detector not loaded" | Model failed to load once online — reload the kiosk while online, verify `200` on `/models/uniform_yolo11n.onnx` |
| Arduino won't connect | Tap "Connect Hardware", pick the port; check USB-OTG cable + Arduino powered |
| Face match wrong person | Raise the threshold in Supabase `system_settings` (`face_recognition_threshold`, default 0.6) — but re-test first |
| No internet at venue and models never cached | Can't happen if step 5 was done — that's the point of the airplane-mode rehearsal |

## 🛠️ Quick Commands

```bash
pnpm dev          # all 3 services (dashboard :3000, guard :3001, kiosk :3002)
pnpm typecheck    # TS check, all services
cd services/kiosk && npx vitest run   # 60 unit tests
pnpm build        # production build, all services
pnpm preflight    # audit the live database before the demo
```

## 🎯 Reminders

- Demo students' `uniform_type` must be one of the **9 real class names**
  (`cbmsd_*`, `cici_*`, `coag_*`, `education_*`) — migration 005 sets the dropdowns.
- Uniform model is local (`public/models/uniform_yolo11n.onnx`, 10.6 MB) — fully offline.
- Face models load from CDN **once**, then the service worker caches them.
- Keep 3 photos per student (front, left, right) — recognition accuracy depends on it.