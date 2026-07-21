# Smart Access Control System — Next.js Dashboard

## Overview

Cloud dashboard for the **Smart Access Control System**. Built with **Next.js 16**, **Supabase**, and **Tailwind CSS**. Manages enrolled persons, uniform policies, guest visits, access logs, reports, and manual overrides.

This is the **cloud/admin component**. The **AI brain and gate controller** lives in `../raspberry-pi`.

## System Title

**Smart Access Control System**

## Architecture

```
Tablet / Kiosk (browser)
        │
        ▼
Python AI Brain (raspberry-pi/brain_api.py)
        │
        ├─ Face recognition (dlib / face_recognition)
        ├─ Uniform detection (YOLO11 Nano / color-based)
        ├─ QR guest token validation
        ├─ Manual override logging
        └─ SQLite local database (offline-first)
                │
                ▼ (cloud sync when online)
Supabase Database ◄──── Next.js Dashboard (this folder)
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  Admin Pages             Guard Pages             Reports / CSV
```

## Key Features

- **Person Management** — Faculty, Staff, Students with face enrollment, department, and uniform type
- **Department-Based Uniform Policies** — Map each department to a prescribed uniform; synced to local gate
- **Guest Visit Management** — QR-based visitor check-in, guard approval, temporary visitor pass QR, time-out
- **Access Logs** — Entry/exit logs with direction, person type, uniform result, override metadata
- **Manual Override** — Cloud record + optional Brain API physical gate trigger
- **Reports** — Summary dashboard with CSV export for all log types
- **Audit Logs** — Accountability records for guest visit and override actions
- **Offline-First Sync** — Local Python backend syncs to Supabase when internet available
- **Tablet Kiosk** — `/gate` for automated continuous scanning; `/kiosk` for manual debug mode
- **Visitor Check-In** — `/visitor/check-in` public form linked to printable QR code

## Dashboard Pages

| Page | Path | Purpose |
|---|---|---|
| Students | `/dashboard/students` | Manage enrolled students |
| Faculty | `/dashboard/faculty` | Manage enrolled faculty |
| Staff | `/dashboard/staff` | Manage enrolled staff |
| Guest Cards | `/dashboard/cards` | Manage RFID legacy guest cards |
| Guest Visits | `/dashboard/guest-visits` | QR guest workflow, check-in, QR pass, checkout |
| Manual Override | `/dashboard/manual-overrides` | Record/trigger manual gate openings |
| Reports | `/dashboard/reports` | Summary stats and CSV export |
| Access Logs | `/dashboard/logs` | Filterable access log table with CSV |
| Audit Logs | `/dashboard/audit-logs` | Guard/admin action accountability |
| Uniform Policies | `/dashboard/uniform-policies` | Department-to-uniform-type mapping |
| Settings | `/dashboard/settings` | System settings and uniform reference images |

## API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/students` | GET/POST/PUT/DELETE | Student CRUD |
| `/api/faculty` | GET/POST/PUT/DELETE | Faculty CRUD |
| `/api/staff` | GET/POST/PUT/DELETE | Staff CRUD |
| `/api/cards` | GET/POST/PUT/DELETE | RFID guest card CRUD |
| `/api/guest-visits` | GET/POST/PUT/DELETE | QR guest visit CRUD |
| `/api/manual-overrides` | POST | Record manual override |
| `/api/logs` | GET/POST | Access log query and Pi push |
| `/api/audit-logs` | GET/POST | Audit log query and insert |
| `/api/settings` | GET/PUT/DELETE | System settings and uniform images |
| `/api/sync` | GET | Pi pull endpoint (people, visits, settings) |
| `/api/brain/[...path]` | GET/POST | Proxy to local Brain API |

## Public Pages

| Path | Purpose |
|---|---|
| `/gate` | Automated tablet scanner with entry/exit toggle |
| `/kiosk` | Manual test kiosk (direct Brain API URL) |
| `/visitor/check-in` | Public visitor form (linked from printable QR) |

## Quick Start

```bash
cd web-dashboard
npm install
cp .env.example .env.local  # Add SUPABASE_URL, SUPABASE_SERVICE_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) |
| `BRAIN_API_URL` | Local Brain API URL (default: `http://localhost:8088`) |
| `NEXT_PUBLIC_BRAIN_API_URL` | Public Brain API URL for kiosk direct calls |

## Supabase Schema

Run `../supabase/schema.sql` in Supabase SQL Editor to create all tables, indexes, triggers, and RLS policies.

Tables:
- `students` — Faculty, staff, and students (person_type field)
- `guest_cards` — RFID card registry
- `guest_visits` — QR visitor check-in/check-out records
- `access_logs` — All gate events with direction, person type, override fields
- `audit_logs` — Dashboard/guard action accountability
- `system_settings` — Key-value config including uniform policies

## Deployment

Deploy to Vercel:

1. Push project to GitHub
2. Import in Vercel and set root to `web-dashboard`
3. Add environment variables
4. Deploy

The local Python backend runs separately on the gate device (Raspberry Pi, laptop, or mini PC) and syncs to Supabase.
