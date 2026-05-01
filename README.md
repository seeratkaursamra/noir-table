# Noir Table

> Restaurant Reservation Manager — Edmonton, AB · YEG 2026

An intimate fine-dining reservation web app. Dark luxury aesthetic, time-slot picker with availability, live reservations list, animated confirmation toast, full admin dashboard, dark/light theme toggle, and an embedded Google Map of Whyte Ave.

**Two modes, switched by a single config file:**

- **Local mode** (default) — opens straight from `index.html`, persists to `localStorage`. Single device, zero setup.
- **Cloud mode** — paste your free Supabase URL + anon key into `config.js` and the app instantly becomes a real multi-device app with Postgres storage, email/password auth, staff-gated admin, and **realtime updates** (admin dashboard auto-updates as bookings come in).

Total cost for cloud mode at portfolio scale (10–15 users): **$0**.

---

## Try it (demo)

The site has two parts:

- **Public site (`/index.html`)** — what diners see. Browse the menu, pick a time, book a table.
- **Staff dashboard (`/admin.html`)** — what the host stand sees. Confirm / cancel bookings, add phone-in reservations, walk-ins, search, edit, export CSV.

**Staff dashboard demo credentials** (local mode, no backend setup needed):

| | |
| --- | --- |
| **Email** | `staff@noir.demo` |
| **Password** | `noir2026` |

Land on `/admin.html` → enter the credentials → manage the seeded sample reservations. Session persists across reloads via `localStorage`. Click **Sign out** (top-right user chip) to return to the gate.

> In cloud mode the same gate is backed by real Supabase Auth and the `staff` table — credentials above only work for the local demo.

---

## Features

| | |
| --- | --- |
| Dark luxury aesthetic (gold + noir, serif display type) | ✅ |
| Reservation booking form with friendly validation | ✅ |
| Time-slot picker (5:00 PM – 11:00 PM, every 30 min) with available / taken / selected states | ✅ |
| Live "Upcoming reservations" card on hero | ✅ |
| Slide-up confirmation toast (auto-dismiss in 3.5 s) | ✅ |
| Edmonton-local branding — Whyte Ave, Old Strathcona, MT timezone, +1-780 numbers | ✅ |
| Mobile-responsive layout (iPhone, Android, desktop) | ✅ |
| Admin dashboard — filter, confirm / cancel / delete, KPI stats, CSV export | ✅ |
| Dark / light mode toggle (preference saved) | ✅ |
| Google Maps embed (free, no billing) | ✅ |
| **Supabase Postgres + Auth + Realtime (free tier)** | ✅ |
| **Email + password auth, staff role with RLS** | ✅ |
| **DB-level double-booking prevention via unique index** | ✅ |
| **localStorage fallback when Supabase isn't configured** | ✅ |

---

## Quick start (Local mode)

```bash
# Just open it
open index.html

# Or serve it
python3 -m http.server 5181
# → http://localhost:5181
```

Done. The app seeds five demo reservations and persists everything you do to your browser's `localStorage`. No accounts, no backend.

---

## Cloud mode setup (free, ~5 minutes)

**One-time setup, all on the free tier — no credit card required.**

### 1. Create a Supabase project

1. Go to **<https://supabase.com>** and sign up (GitHub or email — both free).
2. Click **New project**. Pick any name (e.g. `noir-table`), region `Canada Central` for Edmonton.
3. Generate a database password (Supabase will save it for you). Wait ~2 minutes for the project to provision.

### 2. Run the schema

1. In your Supabase project, open **SQL Editor** in the sidebar.
2. Click **New query**, paste the entire contents of `supabase-schema.sql` (in this folder), and click **Run**.
3. You should see `Success. No rows returned.` — this created the `reservations` and `staff` tables, RLS policies, the `is_staff()` helper, the `promote_to_staff()` function, realtime publication, and seeded 5 demo bookings.

### 3. Wire your keys into the app

1. In Supabase, open **Project Settings → API**.
2. Copy:
   - **Project URL** (e.g. `https://abcdwxyz.supabase.co`)
   - **anon public key** (starts with `eyJ…`)
3. Open `config.js` and paste them in:

```js
window.NOIR_CONFIG = {
  supabaseUrl:     "https://abcdwxyz.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...long_anon_key...",
};
```

The anon key is **safe to ship in the browser** — it's protected by the RLS policies in step 2. Don't paste your `service_role` key.

### 4. Make yourself staff

1. Reload the app, click **Sign in** (top right), enter your email + a password (≥ 6 chars), click **Create account**.
2. By default Supabase emails a confirmation link. *(Optional, recommended for portfolio: turn this off — Supabase Dashboard → Authentication → Providers → Email → toggle off "Confirm email". Then sign-up = instant login.)*
3. Back in Supabase **SQL Editor**, run:

   ```sql
   select promote_to_staff('you@example.com');
   ```

4. Reload the app. The **STAFF** pill appears next to your email and the admin dashboard unlocks.

### 5. (Optional) Deploy to Vercel

1. Push this folder to a GitHub repo.
2. <https://vercel.com> → **Import Project** → select the repo.
3. Framework preset: **Other**. Build command: empty. Output directory: `.`. Click Deploy.
4. Done — `https://noir-table.vercel.app`. Re-add your domain to Supabase **Auth → URL Configuration** if you want auth emails to redirect there.

---

## File map

```
noir-table/
├── index.html            Markup — nav, hero, menu, reserve form, admin, events, contact, footer, toast, auth modal
├── styles.css            Dark luxury theme, light theme, modal, responsive grid, components
├── app.js                State, time-slot picker, validation, toast, admin, CSV, auth, realtime
├── config.js             Paste Supabase URL + anon key here to switch to cloud mode
├── supabase-schema.sql   Run once in Supabase SQL Editor — tables + RLS + functions + realtime + seed data
└── README.md             This file
```

