/*
 * Razorpay donations (front end).
 *
 * Flow: Donate click -> POST /api/create-order (server fixes the amount) ->
 * open Razorpay Checkout -> POST /api/verify-payment (server checks the
 * signature) -> thank-you message. The handler callback alone is NEVER treated
 * as proof of payment. Only the public key id (sent by the server) is used
 * here; the key secret exists only on the server.
 *
 * If anything fails before the modal opens (API down, script blocked), the
 * original UPI flow in app.js is used so a donor is never left stuck.
 */
(function () {
  "use strict";

  var CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
  var MIN_INR = 1;
  var MAX_INR = 50000; // the server enforces its own limits as well
  var checkoutPromise = null;
  var busy = false;

  function apiBase() {
    var cfg = window.BEU_CONFIG || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function say(text, ms) {
    if (typeof showMessage === "function") {
      showMessage(text, ms || 6000);
    }
  }

  function track(name, params) {
    if (typeof trackGA4Event === "function") {
      trackGA4Event(name, params || {});
    }
  }

  // Loaded on first click only: no third-party script on normal page views.
  function loadCheckout() {
    if (window.Razorpay) {
      return Promise.resolve();
    }
    if (!checkoutPromise) {
      checkoutPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = CHECKOUT_SRC;
        s.async = true;
        s.onload = function () {
          return window.Razorpay ? resolve() : reject(new Error("checkout_missing"));
        };
        s.onerror = function () {
          s.remove();
          checkoutPromise = null; // allow a retry on the next click
          reject(new Error("checkout_blocked"));
        };
        document.head.appendChild(s);
      });
    }
    return checkoutPromise;
  }

  function postJson(path, body) {
    return fetch(apiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || "http_" + res.status);
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  }

  // ---- amount picker ------------------------------------------------------
  var chips = Array.prototype.slice.call(document.querySelectorAll(".donate-chip"));
  var custom = document.getElementById("donate-amount");
  var selected = 50;

  function selectChip(amount) {
    selected = amount;
    chips.forEach(function (c) {
      var on = Number(c.dataset.amount) === amount;
      c.classList.toggle("is-selected", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      if (custom) {
        custom.value = "";
      }
      selectChip(Number(chip.dataset.amount));
    });
  });
  if (custom) {
    custom.addEventListener("input", function () {
      selectChip(0); // a typed amount replaces the preset
    });
  }
  selectChip(selected);

  function chosenAmount() {
    var typed = custom && custom.value.trim() !== "" ? Number(custom.value) : selected;
    return typed;
  }

  // ---- payment ------------------------------------------------------------
  function finish(message) {
    busy = false;
    var btn = document.getElementById("donate-btn");
    if (btn) {
      btn.disabled = false;
    }
    if (message) {
      say(message, 8000);
    }
  }

  function verify(order, response) {
    say("Confirming your payment…", 15000);
    return postJson("/api/verify-payment", {
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    })
      .then(function () {
        track("donate_success", { amount_inr: order.amount / 100 });
        finish("💙 Payment received. Thank you for supporting BEU Syllabus!");
      })
      .catch(function (err) {
        // The money may well have moved (the server webhook settles it), so do
        // not tell the donor it failed.
        track("donate_verify_pending", { reason: err.message });
        finish(
          "Thanks! Your payment is being confirmed. If money was deducted, no action is needed.",
        );
      });
  }

  function openCheckout(order) {
    var rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "BEU Syllabus App",
      description: "Support BEU Syllabus App",
      theme: { color: "#1e3a8a" },
      modal: {
        ondismiss: function () {
          track("donate_dismissed", { amount_inr: order.amount / 100 });
          finish();
        },
      },
      handler: function (response) {
        verify(order, response);
      },
    });
    rzp.on("payment.failed", function (resp) {
      var reason = resp && resp.error && resp.error.description;
      track("donate_failed", { code: (resp && resp.error && resp.error.code) || "unknown" });
      // The modal stays open so the donor can retry; just surface the reason.
      say(reason ? "Payment failed: " + reason : "Payment failed. Please try again.", 7000);
    });
    rzp.open();
  }

  window.beuDonate = function beuDonate() {
    if (busy) {
      return;
    }
    var amount = chosenAmount();
    if (!Number.isInteger(amount) || amount < MIN_INR || amount > MAX_INR) {
      say("Please enter a whole amount between ₹" + MIN_INR + " and ₹" + MAX_INR + ".", 5000);
      return;
    }

    busy = true;
    var btn = document.getElementById("donate-btn");
    if (btn) {
      btn.disabled = true;
    }
    track("donate_order_requested", { amount_inr: amount });

    Promise.all([postJson("/api/create-order", { amount: amount }), loadCheckout()])
      .then(function (results) {
        openCheckout(results[0]);
      })
      .catch(function (err) {
        track("donate_unavailable", { reason: err.message });
        finish();
        if (err.status === 400 && err.data && err.data.error === "invalid_amount") {
          say("Please choose an amount between ₹" + err.data.min + " and ₹" + err.data.max + ".", 5000);
        } else if (typeof window.startUpiDonate === "function") {
          window.startUpiDonate(); // original UPI flow as a fallback
        } else {
          say("Online payment is unavailable right now. Please try again later.", 6000);
        }
      });
  };
})();
