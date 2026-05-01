-- ─────────────────────────────────────────────────────────────────────────
-- NOIR TABLE — Supabase schema
-- Paste this whole file into Supabase Studio → SQL Editor → "Run".
-- Then run the "Make me staff" snippet at the bottom after you sign up.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Reservations table ──────────────────────────────────────────────────
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null check (char_length(name) between 2 and 80),
  phone       text not null check (char_length(phone) between 7 and 30),
  date        date not null,
  time        text not null check (
                time in (
                  '5:00 PM','5:30 PM','6:00 PM','6:30 PM',
                  '7:00 PM','7:30 PM','8:00 PM','8:30 PM',
                  '9:00 PM','9:30 PM','10:00 PM','10:30 PM',
                  '11:00 PM'
                )
              ),
  guests      int  not null check (guests between 1 and 12),
  notes       text check (char_length(coalesce(notes,'')) <= 240),
  status      text not null default 'pending'
              check (status in ('pending','confirmed','seated','no-show','cancelled')),
  created_at  timestamptz not null default now()
);

-- Prevents double-booking the same slot. Cancelled and no-show rows release
-- the slot; pending / confirmed / seated all hold it.
create unique index if not exists reservations_slot_idx
  on public.reservations (date, time)
  where status not in ('cancelled', 'no-show');

create index if not exists reservations_date_idx
  on public.reservations (date);


-- 2. Staff table — anyone in here can manage reservations ────────────────
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- Helper: is the current request from a staff member?
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff where user_id = auth.uid()
  );
$$;


-- 3. Row Level Security ─────────────────────────────────────────────────
alter table public.reservations enable row level security;
alter table public.staff        enable row level security;

-- Reservations: portfolio policy (publicly readable).
-- For a real restaurant, replace with a view that exposes only
-- (name, guests, date, time, status) and lock the base table to staff-only.
drop policy if exists "reservations: public read" on public.reservations;
create policy "reservations: public read"
  on public.reservations for select
  using (true);

-- Anyone (even logged-out guests) can create a reservation.
drop policy if exists "reservations: anyone can book" on public.reservations;
create policy "reservations: anyone can book"
  on public.reservations for insert
  with check (true);

-- Only staff can update (confirm/cancel).
drop policy if exists "reservations: staff can update" on public.reservations;
create policy "reservations: staff can update"
  on public.reservations for update
  using (public.is_staff())
  with check (public.is_staff());

-- Only staff can delete.
drop policy if exists "reservations: staff can delete" on public.reservations;
create policy "reservations: staff can delete"
  on public.reservations for delete
  using (public.is_staff());

-- Staff: each user can read their own staff row (used to know "am I staff?")
drop policy if exists "staff: read self" on public.staff;
create policy "staff: read self"
  on public.staff for select
  using (auth.uid() = user_id);


-- 4. Realtime ──────────────────────────────────────────────────────────
-- Push live changes to subscribed clients (admin dashboard auto-updates).
alter publication supabase_realtime add table public.reservations;


-- 5. Promote-to-staff helper ───────────────────────────────────────────
-- Run this once *after* you sign up your first user inside the app.
create or replace function public.promote_to_staff(user_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = lower(user_email);
  if uid is null then
    raise exception 'No user with email %', user_email;
  end if;
  insert into public.staff (user_id) values (uid)
  on conflict do nothing;
end;
$$;


-- 6. Demo seed data ────────────────────────────────────────────────────
-- Optional. Comment this out if you want to start empty.
insert into public.reservations (name, phone, date, time, guests, status, notes)
values
  ('Marchetti', '(780) 555-0142', current_date + 3, '7:30 PM', 4, 'confirmed', 'Anniversary — quiet booth if possible.'),
  ('Chen',      '(780) 555-0188', current_date + 5, '8:00 PM', 2, 'pending',   ''),
  ('Okafor',    '(780) 555-0233', current_date + 7, '6:30 PM', 6, 'confirmed', 'Vegetarian tasting for 2 of the party.'),
  ('Tremblay',  '(780) 555-0190', current_date + 1, '5:30 PM', 2, 'confirmed', ''),
  ('Singh',     '(780) 555-0177', current_date + 2, '8:30 PM', 3, 'pending',   'Wine pairing add-on.')
on conflict do nothing;


-- ─────────────────────────────────────────────────────────────────────
-- ONE-TIME: Make yourself staff after first sign-up
-- ─────────────────────────────────────────────────────────────────────
-- 1. Open the app, click "Sign in", create an account with your email.
-- 2. Come back here and run, replacing the email with your own:
--
--    select public.promote_to_staff('you@example.com');
--
-- That's it. You can now confirm / cancel / delete from the dashboard.
