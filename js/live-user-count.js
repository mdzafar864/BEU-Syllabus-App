// live-user-count.js
// Polls GET {apiBase}/api/stats every 5 seconds and updates the
// "Total Users" number in the stats bar:
//   <span class="stat-value" data-stat="totalUsers">—</span>
//
// Load it AFTER js/config.js in index.html:
//   <script src="js/live-user-count.js"></script>

(() => {
  "use strict";

  const POLL_MS = 5000;
  const el = document.querySelector('[data-stat="totalUsers"]');
  if (!el) return;

  let api = String((window.BEU_CONFIG || {}).apiBase || "")
    .trim()
    .replace(/\/+$/, "");
  if (api && !/^https?:\/\//i.test(api)) api = `https://${api}`;
  if (!api) return;

  let inFlight = false; // never stack requests if the network is slow

  async function updateUserCount() {
    if (inFlight) return;
    inFlight = true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(`${api}/api/stats`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { totalUsers } = await res.json();
      if (Number.isFinite(totalUsers) && totalUsers >= 0) {
        el.textContent = totalUsers.toLocaleString("en-IN");
      }
    } catch (err) {
      // Keep the last good number on screen; try again on the next tick.
      console.warn("User count update failed:", err.message);
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  }

  updateUserCount(); // first update immediately, don't wait 5s

  setInterval(() => {
    // Skip polling when the tab is hidden or the device is offline.
    if (document.visibilityState === "visible" && navigator.onLine) {
      updateUserCount();
    }
  }, POLL_MS);

  // Catch up right away when the user returns to the tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updateUserCount();
  });
})();