---

## How it works

### Cloud-mode architecture

```
Browser ── @supabase/supabase-js ──┬── REST/PostgREST ── Postgres (reservations, staff)
                                   ├── Auth (email/password, JWT in browser)
                                   └── Realtime (WebSocket → postgres_changes)
```

- Reservations live in a `reservations` Postgres table.
- A `unique index` on `(date, time) WHERE status <> 'cancelled'` makes double-booking *impossible* at the database level — even with concurrent requests.
- **Row Level Security** on `reservations`:
  - Anyone (including logged-out guests) can `INSERT` (= make a booking).
  - Anyone can `SELECT` (so the public hero card works). For a real restaurant you'd narrow this with a column-restricted view; the SQL file shows where.
  - Only members of the `staff` table can `UPDATE` or `DELETE`.
- Auth is Supabase Auth (free tier — 50,000 monthly active users included).
- Realtime: `app.js` subscribes to `postgres_changes` on `reservations` so the admin dashboard refreshes the moment another device makes a booking.

### Mode detection

`app.js` checks at boot:

```js
const CLOUD_MODE = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
```

If `config.js` has both keys, the cloud adapter is used. Otherwise the localStorage adapter takes over and the app behaves exactly like before. Both adapters expose the same `list / create / update / remove / subscribe` shape, so the rest of the code doesn't care which one is active.

### What the auth UI does

- **Local mode:** the **Sign in** button is hidden — there's nothing to sign into.
- **Cloud mode, signed out:** the admin dashboard shows a locked state with a "Sign in" CTA. Customers can still book without signing in.
- **Cloud mode, signed in but not staff:** the locked state shows a friendly message with the exact `select promote_to_staff('…');` snippet to run.
- **Cloud mode, signed in and staff:** dashboard unlocks, **STAFF** pill appears in the nav, real-time subscription is active.

---

## Free-tier limits to know

| Limit | Free tier | When it bites |
|---|---|---|
| Database size | 500 MB | Millions of bookings — non-issue |
| Auth MAU | 50,000 | Non-issue |
| Bandwidth (egress) | 5 GB / month | Plenty for a reservation app |
| Project pause | Pauses after 7 days of inactivity | Visit the dashboard once a week, or upgrade to Pro ($25/mo) for production |
| Realtime concurrent connections | 200 | Plenty for staff + a handful of guests |

---

## Optional further upgrades (still free or cheap)

- **Email confirmations** to the guest — wire up [Resend](https://resend.com) (3,000 emails/month free) inside a Supabase Edge Function triggered by the new-row event.
- **Google / GitHub OAuth** — Supabase Dashboard → Authentication → Providers, free.
- **Custom domain** — `noirtable.ca` ≈ $12/yr; configure in Vercel.
- **SMS reminders** — Twilio (paid per message — out of scope for the free tier).
- **Payment deposits** — Stripe (free integration, ~2.9 % per transaction).

---

## Roadmap / known limitations

This is a portfolio project, not a production reservation platform. I deliberately stopped short of a few features that real restaurants need — they're documented here so the gap is visible:

| Area | Status | Notes |
| --- | --- | --- |
| Capacity per time slot | **Not implemented** | One booking per slot blocks the whole 7:30 PM. A real restaurant has N tables — would need a `tables` table + a remaining-capacity check that supersedes the unique index. |
| Customer self-service | **Not implemented** | After booking, diners can't look up or cancel their own reservation. Would need a signed booking-id link sent by email. |
| Email confirmations & reminders | **Not implemented** | Toast says "confirmation email within minutes" but no email is sent. Wire up [Resend](https://resend.com) (3,000 emails/month free) inside a Supabase Edge Function triggered by `INSERT` on `reservations`. |
| Waitlist | **Not implemented** | When a slot is taken, no way to join a waitlist. |
| Floor plan / table assignment | **Not implemented** | Bookings aren't assigned to specific tables. |
| Audit log | **Not implemented** | No record of who confirmed / cancelled / seated which booking. |
| Date-range filter on the dashboard | **Not implemented** | Only `Today` / status filters are available — no "next week" or custom range. |
| Rate limiting / CAPTCHA on the public form | **Not implemented** | The public `INSERT` is open via RLS. For production, add a Cloudflare Turnstile gate or a per-IP rate limiter (e.g. Supabase Edge Function with Upstash). |
| Privacy policy / terms | **Not included** | Required when collecting personal data. Easy to add static pages. |
| i18n | **Not implemented** | English only. |
| Tests | **Not included** | No automated test suite. The dual-mode db adapter pattern would make unit tests straightforward. |

### What *is* in place

- ✅ Real auth (Supabase email/password) with a staff-only RLS policy
- ✅ Real-time updates on the dashboard (Postgres `LISTEN/NOTIFY` over WebSocket)
- ✅ DB-level double-booking prevention via partial unique index
- ✅ Status state machine: `pending → confirmed → seated` with `no-show` and `cancelled` as terminal states
- ✅ Booking confirmation card with a downloadable `.ics` (calendar) file
- ✅ Walk-in 1-click flow + manual phone-in entry for staff
- ✅ Search by name / phone, status filters, today filter
- ✅ Edit-in-place via a single shared modal (new + edit)
- ✅ CSV export
- ✅ Dark / light theme, mobile responsive
- ✅ localStorage fallback so the demo runs with zero backend
- ✅ Open Graph + Twitter meta tags for rich social-share previews

---

Built with love in Edmonton, AB · YEG 2026
