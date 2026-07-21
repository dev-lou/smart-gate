# Setup Guide

## Prerequisites

### Software
| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Runtime for all 3 services |
| pnpm | 9+ | Package manager (monorepo) |
| Chrome/Edge | Latest | Web Serial API for Arduino |
| Git | Latest | Version control |

### Hardware (Optional — Simulation Mode Works Without)
| Component | Purpose | Approx. Cost |
|-----------|---------|-------------|
| Android tablet with Chrome | Run kiosk PWA | Any available |
| Arduino Uno | Gate controller | $25 |
| SG90 Servo Motor | Physical gate mechanism | $5 |
| Push button | Manual override | $2 |
| USB-OTG cable | Connect Arduino to tablet | $5 |
| USB cable (A to B) | Arduino to tablet/PC | $3 |

### Cloud Services (All Free Tier)
| Service | Purpose | Free Tier Limits |
|---------|---------|-----------------|
| [Supabase](https://supabase.com) | Database, Auth, Storage | 500 MB DB, 1 GB storage |
| [Vercel](https://vercel.com) | Hosting (3 projects) | 100 GB bandwidth, 6000 build mins |
| [GitHub](https://github.com) | Source control + CI/CD | Unlimited public repos |

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USER/smart-gate.git
cd smart-gate
pnpm install
```

This installs all dependencies for all 3 services (kiosk, guard, dashboard) via pnpm workspaces.

---

## Step 2: Set Up Supabase

### 2.1 Create a Project
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose a name (e.g., `smart-gate`)
4. Set a secure database password
5. Choose a region close to you
6. Wait ~2 minutes for provisioning

### 2.2 Run the Schema
1. Go to **SQL Editor** in the Supabase Dashboard
2. Open `database/schema.sql` from your cloned repo
3. Paste and run the entire file
4. Do the same for all migrations in `database/migrations/` in order:
   - `002_uniform_types.sql` — uniform type definitions
   - `003_add_sync_id.sql` — log idempotency for crash-safe sync

### 2.3 Create Storage Bucket
1. Go to **Storage** in the Supabase Dashboard
2. Click **New Bucket**
3. Name: `student-photos`
4. Check **Public bucket** (for anonymous image access)
5. Click **Create bucket**

### 2.4 Get API Credentials
1. Go to **Project Settings → API**
2. Copy:
   - **Project URL** → This is your `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → This is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Step 3: Configure Environment

Each service needs its own `.env.local` file:

```bash
# Create all 3 env files
cp services/kiosk/.env.example services/kiosk/.env.local
cp services/guard/.env.example services/guard/.env.local
cp services/dashboard/.env.example services/dashboard/.env.local
```

Edit each `.env.local` with your Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> **Note**: All 3 services use the **same** Supabase URL and anon key. They share the same database.

---

## Step 4: Run Development Servers

### Option A: Run All 3 Services (Recommended)

```bash
pnpm dev
```

This starts all 3 services in parallel:
- **Dashboard**: http://localhost:3000
- **Guard Station**: http://localhost:3001
- **Kiosk**: http://localhost:3002

### Option B: Run Individually

```bash
# Admin Dashboard
pnpm dev:dashboard  # → http://localhost:3000

# Guard Station (in another terminal)
pnpm dev:guard      # → http://localhost:3001

# Kiosk PWA (in another terminal)
pnpm dev:kiosk      # → http://localhost:3002
```

---

## Step 5: Verify Installation

### 5.1 Check Dashboard
1. Open http://localhost:3000
2. You should see the login page (or be redirected to login)
3. Login with your Supabase credentials (or use Supabase Auth UI)

### 5.2 Check Guard Station
1. Open http://localhost:3001
2. You should see the Guard Station enrollment interface
3. Try taking a photo with your webcam

### 5.3 Check Kiosk
1. Open http://localhost:3002
2. You should see the kiosk interface with camera feed
3. Models will download on first load (~3-5 seconds)
4. Face detection should start automatically

---

## Step 6: Enroll Students

1. Open **Guard Station** (http://localhost:3001)
2. Fill in student details:
   - **Full Name** (required)
   - **Student ID** (optional)
   - **Course / Department** (required)
   - **Year Level** (optional)
   - **Section** (optional)
3. Take **3 photos** at different angles (Front, Left 45°, Right 45°)
4. Click **Register Student**
5. Photos upload to Supabase Storage
6. Student record created in Supabase

### 6.1 Sync to Kiosk
1. Open **Kiosk** (http://localhost:3002)
2. Click the sync button (bottom-right)
3. Wait for "Synced: X students, Y logs" confirmation
4. Student embeddings are generated automatically
5. Ready for face recognition!

---

## Step 7: Connect Arduino Hardware

### 7.1 Upload Firmware
1. Open `hardware/arduino/smart_gate.ino` in Arduino IDE
2. Select board: **Arduino Uno**
3. Select port
4. Click **Upload**

### 7.2 Wire the Circuit
```
Arduino Uno:
  Pin 9  → Servo Signal (orange)
  GND    → Servo GND (brown) + Button GND (one leg)
  5V     → Servo Power (red)

Button: Connect between Pin 2 and GND
        (internal pull-down enabled in firmware)
```

### 7.3 Connect to Kiosk
1. Plug Arduino into tablet via USB-OTG cable
2. In the kiosk, tap **"Connect Arduino"** button
3. A browser prompt appears — select the Arduino device
4. Once connected, the status shows ✅ Arduino Connected
5. Test: Press the physical button → gate opens in simulation

### 7.4 Auto-Reconnect
The kiosk automatically reconnects if the USB cable is bumped. It retries every 5 seconds for up to 60 seconds.

---

## Step 8: Deploy to Vercel

### 8.1 Create Vercel Projects
Create 3 Vercel projects (one per service):

| Project | Root Directory | Framework |
|---------|---------------|-----------|
| `smart-gate-kiosk` | `services/kiosk` | Next.js |
| `smart-gate-guard` | `services/guard` | Next.js |
| `smart-gate-dashboard` | `services/dashboard` | Next.js |

For each project:
1. Import your GitHub repository
2. Set **Root Directory** to the service path
3. Framework preset: **Next.js**
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. **Override**: Build Command = `npx next build`
6. Deploy!

### 8.2 Set Up GitHub Actions Secrets
Add these to GitHub → Settings → Secrets and variables → Actions:

| Secret | Where to get it |
|--------|----------------|
| `VERCEL_TOKEN` | Vercel Account → Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel → Team Settings → ID |
| `VERCEL_DASHBOARD_PROJECT_ID` | Vercel → Project → Settings → Project ID |
| `VERCEL_GUARD_PROJECT_ID` | Same for guard project |
| `VERCEL_KIOSK_PROJECT_ID` | Same for kiosk project |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page |

### 8.3 Deploy
Push to `main` branch → CI runs automatically → Deploy workflow deploys to Vercel.

Or manually trigger: GitHub → Actions → Deploy → Run workflow → Select service.

---

## Step 9: Train YOLO Uniform Model (Optional)

See the complete visual guide at **[docs/uniform-training.html](uniform-training.html)**.

Quick steps:
1. Take 100+ photos per uniform type
2. Upload to [Roboflow](https://roboflow.com) for labeling
3. Export in **YOLO11 format**
4. Convert to **ONNX** (see training guide)
5. Upload `uniform_yolo11n.onnx` to your Vercel project's `/public/models/` directory
6. Update `YOLO_MODEL_URL` in `services/kiosk/src/lib/uniform.ts`

---

## Troubleshooting

### "Supabase not configured"
→ You forgot to create `.env.local` or entered wrong credentials.

### "Camera not working"
→ Check browser permissions. On first visit, the browser asks for camera access.
→ On Chrome, check `chrome://settings/content/camera`
→ On tablet, check Settings → Apps → Chrome → Permissions

### "Web Serial API not supported"
→ You need Chrome or Edge on Android. Desktop Chrome works too.
→ Safari and Firefox don't support Web Serial API.

### "Model download failed"
→ Models download from CDN on first load. Check internet connection.
→ The ArcFace model (~6MB) downloads from Hugging Face CDN.
→ MediaPipe (~4MB) downloads from jsDelivr CDN.
→ These are cached by the browser after first load.

### "Build fails on Vercel"
→ Ensure `output: "standalone"` is **not** set in `next.config.js`
→ This is removed from dashboard and guard configs by default
