"use strict";

// Vercel serves this file at /api/verify-payment.
const { verifyPayment } = require("../src/payments-instance");

module.exports = verifyPayment;
