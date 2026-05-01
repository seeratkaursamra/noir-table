# Noir Table

> A fine-dining reservation app. Edmonton, AB.

A two-surface reservation product — a public site where diners book a table, and a staff dashboard where the host stand runs service. Built with vanilla HTML / CSS / JS, backed by Supabase (Postgres + Auth + Realtime), and degrades gracefully to a fully-functional `localStorage` mode when no backend is configured.

![Noir Table — fine dining reservations, Edmonton AB](./assets/og-image.png)

---

## Live demo

| Surface | URL | Notes |
| --- | --- | --- |
| **Public site** | <https://noir-table.vercel.app> | Browse the menu, pick a time, book a table. |
| **Staff dashboard** | <https://noir-table.vercel.app/admin.html> | Inline sign-in gate. Try the credentials below. |

**Demo credentials for the staff dashboard:**

| | |
| --- | --- |
| Email | `staff@noir.demo` |
| Password | `noir2026` |

The demo runs in `localStorage` mode — every browser gets its own seeded dataset. Sign in to confirm bookings, mark walk-ins, search, edit, and export. Click **Reset demo** to restore the seed.

---

## Highlights

Things in this codebase that are worth a look during a code review:

- **Dual-mode persistence layer.** A single `db` adapter object is implemented twice — once against `localStorage`, once against Supabase — and both expose the same `list / create / update / remove / subscribe` interface. The rest of the app is unaware of which one is active. Detection is one line at boot.
- **Database-level double-booking prevention.** A partial unique index on `(date, time) WHERE status NOT IN ('cancelled', 'no-show')` makes overlapping bookings impossible at the Postgres level — even under concurrent inserts. The frontend's optimistic check is a UX nicety, not the real guarantee.
- **Realtime dashboard.** The staff page subscribes to `postgres_changes` over WebSocket. When any device creates or updates a booking, every signed-in dashboard reflects it within ~50 ms.
- **Row Level Security as the auth boundary.** Reservations can be inserted by anyone (so guests can book), read by anyone (so the public hero shows live availability), but only updated or deleted by users present in a `staff` table. The check lives in Postgres, not in the client — a compromised browser can't mutate other rows.
- **Status state machine.** `pending → confirmed → seated`, with `no-show` and `cancelled` as terminal states. Each row's available actions are derived from its current status, so the UI cannot drive an illegal transition.
- **Two-mode admin gate, one component.** The same auth-gate component drives both real Supabase Auth (cloud mode) and a deterministic mocked auth (local mode). Sign-out, session restoration, and the staff pill all behave identically.
- **Print-quality menu.** The menu modal renders a print-styled view that produces a clean PDF via the browser's native `Cmd-P → Save as PDF` — no PDF library, no server. Open the menu and try it.
- **No build step, no framework.** Entry points are `index.html` and `admin.html` at the repo root; behavior lives under `js/` and `css/`. ES modules, no bundler. Lighthouse-friendly.

---

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vanilla HTML, CSS, JavaScript (ES modules, no bundler) |
| Type system | None — small enough to read |
| Database | Postgres (via Supabase) |
| Auth | Supabase Auth (email + password, JWT) |
| Realtime | Supabase Realtime (`postgres_changes` over WebSocket) |
| Hosting | Static — any CDN. Tested on Vercel. |
| Local fallback | `localStorage` adapter with the same interface as the cloud adapter |

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │         Browser (SPA)        │
                    │                              │
                    │   index.html ── public site  │
                    │   admin.html ── staff site   │
                    │                              │
                    │   js/app.js — one db adapter   │
                    │   selected at boot              │
                    └─────────────┬────────────────┘
                                  │
                                  │  cloud mode
                                  ▼
        ┌───────────────────── Supabase ────────────────────┐
        │                                                   │
        │   PostgREST  ─── Postgres (reservations, staff)   │
        │   GoTrue     ─── Auth (email/password, JWT)       │
        │   Realtime   ─── postgres_changes → WebSocket     │
        │                                                   │
        └───────────────────────────────────────────────────┘
