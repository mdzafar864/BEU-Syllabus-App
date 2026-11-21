// stats.js
// Fills the stats bar (#stats-bar) under the Install / "App Mode Active"
// button with Total users, Active users and Total downloads from the BEU API.
//
// Last known numbers are cached in localStorage, so the bar still shows
// something useful when the phone is offline. Without an apiBase (js/config.js)
// the bar just shows "—".

(() => {
  "use strict";

  const bar = document.getElementById("stats-bar");
  if (!bar) {
    return;
  }

  const cfg = window.BEU_CONFIG || {};
  let API = String(cfg.apiBase || "")
    .trim()
    .replace(/\/+$/, "");
  // "my-api.vercel.app" without a scheme would be read as a path on this site
  if (API && !/^https?:\/\//i.test(API)) {
    API = `https://${API}`;
  }
  const REFRESH_MS =
    Number(cfg.statsRefreshMs) > 0 ? Number(cfg.statsRefreshMs) : 60000;
  const MIN_GAP_MS = Math.min(20000, REFRESH_MS);
  const CACHE_KEY = "beu_stats_cache";

  const fields = {
    totalUsers: bar.querySelector('[data-stat="totalUsers"]'),
    activeUsers: bar.querySelector('[data-stat="activeUsers"]'),
    totalDownloads: bar.querySelector('[data-stat="totalDownloads"]'),
  };

  const reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const shown = {}; // numbers currently displayed (to animate from)
  const frames = {}; // running animation per field

  function format(n) {
    if (n < 10000) {
      return n.toLocaleString("en-IN");
    }
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }

  function setValue(key, target) {
    const el = fields[key];
    if (!el) {
      return;
    }
    cancelAnimationFrame(frames[key]);

    const from = Number.isFinite(shown[key]) ? shown[key] : 0;
    shown[key] = target;

    if (reduceMotion || from === target) {
      el.textContent = format(target);
      return;
    }

    const start = performance.now();
    const duration = 700;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      el.textContent = format(Math.round(from + (target - from) * eased));
      if (p < 1) {
        frames[key] = requestAnimationFrame(step);
      }
    };
    frames[key] = requestAnimationFrame(step);
  }

  function apply(data) {
    setValue("totalUsers", data.totalUsers);
    setValue("activeUsers", data.activeUsers);
    setValue("totalDownloads", data.totalDownloads);

    const minutes = Number(data.activeWindowMinutes);
    if (minutes > 0 && fields.activeUsers) {
      const stat = fields.activeUsers.closest(".stat");
      if (stat) {
        stat.title = `Users active in the last ${minutes} minute${minutes === 1 ? "" : "s"}`;
      }
    }
    bar.dataset.state = "ready";
    bar.removeAttribute("aria-busy");
  }

  function valid(data) {
    return (
      data &&
      ["totalUsers", "activeUsers", "totalDownloads"].every(
        (k) => Number.isFinite(data[k]) && data[k] >= 0,
      )
    );
  }

  // Show the last known numbers immediately (also works offline).
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (valid(cached)) {
      apply(cached);
      bar.dataset.state = "cached";
    }
  } catch {
    // no storage / bad JSON: wait for the network
  }

  let lastLoad = 0;
  let loading = false;

  async function load() {
    if (!API || loading) {
      return;
    }
    loading = true;
    lastLoad = Date.now();
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${API}/api/stats`, {
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!valid(data)) {
        throw new Error("Unexpected stats payload");
      }
      apply(data);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch {
        // storage full / blocked: numbers just won't be cached
      }
    } catch {
      // keep whatever is on screen (cached numbers or dashes)
    } finally {
      clearTimeout(abortTimer);
      loading = false;
    }
  }

  function refreshIfDue() {
    if (Date.now() - lastLoad >= MIN_GAP_MS) {
      load();
    }
  }

  bar.setAttribute("aria-busy", "true");
  load();

  setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      refreshIfDue();
    }
  }, REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshIfDue();
    }
  });
  window.addEventListener("online", refreshIfDue);

  // tracker.js announces when a batch containing a download reached the server
  window.addEventListener("beu:download-recorded", load);
})();
