/* ─────────────────────────────────────────────────────────────────────────
   NOIR TABLE — app logic
   - Cloud mode: Supabase (Postgres + Auth + Realtime, free tier)
   - Local mode: localStorage fallback when Supabase isn't configured
   - Time-slot picker, validation, toast, admin (staff-gated), CSV export
   ──────────────────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  const STORAGE_KEY      = "noir-table:reservations:v1";
  const THEME_KEY        = "noir-table:theme";
  const LOCAL_STAFF_KEY  = "noir-table:staff-session:v1";

  // Demo creds for local-mode mock auth — shown right on the sign-in gate.
  // In cloud mode this is unused: real Supabase Auth is checked instead.
  const DEMO_CREDS = Object.freeze({
    email:    "staff@noir.demo",
    password: "noir2026",
  });

  const TIME_SLOTS = [
    "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM",
    "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM",
    "9:00 PM", "9:30 PM", "10:00 PM", "10:30 PM",
    "11:00 PM",
  ];

  const STATUSES = ["pending", "confirmed", "seated", "no-show", "cancelled"];

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* Page mode — set by `<body data-page="public|admin">`. Falls back to feature
     detection so the script also works if you ever inline it elsewhere. */
  const PAGE = document.body?.dataset.page || (document.getElementById("admin") ? "admin" : "public");
  const isAdminPage  = PAGE === "admin";
  const isPublicPage = PAGE === "public";

  /* ── Date / id / escape helpers ─────────────────────────────────── */
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const addDaysISO = (iso, days) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  };
  const uid = () => "r_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  function parseTime(t) {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t || "");
    if (!m) return 0;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === "PM") h += 12;
    return h * 60 + Number(m[2]);
  }
  function byDateTime(a, b) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return parseTime(a.time) - parseTime(b.time);
  }

  /* ── Backend mode detection ─────────────────────────────────────── */
  const cfg = window.NOIR_CONFIG || {};
  const CLOUD_MODE = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  let sb = null;
  if (CLOUD_MODE) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  /* ── Auth state ─────────────────────────────────────────────────── */
  const auth = {
    user: null,
    isStaff: false,
    listeners: new Set(),
    onChange(fn) { this.listeners.add(fn); fn(); },
    notify() { this.listeners.forEach(fn => fn()); },
  };

  /* Local-mode mock auth — pretends to be Supabase. Lets the portfolio
     demo work end-to-end without any backend keys. Persists across reloads
     via localStorage. */
  const localAuth = {
    signIn(email, password) {
      const e = String(email || "").trim().toLowerCase();
      const p = String(password || "");
      if (e !== DEMO_CREDS.email || p !== DEMO_CREDS.password) {
        return { ok: false, message: "Invalid email or password. Use the demo credentials shown above." };
      }
      const session = { email: DEMO_CREDS.email, signedInAt: Date.now() };
      localStorage.setItem(LOCAL_STAFF_KEY, JSON.stringify(session));
      auth.user = { email: session.email };
      auth.isStaff = true;
      auth.notify();
      return { ok: true };
    },
    signOut() {
      localStorage.removeItem(LOCAL_STAFF_KEY);
      auth.user = null;
      auth.isStaff = false;
      auth.notify();
    },
    restore() {
      try {
        const raw = localStorage.getItem(LOCAL_STAFF_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s?.email === DEMO_CREDS.email) {
          auth.user = { email: s.email };
          auth.isStaff = true;
        }
      } catch { /* ignore parse errors */ }
    },
  };

  async function initAuth() {
    if (!CLOUD_MODE) {
      // Local mode — restore mock session from localStorage and notify listeners.
      localAuth.restore();
      auth.notify();
      return;
    }
    const { data: { session } } = await sb.auth.getSession();
    auth.user = session?.user || null;
    auth.isStaff = await checkIsStaff();
    auth.notify();

    sb.auth.onAuthStateChange(async (_event, session) => {
      auth.user = session?.user || null;
      auth.isStaff = await checkIsStaff();
      auth.notify();
      renderAll();
      renderAuthGate();
    });
  }

  async function checkIsStaff() {
    if (!auth.user) return false;
    const { data, error } = await sb
      .from("staff")
      .select("user_id")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  }

  /* ── DB adapters ────────────────────────────────────────────────── */
  const localDb = {
    async list() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return seedLocal();
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length ? parsed : seedLocal();
      } catch { return seedLocal(); }
    },
    async create(r) {
      const all = await this.list();
      const row = {
        ...r,
        id: uid(),
        status: r.status || "pending",
        created_at: new Date().toISOString(),
      };
      all.unshift(row);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      return row;
    },
    async update(id, patch) {
      const all = await this.list();
      const r = all.find(x => x.id === id);
      if (r) Object.assign(r, patch);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      return r;
    },
    async remove(id) {
      const all = (await this.list()).filter(x => x.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    },
    async resetSeed() {
      localStorage.removeItem(STORAGE_KEY);
      return seedLocal();
    },
    subscribe() { return () => {}; },
    canMutate() { return auth.isStaff; },
    canDelete() { return auth.isStaff; },
  };

  function seedLocal() {
    const t = todayISO();
    const data = [
      { id: uid(), name: "Marchetti", guests: 4, date: addDaysISO(t, 3), time: "7:30 PM", status: "confirmed", phone: "(780) 555-0142", notes: "Anniversary — quiet booth if possible.", created_at: new Date(Date.now() - 86400000 * 6).toISOString() },
      { id: uid(), name: "Chen",      guests: 2, date: addDaysISO(t, 5), time: "8:00 PM", status: "pending",   phone: "(780) 555-0188", notes: "",                                       created_at: new Date(Date.now() - 86400000 * 4).toISOString() },
      { id: uid(), name: "Okafor",    guests: 6, date: addDaysISO(t, 7), time: "6:30 PM", status: "confirmed", phone: "(780) 555-0233", notes: "Vegetarian tasting for 2 of the party.", created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
      { id: uid(), name: "Tremblay",  guests: 2, date: addDaysISO(t, 1), time: "5:30 PM", status: "confirmed", phone: "(780) 555-0190", notes: "",                                       created_at: new Date(Date.now() - 86400000 * 1).toISOString() },
      { id: uid(), name: "Singh",     guests: 3, date: addDaysISO(t, 2), time: "8:30 PM", status: "pending",   phone: "(780) 555-0177", notes: "Wine pairing add-on.",                   created_at: new Date(Date.now() - 86400000 * 1).toISOString() },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  const cloudDb = {
    async list() {
      const { data, error } = await sb
        .from("reservations")
        .select("id, name, phone, date, time, guests, notes, status, created_at, user_id")
        .order("date", { ascending: true })
        .order("time", { ascending: true });
      if (error) { console.error(error); throw error; }
      return data || [];
    },
    async create(r) {
      const payload = {
        name: r.name, phone: r.phone, date: r.date, time: r.time,
        guests: r.guests, notes: r.notes || null,
        status: r.status || "pending",
        user_id: auth.user?.id || null,
      };
      const { data, error } = await sb.from("reservations").insert(payload).select().single();
      if (error) {
        if (/duplicate|reservations_slot_idx|unique/i.test(error.message)) {
          const e = new Error("That time was just taken — please pick another."); e.code = "slot_taken"; throw e;
        }
        throw error;
      }
      return data;
    },
    async update(id, patch) {
      const { data, error } = await sb.from("reservations").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    async remove(id) {
      const { error } = await sb.from("reservations").delete().eq("id", id);
      if (error) throw error;
    },
    async resetSeed() {
      // Cloud mode doesn't auto-reseed — too dangerous on shared data.
      throw new Error("Reset demo data is disabled in cloud mode. Use the SQL editor in Supabase.");
    },
    subscribe(callback) {
      const channel = sb
        .channel("reservations:realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => callback())
        .subscribe();
      return () => { sb.removeChannel(channel); };
    },
    canMutate() { return auth.isStaff; },
    canDelete() { return auth.isStaff; },
  };

  const db = CLOUD_MODE ? cloudDb : localDb;

  /* ── App state ──────────────────────────────────────────────────── */
  let reservations = [];
  let activeFilter = "all";   // "all" | "today" | "confirmed" | "pending" | "cancelled"
  let searchQuery  = "";
  let selectedTime = null;
  let unsubscribeRealtime = () => {};

  async function refresh() {
    try {
      reservations = await db.list();
    } catch (e) {
      console.error("Failed to load reservations:", e);
      reservations = [];
      showToast("Couldn't load reservations", e.message || "Check your connection.");
    }
    renderAll();
  }

  /* ── Theme ──────────────────────────────────────────────────────── */
  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    document.documentElement.setAttribute("data-theme", stored || "dark");
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  }

  /* ── Time slots ─────────────────────────────────────────────────── */
  function takenTimesForDate(iso) {
    if (!iso) return new Set();
    return new Set(
      reservations
        .filter(r => r.date === iso && r.status !== "cancelled" && r.status !== "no-show")
        .map(r => r.time)
    );
  }

  function renderSlots() {
    const grid = $("#slotGrid");
    if (!grid) return;
    const dateInput = $('input[name="date"]', $("#reserveForm"));
    const taken = takenTimesForDate(dateInput.value);

    grid.innerHTML = "";
    TIME_SLOTS.forEach(t => {
      const isTaken = taken.has(t);
      const isSelected = selectedTime === t;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot" + (isTaken ? " is-taken" : "") + (isSelected ? " is-selected" : "");
      btn.textContent = t;
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(isSelected));
      if (isTaken) {
        btn.disabled = true;
        btn.title = "This time is already taken";
      } else {
        btn.addEventListener("click", () => {
          selectedTime = t;
          renderSlots();
          clearError("time");
        });
      }
      grid.appendChild(btn);
    });

    if (selectedTime && taken.has(selectedTime)) {
      selectedTime = null;
      renderSlots();
    }
  }

  /* ── Form ───────────────────────────────────────────────────────── */
  function initForm() {
    const form = $("#reserveForm");
    if (!form) return;
    const dateInput = $('input[name="date"]', form);
    dateInput.min = todayISO();
    dateInput.value = addDaysISO(todayISO(), 2);
    dateInput.addEventListener("change", () => { selectedTime = null; renderSlots(); });
    form.addEventListener("submit", onSubmit);
    renderSlots();
  }

  function setError(field, msg) {
    const fieldEl = document.querySelector(`#reserveForm [name="${field}"]`)?.closest(".field");
    const slotsEl = field === "time" ? $("#reserveForm .slots") : null;
    const target = fieldEl || slotsEl;
    if (!target) return;
    target.classList.add("invalid");
    const small = target.querySelector(`.error[data-error="${field}"]`);
    if (small) small.textContent = msg;
  }
  function clearError(field) {
    const fieldEl = document.querySelector(`#reserveForm [name="${field}"]`)?.closest(".field");
    const slotsEl = field === "time" ? $("#reserveForm .slots") : null;
    const target = fieldEl || slotsEl;
    if (!target) return;
    target.classList.remove("invalid");
    const small = target.querySelector(`.error[data-error="${field}"]`);
    if (small) small.textContent = "";
  }
  function clearAllErrors() {
    ["name", "phone", "date", "guests", "time"].forEach(clearError);
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearAllErrors();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    let ok = true;
    if (!data.name || data.name.trim().length < 2) { setError("name", "Please enter your full name."); ok = false; }
    if (!data.phone || !/^[0-9()+\-\s]{7,}$/.test(data.phone)) { setError("phone", "Enter a reachable phone number."); ok = false; }
    if (!data.date) { setError("date", "Choose a date."); ok = false; }
    else if (data.date < todayISO()) { setError("date", "Pick a date in the future."); ok = false; }
    if (!data.guests) { setError("guests", "Select your party size."); ok = false; }
    if (!selectedTime) { setError("time", "Choose an available time."); ok = false; }
    if (!ok) return;

    if (takenTimesForDate(data.date).has(selectedTime)) {
      setError("time", "Just taken — please pick another.");
      renderSlots();
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Reserving…";

    try {
      const created = await db.create({
        name: data.name.trim(),
        phone: data.phone.trim(),
        date: data.date,
        time: selectedTime,
        guests: Number(data.guests),
        notes: (data.notes || "").trim(),
      });
      // Local mode: refresh from store. Cloud mode: realtime will fire too,
      // but refresh ensures the user sees their booking instantly.
      await refresh();
      showConfirmation(created);
      form.reset();
      selectedTime = null;
      $('input[name="date"]', form).value = addDaysISO(todayISO(), 2);
      renderSlots();
    } catch (err) {
      if (err.code === "slot_taken") {
        setError("time", err.message);
      } else {
        showToast("Couldn't save reservation", err.message || "Try again in a moment.");
      }
      await refresh();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  /* ── Public booking confirmation (replaces toast-only flow) ───────
     After a successful submit, we hide the form and reveal an inline
     confirmation card with the booking ID, summary, and an "Add to
     calendar" button that downloads a real .ics file. */
  let lastBooking = null;

  function showConfirmation(booking) {
    lastBooking = booking;
    const form    = $("#reserveForm");
    const confirm = $("#reserveConfirm");
    if (!form || !confirm) {
      // Defensive fallback — if the markup isn't on the page, toast like before.
      showToast("Reservation requested", `${booking.name} · ${formatDate(booking.date)} · ${booking.time}`);
      return;
    }

    $("#confirmId").textContent     = shortId(booking.id);
    $("#confirmName").textContent   = booking.name;
    $("#confirmWhen").textContent   = `${formatDate(booking.date)} · ${booking.time}`;
    $("#confirmGuests").textContent = `${booking.guests} guest${booking.guests === 1 ? "" : "s"}`;
    if (booking.notes) {
      $("#confirmNotesRow").hidden  = false;
      $("#confirmNotes").textContent = booking.notes;
    } else {
      $("#confirmNotesRow").hidden  = true;
    }

    form.hidden    = true;
    confirm.hidden = false;
    confirm.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("Reservation confirmed", `Booking #${shortId(booking.id)}`);
  }

  function hideConfirmation() {
    const form    = $("#reserveForm");
    const confirm = $("#reserveConfirm");
    if (!form || !confirm) return;
    confirm.hidden = true;
    form.hidden    = false;
    lastBooking    = null;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* Format a UUID-ish string into a shorter, customer-friendly booking number.
     e.g. "8f2c1a3b-4e5d-..." → "8F2C-1A3B" */
  function shortId(id) {
    if (!id) return "—";
    const clean = String(id).replace(/-/g, "").toUpperCase();
    return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
  }

  /* Build a tiny iCalendar file for the booking and trigger a download.
     Works in any modern browser; no library needed. */
  function downloadIcs(booking) {
    const start = parseSlotToDate(booking.date, booking.time);
    const end   = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2-hour seating
    const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const safe = (s) => String(s || "").replace(/[\r\n]+/g, " ").replace(/,/g, "\\,").replace(/;/g, "\\;");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Noir Table//Reservations//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${booking.id || Math.random().toString(36).slice(2)}@noirtable`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:Reservation at Noir Table — ${safe(booking.name)}`,
      `LOCATION:Noir Table\\, 10310 Whyte Ave NW\\, Edmonton\\, AB`,
      `DESCRIPTION:Booking #${shortId(booking.id)} — ${booking.guests} guest${booking.guests === 1 ? "" : "s"}.${booking.notes ? " " + safe(booking.notes) : ""}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `noir-table-${shortId(booking.id).toLowerCase()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* Convert ISO date + slot label like "2026-05-02" + "8:00 PM" → Date */
  function parseSlotToDate(iso, slot) {
    const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
    let h = m ? Number(m[1]) % 12 : 19;
    if (m && m[3].toUpperCase() === "PM") h += 12;
    const min = m ? Number(m[2]) : 0;
    const d = new Date(`${iso}T00:00:00`);
    d.setHours(h, min, 0, 0);
    return d;
  }

  function initConfirmation() {
    const confirm = $("#reserveConfirm");
    if (!confirm) return;
    $("#confirmIcsBtn")?.addEventListener("click", () => {
      if (lastBooking) downloadIcs(lastBooking);
    });
    $("#confirmAnotherBtn")?.addEventListener("click", hideConfirmation);
  }

  /* ── Toast ──────────────────────────────────────────────────────── */
  let toastTimer = null;
  function showToast(title, body) {
    const toast = $("#toast");
    $("#toastTitle").textContent = title;
    $("#toastBody").textContent = body;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
  }

  /* ── Reservation list rendering ─────────────────────────────────── */
  function buildResItem(r, opts = {}) {
    /* Defensive: normalize missing status to "pending". Older locally-stored
       rows (created before status was guaranteed) might lack the field. */
    if (!r.status) r.status = "pending";
    const li = document.createElement("li");
    li.className = "res";
    li.dataset.id = r.id;

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="res-name">${escapeHtml(r.name)}, ${r.guests} guest${r.guests === 1 ? "" : "s"}</div>
      <div class="res-meta">${formatDate(r.date)}<span class="dotsep">·</span>${escapeHtml(r.time)}${
        opts.mini ? "" : `<span class="dotsep">·</span>${escapeHtml(r.phone || "")}`
      }</div>
    `;
    li.appendChild(left);

    if (!opts.mini) li.appendChild(document.createElement("div"));

    const badge = document.createElement("span");
    badge.className = `badge ${r.status}`;
    badge.textContent = r.status;
    li.appendChild(badge);

    if (!opts.mini) {
      const actions = document.createElement("div");
      actions.className = "res-actions";
      // Status-aware action set:
      //   pending       → Confirm, Cancel
      //   confirmed     → Seat, No-show, Cancel
      //   seated        → (no extra actions — they're at the table)
      //   no-show       → Restore  (= back to confirmed)
      //   cancelled     → Restore
      const statusActions =
        r.status === "pending"   ? `<button class="ok" data-act="confirm">Confirm</button><button class="danger" data-act="cancel">Cancel</button>` :
        r.status === "confirmed" ? `<button class="ok" data-act="seat">Seat</button><button class="warn" data-act="no-show">No-show</button><button class="danger" data-act="cancel">Cancel</button>` :
        r.status === "seated"    ? `` :
        r.status === "no-show"   ? `<button data-act="confirm">Restore</button>` :
        r.status === "cancelled" ? `<button data-act="confirm">Restore</button>` :
        ``;
      actions.innerHTML = `
        <button class="icon-act" data-act="edit" title="Edit booking" aria-label="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        ${statusActions}
        <button class="icon-act" data-act="delete" title="Delete" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      actions.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "confirm")        await updateStatus(r.id, "confirmed");
        else if (act === "seat")      await updateStatus(r.id, "seated");
        else if (act === "no-show")   await updateStatus(r.id, "no-show");
        else if (act === "cancel")    await updateStatus(r.id, "cancelled");
        else if (act === "delete")    await deleteRes(r.id);
        else if (act === "edit")      openBookingModal(r);
      });
      li.appendChild(actions);

      if (r.notes) {
        const notes = document.createElement("div");
        notes.className = "res-notes";
        notes.textContent = `“${r.notes}”`;
        li.appendChild(notes);
      }
    }
    return li;
  }

  async function updateStatus(id, status, opts = {}) {
    if (!db.canMutate()) {
      showToast("Staff only", "Sign in with a staff account to manage reservations.");
      return;
    }
    try {
      const r = await db.update(id, { status });
      if (!opts.silent) await refresh();
      if (!opts.silent) {
        const titleByStatus = {
          confirmed: "Confirmed",
          seated:    "Seated",
          "no-show": "Marked no-show",
          cancelled: "Cancelled",
          pending:   "Set to pending",
        };
        showToast(
          titleByStatus[status] || "Updated",
          `${r.name} · ${formatDate(r.date)} · ${r.time}`
        );
      }
      return r;
    } catch (e) {
      if (!opts.silent) showToast("Update failed", e.message);
      throw e;
    }
  }

  async function deleteRes(id) {
    if (!db.canDelete()) {
      showToast("Staff only", "Sign in with a staff account to manage reservations.");
      return;
    }
    const r = reservations.find(x => x.id === id);
    if (!r) return;
    try {
      await db.remove(id);
      await refresh();
      showToast("Reservation removed", `${r.name} · ${formatDate(r.date)}`);
    } catch (e) {
      showToast("Delete failed", e.message);
    }
  }

  /* ── Admin ──────────────────────────────────────────────────────── */
  function renderAdmin() {
    const gated = $("#adminGated");
    if (!gated) return; // not on the admin page
    const locked = $("#adminLocked");
    const actions = $("#adminActions");
    const sub = $("#adminSub");
    const lockedMsg = $("#adminLockedMsg");

    // Cloud mode without staff → locked.
    if (CLOUD_MODE && !auth.isStaff) {
      gated.hidden = true;
      locked.hidden = false;
      actions.style.visibility = "hidden";
      if (auth.user) {
        lockedMsg.textContent = `Signed in as ${auth.user.email}, but your account isn't on the staff list yet. Run select promote_to_staff('${auth.user.email}'); in Supabase SQL editor.`;
        $("#adminLockedBtn").hidden = true;
      } else {
        lockedMsg.textContent = "Sign in with a staff account to view, confirm, or cancel reservations.";
        $("#adminLockedBtn").hidden = false;
      }
      sub.textContent = "Live data from Supabase. Staff-only.";
      return;
    }

    gated.hidden = false;
    locked.hidden = true;
    if (actions) actions.style.visibility = "visible";
    sub.textContent = `Confirm bookings, add walk-ins, and manage tonight's seatings. Signed in as ${auth.user?.email || "staff"}.`;

    // Hide reset-demo button in cloud mode (would require a destructive SQL).
    const seedBtn = $("#seedBtn");
    if (seedBtn) seedBtn.hidden = CLOUD_MODE;

    const list = $("#adminList");
    const empty = $("#adminEmpty");
    list.innerHTML = "";

    const filtered = applyFilters(reservations);
    empty.hidden = filtered.length !== 0;
    if (empty.hidden === false) {
      empty.textContent = searchQuery
        ? `No reservations match “${searchQuery}”.`
        : activeFilter === "today"
          ? "No reservations for today."
          : "No reservations match this filter.";
    }
    filtered.forEach(r => list.appendChild(buildResItem(r)));
    renderStats();
  }

  /* Apply active filter chip + search query to the full reservations list. */
  function applyFilters(list) {
    const today = todayISO();
    const q = searchQuery.trim().toLowerCase();
    return list
      .filter(r => {
        if (activeFilter === "today")     return r.date === today && r.status !== "cancelled" && r.status !== "no-show";
        if (activeFilter === "all")       return true;
        return r.status === activeFilter;
      })
      .filter(r => {
        if (!q) return true;
        return (r.name || "").toLowerCase().includes(q)
            || (r.phone || "").toLowerCase().includes(q);
      })
      .sort(byDateTime);
  }

  function renderStats() {
    const stats = $("#adminStats");
    const today = todayISO();
    const total = reservations.length;
    const confirmed = reservations.filter(r => r.status === "confirmed").length;
    const seatedToday = reservations.filter(r => r.status === "seated" && r.date === today).length;
    /* Upcoming guests = future-dated bookings that are still alive
       (cancelled and no-show explicitly excluded). */
    const upcomingGuests = reservations
      .filter(r => r.date >= today && r.status !== "cancelled" && r.status !== "no-show")
      .reduce((sum, r) => sum + (r.guests || 0), 0);

    stats.innerHTML = `
      <div class="stat"><span class="stat-num gold">${total}</span><span class="stat-label">Total bookings</span></div>
      <div class="stat"><span class="stat-num">${confirmed}</span><span class="stat-label">Confirmed</span></div>
      <div class="stat"><span class="stat-num">${seatedToday}</span><span class="stat-label">Seated today</span></div>
      <div class="stat"><span class="stat-num">${upcomingGuests}</span><span class="stat-label">Upcoming guests</span></div>
    `;
  }

  function initFilters() {
    const chips = $$(".chip");
    if (!chips.length) return;
    chips.forEach(chip => {
      chip.addEventListener("click", () => {
        chips.forEach(c => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        activeFilter = chip.dataset.filter;
        renderAdmin();
      });
    });
  }

  function exportCsv() {
    if (reservations.length === 0) {
      showToast("Nothing to export", "Add a reservation first.");
      return;
    }
    const headers = ["Name", "Phone", "Date", "Time", "Guests", "Status", "Notes", "Created"];
    const rows = reservations
      .slice()
      .sort(byDateTime)
      .map(r => [
        r.name, r.phone, r.date, r.time, r.guests, r.status,
        (r.notes || "").replace(/\s+/g, " "),
        r.created_at || "",
      ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => {
        const s = String(cell ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `noir-table-reservations-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("CSV exported", `${reservations.length} reservation${reservations.length === 1 ? "" : "s"} downloaded.`);
  }

  /* ── Auth UI ──────────────────────────────────────────────────────
     Show the user-chip + sign-out button whenever someone is signed in,
     regardless of mode. In local mode the staff pill is always on (the
     mock user is staff by definition); in cloud mode it reflects the
     staff table membership. */
  function renderAuth() {
    const signInBtn = $("#signInBtn");
    const userChip  = $("#userChip");
    if (!signInBtn && !userChip) return; // page has no auth chrome

    if (auth.user) {
      if (signInBtn) signInBtn.hidden = true;
      if (userChip)  userChip.hidden = false;
      const userEmail = $("#userEmail");
      const staffPill = $("#staffPill");
      if (userEmail) userEmail.textContent = auth.user.email;
      if (staffPill) staffPill.hidden = !auth.isStaff;
    } else {
      if (signInBtn) signInBtn.hidden = false;
      if (userChip)  userChip.hidden = true;
    }
  }

  function setAuthMsg(text, kind) {
    const el = $("#authMsg");
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; el.className = "auth-msg"; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = "auth-msg " + (kind || "info");
  }

  async function handleAuth(mode, email, password) {
    setAuthMsg("Signing in…", "info");
    try {
      if (CLOUD_MODE) {
        if (mode === "signup") {
          const { data, error } = await sb.auth.signUp({ email, password });
          if (error) throw error;
          if (!data.session) {
            setAuthMsg("Account created. Check your email to confirm, then sign in here.", "success");
            return;
          }
          setAuthMsg("Welcome to Noir Table.", "success");
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
          setAuthMsg("Signed in.", "success");
        }
      } else {
        // Local mode — only sign-in is meaningful (no signup ceremony).
        if (mode === "signup") {
          setAuthMsg("Demo mode — sign-up is disabled. Use the demo credentials shown above.", "info");
          return;
        }
        const result = localAuth.signIn(email, password);
        if (!result.ok) throw new Error(result.message);
        setAuthMsg("Signed in. Loading dashboard…", "success");
        renderAuthGate();
      }
    } catch (e) {
      setAuthMsg(e.message || "Something went wrong.", "error");
    }
  }

  async function signOut() {
    if (CLOUD_MODE) {
      await sb.auth.signOut();
    } else {
      localAuth.signOut();
    }
    showToast("Signed out", "See you next service.");
    renderAuthGate();
  }

  /* ── Auth gate (admin-only) ──────────────────────────────────────
     Inline sign-in screen that replaces the dashboard until staff is signed in.
     Three rendered states:
       1. Local mode + not signed in        → gate visible (with demo creds box)
       2. Cloud mode + not signed in        → gate visible (no demo creds)
       3. Cloud mode + signed in, not staff → gate hidden, dashboard "locked" panel
     When signed in as staff, the full dashboard renders. */
  function renderAuthGate() {
    if (!isAdminPage) return;
    const gate  = $("#authGate");
    const admin = $("#admin");
    if (!gate || !admin) return;

    const signedIn = Boolean(auth.user);
    const showGate = !signedIn;

    gate.hidden  = !showGate;
    admin.hidden = showGate;
    document.body.classList.toggle("is-gated", showGate);

    // Show "Create account" only in cloud mode (Supabase signup makes sense there).
    const signupBtn = $("#signupBtn");
    if (signupBtn) signupBtn.hidden = !CLOUD_MODE;

    if (showGate) setAuthMsg("", null);
  }

  function initAuthGate() {
    if (!isAdminPage) return;
    const form = $("#authForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      handleAuth("signin", fd.get("email"), fd.get("password"));
    });

    $("#signupBtn")?.addEventListener("click", () => {
      const fd = new FormData(form);
      const email = (fd.get("email") || "").trim();
      const password = fd.get("password") || "";
      if (!email || password.length < 6) {
        setAuthMsg("Enter an email and a password (≥ 6 characters) to create an account.", "error");
        return;
      }
      handleAuth("signup", email, password);
    });
  }

  /* Global Esc handler — closes whichever modal is open. */
  function initEscClose() {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const menu    = $("#menuModal");
      const booking = $("#bookingModal");
      if (menu && !menu.hidden)       closeMenuModal();
      if (booking && !booking.hidden) closeBookingModal();
    });
  }

  /* ── Menu modal (printable PDF view) ────────────────────────────── */
  function openMenuModal() {
    const modal = $("#menuModal");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    $("#menuSheet")?.scrollTo({ top: 0 });
  }
  function closeMenuModal() {
    const modal = $("#menuModal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function initMenuModal() {
    const modal = $("#menuModal");
    if (!modal) return;

    // Intercept any link pointing at #menu (top nav, hero "View Menu")
    document.querySelectorAll('a[href="#menu"], a[href$="#menu"]').forEach(link => {
      link.addEventListener("click", (e) => {
        // Allow modifier-clicks to behave like normal links (open in new tab, etc.).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        openMenuModal();
      });
    });

    modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeMenuModal();
    });

    $("#menuPrintBtn")?.addEventListener("click", () => {
      // Browser's "Save as PDF" lives inside the print dialog. The print
      // stylesheet (styles.css @media print) ensures only the menu sheet prints.
      window.print();
    });
  }

  /* ── Booking modal (staff: new + edit) ──────────────────────────── */
  function openBookingModal(existing) {
    const modal = $("#bookingModal");
    if (!modal) return;
    const form = $("#bookingForm");
    const title  = $("#bookingModalTitle");
    const sub    = $("#bookingModalSub");
    const kicker = $("#bookingModalKicker");
    const msg    = $("#bookingMsg");

    form.reset();
    if (msg) { msg.hidden = true; msg.textContent = ""; }

    if (existing) {
      kicker.textContent = "House view · edit";
      title.textContent  = `Edit booking · ${existing.name}`;
      sub.textContent    = "Update any field below. Changes are saved immediately.";
      form.querySelector('[name="id"]').value     = existing.id;
      form.querySelector('[name="name"]').value   = existing.name || "";
      /* Treat single em-dash as "no phone" so legacy walk-ins open with a
         clean field instead of an unmanageable placeholder. */
      form.querySelector('[name="phone"]').value  = (existing.phone === "—") ? "" : (existing.phone || "");
      form.querySelector('[name="date"]').value   = existing.date || todayISO();
      form.querySelector('[name="time"]').value   = existing.time || "";
      form.querySelector('[name="guests"]').value = String(existing.guests || 2);
      form.querySelector('[name="status"]').value = existing.status || "confirmed";
      form.querySelector('[name="notes"]').value  = existing.notes || "";
      form.querySelector('button[type="submit"]').textContent = "Save changes";
    } else {
      kicker.textContent = "House view · new";
      title.textContent  = "New booking";
      sub.textContent    = "Add a reservation taken over the phone, or seat a walk-in. Phone and notes are optional.";
      form.querySelector('[name="id"]').value     = "";
      form.querySelector('[name="date"]').value   = todayISO();
      form.querySelector('[name="status"]').value = "confirmed";
      form.querySelector('button[type="submit"]').textContent = "Save booking";
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => form.querySelector('[name="name"]').focus(), 50);
  }

  function closeBookingModal() {
    const modal = $("#bookingModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function setBookingMsg(text, kind) {
    const el = $("#bookingMsg");
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; el.className = "auth-msg"; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = "auth-msg " + (kind || "info");
  }

  function readBookingForm(form) {
    const fd = new FormData(form);
    const get = (k) => String(fd.get(k) || "").trim();
    return {
      id:     get("id") || null,
      name:   get("name"),
      phone:  get("phone"),
      date:   get("date"),
      time:   get("time"),
      guests: Number(get("guests")) || 0,
      status: STATUSES.includes(get("status")) ? get("status") : "confirmed",
      notes:  get("notes") || null,
    };
  }

  function validateBooking(b) {
    if (!b.name || b.name.length < 2)                                      return "Please enter the guest's name.";
    /* Phone is optional — walk-ins legitimately don't have one. If provided,
       still validate the format. */
    if (b.phone && !/^[0-9()+\-\s]{7,}$/.test(b.phone))                    return "Please enter a valid phone number.";
    if (!b.date)                                                           return "Please choose a date.";
    if (!b.time)                                                           return "Please choose a time.";
    if (!b.guests || b.guests < 1)                                         return "Please select party size.";
    return null;
  }

  function initBookingModal() {
    const modal = $("#bookingModal");
    if (!modal) return;
    const form = $("#bookingForm");

    modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeBookingModal();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = readBookingForm(form);
      const err = validateBooking(data);
      if (err) { setBookingMsg(err, "error"); return; }

      setBookingMsg("Saving…", "info");
      try {
        if (data.id) {
          // Edit flow — update fields, then sync status if it changed.
          await db.update(data.id, {
            name: data.name, phone: data.phone, date: data.date,
            time: data.time, guests: data.guests, notes: data.notes,
          });
          await updateStatus(data.id, data.status, { silent: true });
          showToast("Booking updated", `${data.name} · ${formatDate(data.date)} · ${data.time}`);
        } else {
          // New booking — create with the chosen status.
          const created = await db.create({
            name: data.name, phone: data.phone, date: data.date,
            time: data.time, guests: data.guests, notes: data.notes,
            status: data.status,
          });
          // Local mode insert defaults status to whatever's passed; cloud mode now does too.
          if (created && created.status !== data.status) {
            await updateStatus(created.id, data.status, { silent: true });
          }
          showToast("Booking added", `${data.name} · ${formatDate(data.date)} · ${data.time}`);
        }
        await refresh();
        closeBookingModal();
      } catch (e2) {
        setBookingMsg(e2.message || "Couldn't save booking.", "error");
      }
    });
  }

  /* ── Walk-in quick-add ──────────────────────────────────────────── */
  async function addWalkIn() {
    if (!auth.isStaff && CLOUD_MODE) {
      showToast("Sign in required", "Walk-ins can only be added by staff.");
      return;
    }
    // Round current time to the nearest TIME_SLOT for consistent display.
    const now = new Date();
    const time = nearestSlot(now);
    // Auto-name walk-ins with a 2-letter sequence so they're easy to find.
    const count = reservations.filter(r => /^Walk-in/i.test(r.name || "")).length + 1;
    const name = `Walk-in ${count}`;

    try {
      await db.create({
        name,
        phone: "",
        date: todayISO(),
        time,
        guests: 2,
        notes: "Walk-in · added from house view",
        status: "confirmed",
      });
      await refresh();
      showToast("Walk-in seated", `${name} · ${time} · 2 guests`);
    } catch (e) {
      showToast("Couldn't add walk-in", e.message);
    }
  }

  /* Pick the closest TIME_SLOT to a given Date (ties round down). */
  function nearestSlot(d) {
    const target = d.getHours() * 60 + d.getMinutes();
    const toMin = (slot) => {
      const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return 0;
      let h = Number(m[1]) % 12;
      if (m[3].toUpperCase() === "PM") h += 12;
      return h * 60 + Number(m[2]);
    };
    let best = TIME_SLOTS[0];
    let bestDiff = Infinity;
    for (const slot of TIME_SLOTS) {
      const diff = Math.abs(toMin(slot) - target);
      if (diff < bestDiff) { bestDiff = diff; best = slot; }
    }
    return best;
  }

  /* ── Search ─────────────────────────────────────────────────────── */
  function initSearch() {
    const input = $("#adminSearchInput");
    const clear = $("#adminSearchClear");
    if (!input) return;

    const sync = () => {
      searchQuery = input.value || "";
      if (clear) clear.hidden = !searchQuery;
      renderAdmin();
    };
    input.addEventListener("input", sync);
    clear?.addEventListener("click", () => {
      input.value = "";
      sync();
      input.focus();
    });
  }

  /* ── Boot ───────────────────────────────────────────────────────── */
  function renderAll() {
    renderAdmin();   // no-op if not on admin page
    renderSlots();   // no-op if no #slotGrid
    renderAuth();    // no-op if no auth chrome
  }

  async function init() {
    initTheme();
    initEscClose();

    /* Public page features */
    if (isPublicPage) {
      initForm();
      initMenuModal();
      initConfirmation();
    }

    /* Admin page features */
    if (isAdminPage) {
      initFilters();
      initAuthGate();
      initBookingModal();
      initSearch();

      $("#signOutBtn")?.addEventListener("click", signOut);
      $("#newBookingBtn")?.addEventListener("click", () => openBookingModal(null));
      $("#walkinBtn")?.addEventListener("click", addWalkIn);
      $("#exportCsv")?.addEventListener("click", exportCsv);
      $("#seedBtn")?.addEventListener("click", async () => {
        try {
          await db.resetSeed();
          await refresh();
          activeFilter = "all";
          $$(".chip").forEach(c => c.classList.toggle("is-active", c.dataset.filter === "all"));
          showToast("Demo data reset", "Sample reservations restored.");
        } catch (e) {
          showToast("Couldn't reset", e.message);
        }
      });
    }

    /* Shared chrome */
    $("#themeToggle")?.addEventListener("click", toggleTheme);

    auth.onChange(() => { renderAuth(); renderAuthGate(); });
    await initAuth();

    /* Realtime: only the admin needs live updates of the reservation table.
       The public page only cares about which slots are taken when somebody
       is filling out the form, and refresh() is called after their own submit. */
    if (isAdminPage) {
      unsubscribeRealtime = db.subscribe(refresh);
      window.addEventListener("beforeunload", () => unsubscribeRealtime?.());
    }

    /* Public page: load reservations once so the slot picker can mark
       already-taken times. Admin page: load + render the dashboard. */
    await refresh();

    if (CLOUD_MODE) {
      console.info(`%cNoir Table %c· ${PAGE} page · cloud mode (Supabase) · ${isAdminPage ? "realtime on" : "anonymous booking"}`,
        "color:#c9a86a;font-weight:600", "color:#888");
    } else {
      console.info(`%cNoir Table %c· ${PAGE} page · local mode (localStorage). Add Supabase keys to config.js for cloud + auth.`,
        "color:#c9a86a;font-weight:600", "color:#888");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
