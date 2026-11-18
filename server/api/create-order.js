"use strict";

// Vercel serves this file at /api/create-order.
const { createOrder } = require("../src/payments-instance");

module.exports = createOrder;
