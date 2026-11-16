window.BEU_CONFIG = {
  apiBase: "https://beu-syllabus-app.vercel.app",

  // How often (ms) the page tells the server "I'm still here" (Active users).
  // Keep ACTIVE_WINDOW_MINUTES on the server at >= 3x this value.
  heartbeatMs: 20000,

  // How often (ms) the stats bar refreshes while the app is open.
  statsRefreshMs: 10000,

  // Also send each click / dropdown change to Google Analytics 4 as
  // ui_click / ui_select_change (the existing GA4 events are always kept).
  mirrorUiEventsToGA: true,
};
