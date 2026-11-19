"use strict";

// All settings come from environment variables (see .env.example).
function loadConfig(env = process.env) {
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const activeWindowMinutes = num(env.ACTIVE_WINDOW_MINUTES, 1) || 1;

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
    // create collections / indexes / default documents on start-up if missing
    autoSeed: env.AUTO_SEED !== "false",
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 300) || 300,
    trustProxy: env.TRUST_PROXY !== "false",
    statsCacheMs: 5 * 1000,
    port: num(env.PORT, 3000) || 3000,

    // --- Razorpay (donations). Secrets live ONLY in server env vars. ---
    razorpayKeyId: env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || "",
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "",
    // Donation limits in whole rupees (the server converts to paise itself).
    donationMinInr: num(env.DONATION_MIN_INR, 1) || 1,
    donationMaxInr: num(env.DONATION_MAX_INR, 50000) || 50000,
    // create-order / verify-payment calls allowed per IP per minute.
    donationRateLimitPerMin: num(env.DONATION_RATE_LIMIT_PER_MIN, 20) || 20,
  };
}

module.exports = { loadConfig };
