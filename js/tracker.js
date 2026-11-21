// tracker.js
// Records every button click, dropdown change and app action to the BEU API
// (MongoDB Atlas), next to the existing Google Analytics 4 tracking.
//
// Purely additive: app.js is not modified. This file
//   1. listens for clicks / changes / Escape on `document` (capture phase),
//   2. wraps window.trackGA4Event so every GA4 event is mirrored to MongoDB,
//   3. batches events and sends them in the background (never blocks the UI).
// If js/config.js has no apiBase, this file does nothing at all.

(() => {
  "use strict";

  const cfg = window.BEU_CONFIG || {};
  let API = String(cfg.apiBase || "")
    .trim()
    .replace(/\/+$/, "");
  // "my-api.vercel.app" without a scheme would be read as a path on this site
  if (API && !/^https?:\/\//i.test(API)) {
    API = `https://${API}`;
  }
  if (!API) {
    return;
  }

  const TRACK_URL = `${API}/api/track`;
  const VISITOR_KEY = "beu_visitor_id";
  const SESSION_KEY = "beu_session_id";
  const QUEUE_KEY = "beu_evt_queue";
  const MAX_BATCH = 20;
  const MAX_QUEUE = 100;
  const FLUSH_DELAY_MS = 4000;
  const MAX_BACKOFF_MS = 60000;
  const HEARTBEAT_MS =
    Number(cfg.heartbeatMs) > 0 ? Number(cfg.heartbeatMs) : 60000;
  const MIRROR_UI_TO_GA = cfg.mirrorUiEventsToGA !== false;
  const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

  // ---------- storage (can throw in private mode / blocked cookies) ----------
  function storage(kind) {
    try {
      return window[kind];
    } catch {
      return null;
    }
  }
  const local = storage("localStorage");
  const session = storage("sessionStorage");

  function read(store, key) {
    try {
      return store ? store.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function write(store, key, value) {
    try {
      if (store) {
        store.setItem(key, value);
      }
    } catch {
      // storage full / blocked: tracking continues in memory
    }
  }

  function randomId() {
    const c = window.crypto;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") {
      c.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------- identity: anonymous random ids, no personal data ----------
  let visitorId = read(local, VISITOR_KEY);
  const isReturning = ID_RE.test(visitorId || "");
  if (!isReturning) {
    visitorId = randomId();
    write(local, VISITOR_KEY, visitorId);
  }

  let sessionId = read(session, SESSION_KEY);
  const isNewSession = !ID_RE.test(sessionId || "");
  if (isNewSession) {
    sessionId = randomId();
    write(session, SESSION_KEY, sessionId);
  }

  // ---------- helpers ----------
  function cleanName(name) {
    return (
      String(name || "")
        .replace(/[^A-Za-z0-9_.:-]/g, "_")
        .slice(0, 80) || "unknown"
    );
  }

  // Flat { key: string|number|boolean } only; same rules the server enforces.
  function cleanData(data) {
    const out = {};
    if (!data || typeof data !== "object") {
      return out;
    }
    Object.keys(data)
      .slice(0, 20)
      .forEach((key) => {
        const value = data[key];
        const k = key.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
        if (!k) {
          return;
        }
        if (typeof value === "string") {
          out[k] = value.slice(0, 200);
        } else if (typeof value === "boolean") {
          out[k] = value;
        } else if (typeof value === "number" && Number.isFinite(value)) {
          out[k] = value;
        }
      });
    return out;
  }

  function displayMode() {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        return "standalone";
      }
      if (window.matchMedia("(display-mode: fullscreen)").matches) {
        return "fullscreen";
      }
      if (window.matchMedia("(display-mode: minimal-ui)").matches) {
        return "minimal-ui";
      }
      if (window.navigator.standalone === true) {
        return "standalone";
      }
    } catch {
      // matchMedia unavailable
    }
    return "browser";
  }

  // ---------- queue + transport ----------
  let queue = [];
  try {
    const saved = JSON.parse(read(local, QUEUE_KEY) || "[]");
    if (Array.isArray(saved)) {
      queue = saved.slice(-MAX_QUEUE);
    }
  } catch {
    queue = [];
  }

  function persist() {
    write(local, QUEUE_KEY, JSON.stringify(queue));
  }

  let timer = null;
  let flushing = false;
  let failures = 0;
  let leftSent = false; // a leave marker was sent; cleared when the page is shown again

  function schedule(delay) {
    if (timer) {
      return;
    }
    timer = setTimeout(
      () => {
        timer = null;
        flush();
      },
      delay === undefined ? FLUSH_DELAY_MS : delay,
    );
  }

  function buildBody(batch, leave = false) {
    return JSON.stringify({
      v: 1,
      visitorId,
      sessionId,
      // true = "this page is going away": the server stops counting this
      // visitor as active right away instead of waiting for the window.
      ...(leave ? { leave: true } : {}),
      meta: {
        displayMode: displayMode(),
        lang: navigator.language || "",
        screen: `${window.screen ? window.screen.width : 0}x${window.screen ? window.screen.height : 0}`,
        path: location.pathname,
      },
      events: batch.map((e) => ({
        type: e.type,
        name: e.name,
        ts: e.ts,
        data: e.data,
      })),
    });
  }

  // `force` sends even with an empty queue; that is the "I'm still here" ping.
  // `beacon` is used when the page is going away (fetch may be cancelled).
  async function flush({ force = false, beacon = false } = {}) {
    if (!queue.length && !force) {
      return;
    }
    if (beacon) {
      // Page is hidden / closing. Send what is queued PLUS the leave marker,
      // even when the queue is empty: that marker is the disconnect signal.
      if (leftSent || !navigator.sendBeacon) {
        return;
      }
      const batch = queue.slice(0, MAX_BATCH);
      const blob = new Blob([buildBody(batch, true)], {
        type: "text/plain;charset=UTF-8",
      });
      if (navigator.sendBeacon(TRACK_URL, blob)) {
        leftSent = true;
        queue = queue.filter((e) => !batch.includes(e));
        persist();
      }
      return;
    }
    if (flushing || navigator.onLine === false) {
      return; // the "online" listener retries
    }

    clearTimeout(timer);
    timer = null;
    flushing = true;
    const batch = queue.slice(0, MAX_BATCH);

    try {
      const res = await fetch(TRACK_URL, {
        method: "POST",
        // text/plain keeps this a "simple" CORS request (no preflight round trip)
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: buildBody(batch),
        keepalive: true,
        credentials: "omit",
      });

      const rejectedForGood =
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 408 &&
        res.status !== 429;
      if (res.ok || rejectedForGood) {
        // delivered, or rejected for good (bad data): never retry the same batch
        queue = queue.filter((e) => !batch.includes(e));
        persist();
        failures = 0;
        if (
          res.ok &&
          batch.some(
            (e) => e.type === "action" && e.name === "syllabus_download",
          )
        ) {
          window.dispatchEvent(new CustomEvent("beu:download-recorded"));
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      failures++;
      schedule(Math.min(FLUSH_DELAY_MS * 2 ** failures, MAX_BACKOFF_MS));
    } finally {
      flushing = false;
    }

    if (queue.length && !timer && failures === 0) {
      schedule(500);
    }
  }

  function record(type, name, data) {
    queue.push({
      type,
      name: cleanName(name),
      ts: Date.now(),
      data: cleanData(data),
    });
    if (queue.length > MAX_QUEUE) {
      queue = queue.slice(-MAX_QUEUE);
    }
    persist();
    if (queue.length >= MAX_BATCH) {
      flush();
    } else {
      schedule();
    }
  }

  // ---------- Google Analytics mirror for raw UI events ----------
  function gaUi(eventName, params) {
    if (!MIRROR_UI_TO_GA || typeof window.gtag !== "function") {
      return;
    }
    try {
      window.gtag("event", eventName, {
        ...params,
        app_name: "BEU Syllabus App",
      });
    } catch {
      // analytics must never break the app
    }
  }

  // ---------- 1) every existing GA4 event is mirrored to MongoDB ----------
  // app.js calls trackGA4Event(...) for: open_syllabus_click, syllabus_download,
  // syllabus_share, developer_info_click, pwa_install_button_click,
  // pwa_install_available, pwa_installed. The wrapper keeps the original
  // behaviour 100% and only adds the MongoDB copy.
  const originalGA = window.trackGA4Event;
  if (typeof originalGA === "function") {
    window.trackGA4Event = function trackGA4EventWithMongo(eventName, params) {
      try {
        return originalGA.apply(this, arguments);
      } finally {
        try {
          record("action", eventName, params);
        } catch {
          // never let the copy affect the original call
        }
      }
    };
  }

  // ---------- 2) raw UI interaction ----------
  function context() {
    const val = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : "";
    };
    const modal = document.querySelector(".modal.active");
    return {
      branch: val("branch"),
      semester: val("sem"),
      session: val("session"),
      modal: modal ? modal.id : "main",
    };
  }

  function safeHref(a) {
    try {
      const u = new URL(a.href, location.href);
      return u.protocol === "http:" || u.protocol === "https:"
        ? u.origin + u.pathname // drop query/hash (e.g. the WhatsApp text)
        : u.protocol.replace(":", "");
    } catch {
      return "";
    }
  }

  function onClick(e) {
    if (!e.isTrusted) {
      return; // ignore script-made clicks (e.g. the hidden download <a>)
    }
    const target = e.target;
    if (!(target instanceof Element)) {
      return;
    }

    // Clicking the dark backdrop closes a modal (app.js handles it)
    if (target.classList.contains("modal")) {
      record("action", "modal_backdrop_close", { modal: target.id });
      return;
    }

    const el = target.closest("button, a[href], [role='button']");
    if (!el) {
      return;
    }

    const name = el.id || el.classList[0] || "" || el.tagName.toLowerCase();
    const text = (el.getAttribute("aria-label") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const ctx = context();
    const data = { tag: el.tagName.toLowerCase(), text, ...ctx };
    if (el.tagName === "A") {
      data.href = safeHref(el);
    }

    record("click", name, data);
    gaUi("ui_click", {
      element_id: cleanName(name),
      element_text: text,
      click_modal: ctx.modal,
    });
  }

  function onChange(e) {
    const t = e.target;
    if (!e.isTrusted || !(t instanceof HTMLSelectElement)) {
      return;
    }
    const name = t.id || t.name || "select";
    record("change", name, { value: t.value, ...context() });
    gaUi("ui_select_change", {
      element_id: cleanName(name),
      selected_value: t.value,
    });
  }

  function onKeydown(e) {
    if (e.key !== "Escape") {
      return;
    }
    const modal = document.querySelector(".modal.active");
    if (modal) {
      record("action", "modal_escape_close", { modal: modal.id });
    }
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKeydown, true);

  // ---------- 3) lifecycle: heartbeat, flush on leave / reconnect ----------
  // "Leave" fires on hidden AND pagehide: mobile browsers / installed PWAs
  // often skip pagehide when the app is swiped away, but always go hidden first.
  function comeBack() {
    leftSent = false;
    flush({ force: true }); // heartbeat: the server counts us as active again
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush({ beacon: true });
    } else {
      comeBack();
    }
  });
  window.addEventListener("pagehide", () => flush({ beacon: true }));
  // Page restored from the back/forward cache: no load event, so re-announce.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      comeBack();
    }
  });
  window.addEventListener("online", () => flush({ force: true }));

  setInterval(() => {
    if (document.visibilityState === "visible") {
      flush({ force: true });
    }
  }, HEARTBEAT_MS);

  // ---------- start ----------
  let referrerHost = "";
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname : "";
  } catch {
    referrerHost = "";
  }

  if (isNewSession) {
    record("session_start", "session_start", { returning: isReturning });
  }
  record("page_view", "page_view", {
    referrer: referrerHost,
    display_mode: displayMode(),
  });
  schedule(300);

  // Optional hook for future custom actions: BEUTracker.track("name", {k: "v"})
  window.BEUTracker = {
    track(name, data) {
      record("action", name, data);
    },
  };
})();
