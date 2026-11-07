# 🎓 Defense-Day Demo Runbook

One page. Follow this order and the live demo cannot fail.

---

## ⏱️ Before Defense Day (do this at home, NOT at the venue)

| # | Task | Where | Status |
|---|------|-------|--------|
| 1 | Fill real Supabase credentials in all 3 `.env.local` files | `services/{kiosk,guard,dashboard}/.env.local` | ☐ |
| 2 | Run `database/schema.sql`, then any migrations you have not applied yet (`006` → `020`) | Supabase → SQL Editor | ☐ |
| 3 | Verify with one paste: run `database/verify.sql` → every row PASS | Supabase SQL Editor | ☐ |
| 4 | Flash `hardware/esp32/smart_gate_esp32.ino` to the ESP32 (Arduino IDE + WebSockets library) | Arduino IDE | ☐ |
| 5 | Enrol **3 demo students** (5 angles each) and **1 guest with a pass expiring in 2 minutes** | Guard Station `:3001` | ☐ |
| 6 | On the tablet: open the kiosk **once while online** → let the models load (~5 s) → sync → "Profiles" count = enrolled students | Kiosk `:3002` | ☐ |
| 7 | **Airplane-mode test**: network off → reload kiosk → recognition, decision and gate command must all still work, logs queue | Tablet | ☐ |
| 8 | Reconnect → logs auto-sync, heartbeat row appears in Dashboard → Kiosk Health | Tablet + Dashboard `:3000` | ☐ |
| 9 | Dashboard → Students → **QR** → print or download each student's school-ID code | Dashboard `:3000` | ☐ |
| 10 | `pnpm build` green on the laptop (backup demo machine) | Terminal | ☐ |

> ⚠️ The tablet must be **loaded online once** (step 6) so the service worker
> caches the face model and student photos. After that, everything runs offline.

---

## 🎬 At the Venue — Boot Order (exact sequence)

1. **Power the ESP32 first** (phone charger) — wait for 3 LED blinks. No ESP32? Plug the Arduino in via USB-OTG instead.
2. On the tablet, join Wi-Fi **`SmartGate-Gate1`** (password `smartgate123`) — *or* skip this if using the Arduino USB fallback.
3. Open the kiosk → **Tap to Start** (grants camera + unlocks audio in one tap) → status pill shows **Gate: IDLE**.
   - USB fallback: gear (top-right) → Operator Panel → **Bind Gate** → pick the Arduino.
4. **Put the tablet in airplane mode** and say: *"Detection, recognition, the access decision and the gate command all run on this tablet. No internet, no school Wi-Fi."* (This is your strongest feature — show it.)

## 🎞️ The Four-Minute Demo

| # | Do this | What they see |
|---|---------|---------------|
| 1 | Student A (in uniform) steps into the oval, holds still ~2 s | Name + course freeze (**IDENTITY VERIFIED**) — press **Next: uniform** — uniform line appears — press **Open Gate** → **ACCESS GRANTED** + chime, gate opens |
| 2 | Student A stands still another 10 s | **Nothing is logged again** — one person, one row (this is the point of slide 15) |
| 3 | Student A leaves; guest with the expiring pass steps up | Name locks — press **Next** (guests skip the uniform read) — press **Open Gate** → granted, `GUEST_PASS_VALID` |
| 4 | Wait for the pass to expire, guest steps up again | **Denied** — "pass expired, see guard", `GUEST_EXPIRED` |
| 5 | Dashboard → Settings → turn **lockdown** on, student steps up | **Denied** — `LOCKDOWN_ACTIVE`, reason shown on screen |
| 6 | Turn lockdown off, press the **physical button** | Arm opens — staff override still works |
| 7 | Reconnect network → sync panel | Queued logs from airplane mode sync now |
| 8 | Dashboard → Access Logs | Rows show who, when, and **why** — permission and denial both explained |
| 9 | Hold up a printed school-ID QR instead of a face | Name appears at once (before any uniform read) — **Next** checks the uniform — **Open Gate** opens it, logged method `qr` |

## 🗣️ What to say (30-second script)

> "This is a smart gate kiosk. Everything runs in the browser — face detection
> and ArcFace recognition at 512 dimensions, a confirmation step that needs five
> matching reads before it will trust a face, a uniform check on the grey
> polo, and a policy layer for guest passes and lockdown. It's offline-first: the models and student data live on
> the tablet, and decisions queue locally and sync to Supabase when a connection
> returns. The ESP32 moves the arm over its own hotspot, and the kiosk waits for
> the controller to confirm the barrier opened before it says so."

## 🔥 If Something Goes Wrong

| Symptom | Fix |
|---------|-----|
| "System Fault" / camera error | Tap **Reboot Terminal** → re-grant camera |
| Gate won't connect / pill stuck on "Connect Gate" | Tablet not on `SmartGate-Gate1`, or ESP32 unpowered → check LED blinks, rejoin hotspot |
| No sound on grant/deny | Gear → Operator Panel → **Voice ON**. Still silent: reboot tablet and do Tap-to-Start again (audio needs one tap after boot) |
| Subject never recognised | Hold still for the full ~2.5 s confirmation; check lighting; confirm the student is enrolled with 5 angles. If a *stranger* is being matched, raise `face_recognition_threshold` in Settings — but re-test first |
| Two lookalikes keep failing | That is the 0.08 margin working. Enrol clearer angles rather than lowering it |
| Guest denied unexpectedly | Check `valid_until` — the kiosk denies on the server clock |
| Everyone denied at once | Lockdown is on. Settings → `lockdown_mode = false` |
| No profiles / "Awaiting Subject" forever | Sync panel → Force Sync → wait for Profiles count. If an access-log column error appears, run migration `006` |
| Guard enrollment fails: "row-level security policy" | Run migration `008` (Storage policies on `student-photos`) |
| Wrong table/column error | Run `database/verify.sql` — it names the migration to re-run |
| Student's face is not recognised | Hold up the printed school-ID QR — the kiosk opens on the code alone; print codes from Dashboard → Students → QR |
| Arduino won't connect | Tap "Connect Hardware", pick the port; check USB-OTG cable + Arduino powered |
| No internet at venue and models never cached | Can't happen if step 6 was done — that's the point of the airplane-mode rehearsal |

## 🛠️ Quick Commands

```bash
pnpm dev          # all 3 services (dashboard :3000, guard :3001, kiosk :3002)
pnpm typecheck    # TS check, all services
cd services/kiosk && npx vitest run   # 146 unit tests (+ 15 dashboard)
pnpm build        # production build, all services
pnpm preflight    # audit the live database before the demo
```

## 🎯 Reminders

- Face models load from CDN **once**, then the service worker caches them.
- Enrol **5 photos** per student — recognition accuracy depends on the angles.
- A guest pass is only as good as its `valid_until`; set the demo one 2 minutes out.
- The public screen never shows names or scores. If the panel wants detail, open the Dashboard.
