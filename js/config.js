// config.js
// Settings for the stats bar + usage tracking (js/stats.js, js/tracker.js).
// Kept external so the CSP needs no 'unsafe-inline'.
//
// apiBase: the URL where the server/ folder is deployed, e.g.
//          "https://beu-syllabus-api.vercel.app" (no trailing slash).
//          Leave it empty to switch tracking OFF; the stats bar then shows "—".
//          The same origin must also be listed in connect-src in index.html.

window.BEU_CONFIG = {
  apiBase: "beu-syllabus-app-beu-syllabus.vercel.app",

  // How often (ms) the page tells the server "I'm still here" (Active users).
  heartbeatMs: 60000,

  // How often (ms) the stats bar refreshes while the app is open.
  statsRefreshMs: 60000,

  // Also send each click / dropdown change to Google Analytics 4 as
  // ui_click / ui_select_change (the existing GA4 events are always kept).
  mirrorUiEventsToGA: true,
};
