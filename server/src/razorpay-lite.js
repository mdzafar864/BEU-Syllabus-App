"use strict";

// Minimal Razorpay REST client: only the two calls this app needs.
//
// Why not the official "razorpay" npm package? It pulls in axios and a large
// dependency tree that is loaded and compiled on EVERY serverless cold start.
// Two plain HTTPS calls with Node's built-in fetch do the same job with nothing
// to load, which shortens the first request after the function has been idle.
//
// The interface mirrors the SDK (orders.create, payments.fetch) so it can be
// swapped in/out, and errors keep the SDK shape ({ statusCode, error }) that
// payments.js already logs.

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 8000; // fail fast instead of hanging until Vercel kills the function

function createRazorpayLite({
  keyId,
  keySecret,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
}) {
  const auth =
    "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(API + path, {
        method,
        headers: {
          Authorization: auth,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw {
        statusCode: 0,
        error: {
          description:
            err && err.name === "TimeoutError" ? "timeout" : "network_error",
        },
      };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw {
        statusCode: res.status,
        error: data.error || { description: "http_" + res.status },
      };
    }
    return data;
  }

  return {
    orders: {
      create: (params) => call("POST", "/orders", params),
    },
    payments: {
      fetch: (paymentId) =>
        call("GET", "/payments/" + encodeURIComponent(paymentId)),
    },
  };
}

module.exports = { createRazorpayLite };
