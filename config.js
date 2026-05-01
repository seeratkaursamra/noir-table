/* ─────────────────────────────────────────────────────────────────────────
   NOIR TABLE — runtime config
   ─────────────────────────────────────────────────────────────────────────
   Paste your Supabase project URL + anon key below and the app
   automatically becomes a real cloud-backed app with auth + realtime.

   Where to find them:
     1. https://supabase.com  →  create a free project (no card)
     2. Project Settings  →  API
     3. Copy "Project URL" and "anon public" key

   Leave them empty to keep using localStorage (single-device demo mode).
   The app detects this automatically — no other change required.
   ──────────────────────────────────────────────────────────────────────── */

window.NOIR_CONFIG = {
  supabaseUrl:     "",   // e.g. "https://abcdwxyz.supabase.co"
  supabaseAnonKey: "",   // e.g. "eyJhbGciOi...long_anon_key..."
};