```

In **local mode** the entire `Supabase` block is replaced with a `localStorage`-backed adapter exposing the same interface. The two adapters are interchangeable and the rest of the application code is identical between modes.

---

## Project structure

```
noir-table/
├── index.html            Public site — hero, menu modal, reservation form, confirmation card
├── admin.html            Staff site — auth gate, dashboard, booking modal
├── config.js             Supabase URL + anon key (empty → local mode)
├── supabase-schema.sql   Tables, indexes, RLS policies, helpers, seed data
├── assets/
│   └── og-image.png      Open Graph / Twitter card / apple-touch-icon
├── css/
│   └── styles.css        Theme tokens, dark + light modes, components, print styles
├── js/
│   ├── app.js            ES module — UI + adapters
│   └── lib/
│       └── noir-logic.mjs   Pure helpers — time parsing, slot availability, phone rules, event notes
├── tests/
│   └── noir-logic.test.mjs  Vitest unit tests (imports js/lib/noir-logic.mjs)
├── vitest.config.mjs
├── package.json
└── README.md
```

---

## Automated tests

Unit tests cover the **pure booking logic** in `js/lib/noir-logic.mjs` (time ordering, taken slots, phone validation, event note prefixing). They run in Node — no browser required.

```bash
npm install    # once
npm test       # run all tests once
npm run test:watch   # re-run on file changes (during development)
```

`js/app.js` is loaded as `type="module"` and imports `./lib/noir-logic.mjs` (under `js/`). Serve the site over **HTTP** (e.g. `python3 -m http.server`); opening `index.html` via `file://` may block module imports in some browsers.

---

## Run it locally

The public site runs from a static file with no setup:

```bash
git clone https://github.com/<your-username>/noir-table.git
cd noir-table
python3 -m http.server 5181
# → http://localhost:5181
```

That's it for the local-mode demo. The app seeds sample reservations on first run and persists everything to `localStorage`.

### Connect a real backend (optional)

If you want to run it against a real Postgres + Auth + Realtime backend:

1. Create a Supabase project (any tier, any region — the `Canada Central` region keeps latency low for Edmonton).
2. In the Supabase **SQL Editor**, run the entire contents of `supabase-schema.sql`. This creates the `reservations` and `staff` tables, the unique-slot index, RLS policies, the `is_staff()` helper, the `promote_to_staff(email)` function, the realtime publication, and a small seed dataset.
3. In `config.js`, paste in your project URL and anon public key:

   ```js
   window.NOIR_CONFIG = {
     supabaseUrl:     "https://<project>.supabase.co",
     supabaseAnonKey: "eyJ…",
   };
   ```

4. Reload the app, click **Sign in**, create an account, then in the SQL Editor run:

   ```sql
   select promote_to_staff('you@example.com');
   ```

5. Reload. The **STAFF** pill appears, the dashboard unlocks, the realtime subscription activates.

The anon key is intentionally browser-safe — every meaningful permission is enforced by RLS on the database side.

---

## Roadmap / known limitations

This is a portfolio project, not a production reservation platform. I deliberately stopped short of features that a real restaurant would need — they're documented here so the boundary is visible:

| Area | Notes |
| --- | --- |
| **Capacity per time slot** | One booking per slot blocks the whole 7:30 PM. A real venue has N tables — would need a `tables` table and a remaining-capacity check that supersedes the unique index. |
| **Customer self-service** | After booking, diners can't look up or cancel their own reservation. Would need a signed booking-id link sent by email. |
| **Transactional email** | The confirmation card promises an email; none is actually sent. The right shape is a Supabase Edge Function on `INSERT` calling Resend or Postmark. |
| **Waitlist** | When a slot is taken, no way to join a waitlist. |
| **Floor plan / table assignment** | Bookings aren't pinned to specific tables. |
| **Audit log** | No record of which staff member confirmed / cancelled / seated which booking. |
| **Date-range filter** | Only the `Today` / status filters exist — no arbitrary range picker. |
| **Rate limiting / CAPTCHA** | The public `INSERT` is open by RLS. For production, gate with Cloudflare Turnstile or a per-IP edge function. |
| **Privacy policy / terms** | Required when collecting personal data — easy to add as static pages. |
| **Internationalization** | English only. |
| **Tests** | Vitest covers `js/lib/noir-logic.mjs` only. No browser E2E yet. |

### What *is* implemented

- Real auth (Supabase email/password) with staff-only RLS
- Realtime updates over WebSocket
- DB-level double-booking prevention
- Status state machine with `seated` and `no-show` as first-class states
- Booking confirmation card with a downloadable `.ics` calendar file
- Walk-in 1-click flow and manual phone-in entry
- Search by name / phone, status filters, "Today" filter
- Inline edit via a shared booking modal
- CSV export
- Dark / light theme with persisted preference
- Mobile-responsive layout
- Vitest unit tests for pure booking helpers (`js/lib/noir-logic.mjs`)
- Open Graph / Twitter card meta tags for rich link previews

---

## License

MIT
