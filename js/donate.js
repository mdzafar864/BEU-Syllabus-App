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
 *
 * Speed: nothing slow is left for the click itself. During app initialization
 * (right after the page is parsed, in idle time) the page (1) wakes the
 * serverless API + database and (2) downloads AND initializes Razorpay
 * Checkout, so window.Razorpay is ready before the first tap. The same warm-up
 * is repeated when the donor shows interest, and again when the tab returns
 * from the background. Requests are "simple" CORS requests (text/plain body)
 * so the browser skips the extra preflight round trip.
 *
 * What is NOT pre-loaded: the order id. An order is tied to one amount and is
 * stored server-side, so creating one for every page view would fill the
 * database with orders nobody pays. The order is created on click, in parallel
 * with the (already finished) Checkout download.
 *
 * Loading state: the button is disabled the instant it is clicked and stays
 * disabled until the flow ends (modal closed, payment confirmed, or any error).
 */
(function () {
  "use strict";

  var CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
  var MIN_INR = 1;
  var MAX_INR = 50000; // the server enforces its own limits as well
  var REQUEST_TIMEOUT_MS = 12000; // generous: covers a cold start, then the UPI fallback
  var WARM_EVERY_MS = 4 * 60 * 1000; // serverless instances sleep after a few idle minutes
  var LOADING_GUARD_MS = 30000; // never leave the button stuck if checkout never opens
  var checkoutPromise = null;
  var busy = false;
  var lastWarm = 0;
  var loadingGuard = null;

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

  // Wakes the API function + MongoDB connection. Fire-and-forget: "no-cors"
  // means no preflight and no CORS headers are needed, the response is ignored.
  function warmApi() {
    var now = Date.now();
    if (!apiBase() || now - lastWarm < WARM_EVERY_MS) {
      return;
    }
    lastWarm = now;
    try {
      fetch(apiBase() + "/api/create-order?warm=1", {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
      }).catch(function () {});
    } catch (e) {
      /* never let a warm-up break the page */
    }
  }

  // Download checkout.js into the browser cache WITHOUT running it. Running a
  // third-party script that touches the page (it builds its own container and
  // may adjust viewport / body styles) is kept for the click itself, so it can
  // never affect layout while the donor is just browsing.
  var preloaded = false;
  function preloadCheckout() {
    if (preloaded || window.Razorpay) {
      return;
    }
    preloaded = true;
    var l = document.createElement("link");
    l.rel = "preload";
    l.as = "script";
    l.href = CHECKOUT_SRC;
    document.head.appendChild(l);
  }

  // Warms the API and fetches Checkout. Safe to call repeatedly: warmApi is
  // throttled, preloadCheckout runs once.
  function prepare() {
    warmApi();
    preloadCheckout();
  }

  // App initialization: do the slow, network-bound work in idle time so it never
  // competes with rendering the syllabus list, then initialize Checkout so the
  // click path has nothing left to download. Failures are swallowed on purpose:
  // loadCheckout() resets itself, so the click will simply retry.
  function initPreload() {
    prepare();
    loadCheckout().catch(function () {});
  }

  function scheduleInitPreload() {
    var run = function () {
      (window.requestIdleCallback || function (fn) { return setTimeout(fn, 300); })(initPreload);
    };
    if (document.readyState === "complete") {
      run();
    } else {
      window.addEventListener("load", run, { once: true });
    }
  }

  // Instances sleep and tabs get frozen: re-warm when the donor comes back.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      warmApi();
    }
  });

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

  function postOnce(path, body) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;
    return fetch(apiBase() + path, {
      method: "POST",
      // text/plain keeps this a "simple" request: no OPTIONS preflight (one
      // round trip, and one possible extra cold start, saved). The server
      // parses the body as JSON regardless of the content type.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
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
      })
      .then(
        function (data) {
          clearTimeout(timer);
          return data;
        },
        function (err) {
          clearTimeout(timer);
          throw err;
        },
      );
  }

  // One automatic retry for network errors / 502-504 (e.g. an instance that
  // was still starting). Never retries 4xx: those are real answers.
  function postJson(path, body) {
    return postOnce(path, body).catch(function (err) {
      var transient = !err.status || (err.status >= 502 && err.status <= 504);
      if (!transient) {
        throw err;
      }
      return new Promise(function (r) { setTimeout(r, 400); }).then(function () {
        return postOnce(path, body);
      });
    });
  }

  // ---- amount picker ------------------------------------------------------
  var chips = Array.prototype.slice.call(document.querySelectorAll(".donate-chip"));
  var custom = document.getElementById("donate-amount");
  var selected = 10;

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

  // ---- intent: get ready before the click -----------------------------------
  var card = document.getElementById("donate-card");
  if (card) {
    ["pointerdown", "touchstart", "focusin"].forEach(function (evt) {
      card.addEventListener(evt, prepare, { passive: true });
    });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) {
            io.disconnect();
            // idle time only: never compete with rendering the syllabus list
            (window.requestIdleCallback || function (fn) { return setTimeout(fn, 300); })(prepare);
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(card);
    }
  }

  function chosenAmount() {
    var typed = custom && custom.value.trim() !== "" ? Number(custom.value) : selected;
    return typed;
  }

  // ---- payment ------------------------------------------------------------
  // Local loading state for the Donate button. It is applied synchronously on
  // click (before any network work) and removed in finish(), so a second tap
  // can never start a second order.
  // Only attributes/classes change here, never the label text or size: a wider
  // label would reflow the flex-wrap donate card (and the fit-to-screen layout
  // around it) for as long as the request is running.
  function setBusyUi(on) {
    var btn = document.getElementById("donate-btn");
    if (!btn) {
      return;
    }
    btn.disabled = on;
    btn.classList.toggle("is-loading", on);
    btn.setAttribute("aria-busy", on ? "true" : "false");

    clearTimeout(loadingGuard);
    loadingGuard = on
      ? setTimeout(function () {
          // Safety net: checkout neither opened nor failed. Re-enable the button.
          busy = false;
          setBusyUi(false);
        }, LOADING_GUARD_MS)
      : null;
  }

  function finish(message) {
    busy = false;
    setBusyUi(false);
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

  function safeOpenCheckout(order) {
    try {
      openCheckout(order);
    } catch (e) {
      track("donate_unavailable", { reason: "open_failed" });
      finish();
      if (typeof window.startUpiDonate === "function") {
        window.startUpiDonate();
      }
    }
  }

  window.beuDonate = function beuDonate() {
    if (busy) {
      return;
    }
    // Lock first: from this line on, further clicks are ignored.
    busy = true;
    var amount = chosenAmount();
    if (!Number.isInteger(amount) || amount < MIN_INR || amount > MAX_INR) {
      busy = false; // nothing was started, so there is nothing to wait for
      say("Please enter a whole amount between ₹" + MIN_INR + " and ₹" + MAX_INR + ".", 5000);
      return;
    }

    setBusyUi(true);
    track("donate_order_requested", { amount_inr: amount });

    Promise.all([postJson("/api/create-order", { amount: amount }), loadCheckout()])
      .then(function (results) {
        safeOpenCheckout(results[0]);
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

  // Back/forward cache: a restored page must not come back with a stuck button.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      finish();
    }
  });

  scheduleInitPreload();
})();
