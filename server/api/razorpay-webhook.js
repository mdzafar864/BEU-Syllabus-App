"use strict";

// Vercel serves this file at /api/razorpay-webhook.
// The webhook signature is computed over the RAW request body, so body parsing
// is switched off for this function and the handler reads the stream itself.
const { webhook } = require("../src/payments-instance");

module.exports = (req, res) => webhook(req, res);
module.exports.config = { api: { bodyParser: false } };
