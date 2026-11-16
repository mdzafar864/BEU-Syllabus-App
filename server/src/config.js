"use strict";

// All settings come from environment variables (see .env.example).
function loadConfig(env = process.env) {
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const activeWindowMinutes = num(env.ACTIVE_WINDOW_MINUTES, 5) || 5;

  return {
    mongoUri: env.MONGODB_URI || "",
    dbName: env.MONGODB_DB || "beu_syllabus",
    allowedOrigins: (env.ALLOWED_ORIGINS || "https://mdzafar864.github.io")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    // http://localhost:* is accepted outside production to ease local testing
    allowLocalhost: env.NODE_ENV !== "production",
    activeWindowMinutes,
    activeWindowMs: activeWindowMinutes * 60 * 1000,
    eventTtlDays: num(env.EVENT_TTL_DAYS, 180),
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 300) || 300,
    trustProxy: env.TRUST_PROXY !== "false",
    statsCacheMs: 15 * 1000,
    port: num(env.PORT, 3000) || 3000,
  };
}

module.exports = { loadConfig };
