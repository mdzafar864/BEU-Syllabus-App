// app.js
/* global syllabus, branchNames, semesterNames, sessionsBySemester */

// =========================================================
// GOOGLE ANALYTICS 4 CUSTOM EVENT TRACKING
// =========================================================
function trackGA4Event(eventName, eventParameters = {}) {
  if (typeof window.gtag !== "function") {
    console.warn(`[GA4] gtag unavailable: ${eventName}`);
    return;
  }

  window.gtag("event", eventName, {
    ...eventParameters,
    app_name: "BEU Syllabus App",
    page_title: document.title,
    page_location: window.location.href,
  });
}

function getBranchName(branchCode) {
  return branchNames[branchCode] || branchCode || "Unknown";
}

function getSemesterName(semesterCode) {
  return semesterNames[semesterCode] || semesterCode || "Unknown";
}

// PWA INSTALL PROMPT + INSTALLED CHECK
let deferredPrompt = null;
let installInProgress = false;
const installBtn = document.getElementById("install-btn");

function isPWAStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith("android-app://")
  );
}

function updateInstallButton() {
  if (!installBtn) {
    return;
  }

  if (isPWAStandalone()) {
    installBtn.textContent = "✅ App Mode Active";
    installBtn.style.background = "#16a34a";
    installBtn.disabled = false;
    return;
  }

  if (localStorage.getItem("beu_pwa_installed") === "yes") {
    installBtn.textContent = "✅ App Already Installed";
    installBtn.style.background = "#16a34a";
    installBtn.disabled = false;
    return;
  }

  installBtn.textContent = "📲 Install App";
  installBtn.style.background = "#16a34a";
  installBtn.disabled = false;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installInProgress = false;
  localStorage.removeItem("beu_pwa_installed");
  updateInstallButton();

  trackGA4Event("pwa_install_available", {
    install_status: "prompt_available",
    platforms: Array.isArray(e.platforms) ? e.platforms.join(",") : "web",
  });
});

// ✅ Success popup ONLY after browser confirms app installation
let installSuccessPopupShown = false;
let installSuccessTimer = null;

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installInProgress = false;

  localStorage.setItem("beu_pwa_installed", "yes");
  updateInstallButton();

  if (sessionStorage.getItem("ga4_pwa_installed_sent") !== "yes") {
    sessionStorage.setItem("ga4_pwa_installed_sent", "yes");
    trackGA4Event("pwa_installed", {
      install_status: "success",
      install_method: "browser_appinstalled_event",
    });
  }

  clearTimeout(installSuccessTimer);
  installSuccessTimer = setTimeout(() => {
    if (installSuccessPopupShown) {
      return;
    }
    installSuccessPopupShown = true;

    showMessage(
      "✅ App installed successfully. You can now open it from your home screen.",
      8000,
    );
  }, 8000);
});

async function installPWA() {
  updateInstallButton();

  if (isPWAStandalone()) {
    showMessage("✅ You are already using the installed app.", 6000);
    installBtn.textContent = "✅ App Mode Active";
    installBtn.style.background = "#16a34a";
    return;
  }

  if (installInProgress) {
    showMessage("⏳ Installing the app. Please wait...", 5000);
    return;
  }

  if (localStorage.getItem("beu_pwa_installed") === "yes" && !deferredPrompt) {
    showMessage(
      "✅ The app is already installed. Open it from your home screen.",
      6000,
    );
    return;
  }

  if (!deferredPrompt) {
    showMessage(
      "ℹ️ Installation is not available right now. Use the browser menu (⋮) and choose Install App or Add to Home Screen.",
      9000,
    );
    return;
  }

  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  installInProgress = true;

  promptEvent.prompt();
  const choice = await promptEvent.userChoice;

  if (choice.outcome === "accepted") {
    installBtn.textContent = "⏳ Installing...";
    installBtn.style.background = "#16a34a";
    showMessage("⏳ Installing the app. Please wait...", 15000);
  } else {
    installInProgress = false;
    showMessage("❌ App installation was cancelled.", 5000);
    updateInstallButton();
  }
}

window.addEventListener("DOMContentLoaded", updateInstallButton);
window
  .matchMedia("(display-mode: standalone)")
  .addEventListener("change", updateInstallButton);

let hideTimer;
let resetTimer;

// FLOW: Branch -> Semester -> Session
const branch = document.getElementById("branch");
const sem = document.getElementById("sem");
const session = document.getElementById("session");
const msg = document.getElementById("msg");

function resetMsg() {
  clearTimeout(hideTimer);
  clearTimeout(resetTimer);
  msg.style.opacity = 1;
  msg.textContent =
    "Choose a branch, semester and session to view the syllabus.";
}

// SESSION options depend on which semester is selected
// (e.g. 2026-2030 only exists at 1st semester for now).
function populateSessionOptions(semValue) {
  session.replaceChildren();

  if (!semValue) {
    session.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Select Semester First";
    session.appendChild(opt);
    return;
  }

  session.disabled = false;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select Session";
  session.appendChild(placeholder);

  const options = sessionsBySemester[semValue] || [];
  options.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    session.appendChild(opt);
  });
}

// SEMESTER depends on branch: disabled until a branch is selected.
function updateSemesterState() {
  if (branch.value) {
    sem.disabled = false;
  } else {
    // Branch cleared: reset semester and lock everything downstream
    sem.value = "";
    sem.disabled = true;
    populateSessionOptions("");
  }
}

branch.onchange = () => {
  updateSemesterState();
  resetMsg();
};

sem.onchange = () => {
  populateSessionOptions(sem.value);
  resetMsg();
};

session.onchange = resetMsg;

// Initial state (also covers browser-restored form values):
// semester follows branch, session follows semester.
sem.disabled = !branch.value;
populateSessionOptions(sem.value);

// GOOGLE DRIVE HELPERS
// Preview URL (iframe):   https://drive.google.com/file/d/<ID>/preview
// Download URL (button):  https://drive.google.com/uc?export=download&id=<ID>
function getDriveFileId(url) {
  const m =
    String(url || "").match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    String(url || "").match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

function getDriveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

// OPEN PDF
const openBtn = document.getElementById("open-btn");
const pdfFrame = document.getElementById("pdf-frame");
const pdfModal = document.getElementById("pdf-modal");

openBtn.onclick = () => {
  const b = branch.value;
  const s = sem.value;
  const ses = session.value;

  if (!b || !s || !ses) {
    showMessage("❌ Please select a branch, semester and session.", 10000);
    return;
  }

  if (!syllabus[s] || !syllabus[s][ses] || !syllabus[s][ses][b]) {
    showMessage("❌ Syllabus is not available for this selection.", 9000);
    return;
  }

  trackGA4Event("open_syllabus_click", {
    button_text: "Open Syllabus",
    click_location: "main_page",
  });

  const pdflink = String(syllabus[s][ses][b]).trim();
  pdfFrame.src = pdflink;
  pdfModal.style.display = "flex";
  pdfModal.classList.add("active");

  showMessage("📄 Preview opened. Click Download to save the file.", 8000);
};

// SHOW MESSAGE
function showMessage(text, duration) {
  // Cancel BOTH pending timers. The old fade-out timer used to survive and
  // wipe a newer message (e.g. "Not available") right after it was shown.
  clearTimeout(hideTimer);
  clearTimeout(resetTimer);
  msg.style.opacity = 1;
  msg.textContent = text;

  hideTimer = setTimeout(() => {
    msg.style.opacity = 0;
    resetTimer = setTimeout(resetMsg, 400);
  }, duration);
}

// CLOSE MODALS
function closePDF() {
  const pdfModalEl = document.getElementById("pdf-modal");
  const pdfFrameEl = document.getElementById("pdf-frame");
  pdfModalEl.classList.remove("active");
  pdfModalEl.style.display = "none";
  pdfFrameEl.src = "";
}

// DEVELOPER OPTIONS / MODAL
function openDev() {
  const modal = document.getElementById("dev-modal");
  modal.style.display = "flex";
  modal.classList.add("active");
}

function closeDev() {
  const modal = document.getElementById("dev-modal");
  modal.classList.remove("active");
  modal.style.display = "none";
}

document.getElementById("close-pdf-btn").addEventListener("click", closePDF);
document.getElementById("dev-close-btn").addEventListener("click", closeDev);

document.getElementById("dev-btn").addEventListener("click", () => {
  trackGA4Event("developer_info_click", {
    button_text: "Developer Info",
    click_location: "main_page",
  });
  openDev();
});

document.getElementById("install-btn").addEventListener("click", () => {
  trackGA4Event("pwa_install_button_click", {
    button_text: installBtn.textContent.trim(),
    prompt_available: deferredPrompt ? "yes" : "no",
  });
  installPWA();
});

// DONATE (UPI)
// Opens the user's UPI app with the payee pre-filled (amount is left for the
// donor to choose). If no UPI app opens (desktop, or none installed) the UPI
// ID is copied instead so it can be pasted into any payment app.
const UPI_ID = "mdzafarsabour35@axl";
const UPI_NAME = "MZ Tech Solutions";
const UPI_NOTE = "Support BEU Syllabus App";

function buildUpiLink() {
  const params = [
    `pa=${encodeURIComponent(UPI_ID)}`,
    `pn=${encodeURIComponent(UPI_NAME)}`,
    `tn=${encodeURIComponent(UPI_NOTE)}`,
    "cu=INR",
  ];
  return `upi://pay?${params.join("&")}`;
}

async function copyUpiId() {
  try {
    await navigator.clipboard.writeText(UPI_ID);
    showMessage(`💙 UPI ID copied: ${UPI_ID}. Paste it in any UPI app. Thank you!`, 8000);
  } catch {
    showMessage(`💙 Support us via UPI ID: ${UPI_ID}`, 10000);
  }
}

// The original UPI flow, kept as the fallback when Razorpay is unavailable.
function startUpiDonate() {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) {
    copyUpiId();
    return;
  }

  // If a UPI app takes over, the page gets hidden: then skip the fallback.
  let opened = false;
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      opened = true;
    }
  };
  document.addEventListener("visibilitychange", onHide);
  window.location.href = buildUpiLink();

  setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    if (!opened) {
      copyUpiId();
    }
  }, 1800);
}
window.startUpiDonate = startUpiDonate;

const donateBtn = document.getElementById("donate-btn");
if (donateBtn) {
  donateBtn.addEventListener("click", () => {
    trackGA4Event("donate_click", {
      button_text: "Donate",
      click_location: "main_page",
    });

    // js/donate.js (Razorpay Checkout) when present, otherwise plain UPI.
    if (typeof window.beuDonate === "function") {
      window.beuDonate();
    } else {
      startUpiDonate();
    }
  });
}

// Close developer modal when clicking outside card
document.getElementById("dev-modal").addEventListener("click", function (e) {
  if (e.target === this) {
    closeDev();
  }
});

// Close PDF modal when clicking outside card
document.getElementById("pdf-modal").addEventListener("click", function (e) {
  if (e.target === this) {
    closePDF();
  }
});

// Close whichever modal is open when pressing Escape
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") {
    return;
  }
  if (document.getElementById("pdf-modal").classList.contains("active")) {
    closePDF();
  }
  if (document.getElementById("dev-modal").classList.contains("active")) {
    closeDev();
  }
});

// DOWNLOAD PDF + GA4 TRACKING
const downloadPDFBtn = document.getElementById("download-pdf-btn");

// Click a hidden <a download> so the file is saved straight to the device.
function triggerFileDownload(href, fileName, openInNewTab) {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.hidden = true;
  if (openInNewTab) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Fetch the PDF, wrap it in a Blob and save it through a temporary object URL.
async function downloadAsBlob(downloadUrl, fileName) {
  const response = await fetch(downloadUrl, {
    credentials: "omit",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  // Drive answers with an HTML page (not a PDF) when it blocks the download.
  if (blob.type.includes("text/html") || blob.size === 0) {
    throw new Error("Unexpected response");
  }

  const objectUrl = URL.createObjectURL(
    new Blob([blob], { type: "application/pdf" }),
  );
  triggerFileDownload(objectUrl, fileName, false);
  // Release the temporary URL once the browser has started the save.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

downloadPDFBtn.onclick = async () => {
  const pdfLink = pdfFrame.src;
  const branchCode = branch.value;
  const semesterCode = sem.value;
  const sessionCode = session.value;

  if (!pdfLink || !branchCode || !semesterCode || !sessionCode) {
    showMessage("❌ No syllabus is available to download.", 5000);
    return;
  }

  const fileId = getDriveFileId(pdfLink);
  if (!fileId) {
    showMessage("❌ Could not find the file to download.", 5000);
    return;
  }
  const downloadUrl = getDriveDownloadUrl(fileId);
  const fileName = `${branchCode}_${semesterCode}_${sessionCode}_syllabus.pdf`;

  trackGA4Event("syllabus_download", {
    branch: getBranchName(branchCode),
    semester: getSemesterName(semesterCode),
    session: sessionCode,
    file_name: fileName,
    file_url: downloadUrl,
    download_source: "syllabus_preview_modal",
  });

  downloadPDFBtn.disabled = true;
  showMessage("⏳ Preparing download...", 30000);

  try {
    await downloadAsBlob(downloadUrl, fileName);
    showMessage("✅ Download started.", 5000);
  } catch (err) {
    // The blob route can fail (CORS, network, Drive warning page). Fall back
    // to the direct Drive download link so the user still gets the file.
    console.warn("[Download] Blob download failed, using direct link.", err);
    triggerFileDownload(downloadUrl, fileName, true);
    showMessage("✅ Download started.", 5000);
  } finally {
    downloadPDFBtn.disabled = false;
  }
};

// SHARE PDF (native share sheet on mobile, copy-link fallback elsewhere)
const sharePDFBtn = document.getElementById("share-pdf-btn");
sharePDFBtn.onclick = async () => {
  const pdfLink = pdfFrame.src;
  if (!pdfLink || !branch.value || !sem.value || !session.value) {
    showMessage("❌ No syllabus is available to share.", 5000);
    return;
  }

  const title = `${getBranchName(branch.value)} - ${getSemesterName(sem.value)} (${session.value}) BEU Syllabus`;

  trackGA4Event("syllabus_share", {
    branch: getBranchName(branch.value),
    semester: getSemesterName(sem.value),
    session: session.value,
    file_url: pdfLink,
  });

  try {
    if (navigator.share) {
      await navigator.share({ title, text: title, url: pdfLink });
      return;
    }
    await navigator.clipboard.writeText(pdfLink);
    showMessage("🔗 Link copied to clipboard.", 5000);
  } catch (err) {
    if (err && err.name === "AbortError") {
      return;
    } // user closed the share sheet
    showMessage("❌ Could not share. Please try Download instead.", 5000);
  }
};

// PWA SERVICE WORKER
const BASE = location.hostname.includes("github.io") ? "/BEU-Syllabus-App" : "";

if ("serviceWorker" in navigator) {
  // Was the page already controlled by a SW when it loaded?
  // (Prevents a reload / dialog on the very first visit.)
  const hadController = !!navigator.serviceWorker.controller;
  let swRegistration = null;

  // ------------------------------------------------------------------
  // UPDATE FLOW (one check per page load, at most ONE dialog per page load)
  //
  //   Signals (SW "VERSION_UPDATED" / data fingerprint changed)
  //        |  only set flags in updateState
  //        v
  //   scheduleAnnounce()  -> debounced, so signals that arrive close
  //        |                 together are merged into a single dialog
  //        v
  //   announceUpdates()   -> opens the dialog ONCE; later signals only
  //                          refresh its text, never open a second one
  //
  // "Later" closes the dialog and it stays closed until the next page load.
  // "Update" closes the dialog, then reloads exactly once.
  // ------------------------------------------------------------------
  const updateState = {
    version: false, //   a newer app version exists
    dataHash: null, //   fingerprint of newer / unseen syllabus data
    dialog: null, //     handle of the dialog currently on screen
    shown: false, //     a dialog was already shown during this page load
    reloading: false, // an update reload is in progress
    reloadPending: false, // a new worker took over; reload is waiting for checkout to finish
  };
  let announceTimer = null;

  const SYNC_TAG = "sync-syllabus";
  const ANNOUNCE_SETTLE_MS = 400;

  const ICON_REFRESH =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>';
  const ICON_BOOK =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';

  // ---------- Styled update dialog ----------
  // Builds ONE dialog and returns a handle. onClose(result) is called exactly
  // once: true = "Update", false = "Later" / Escape / backdrop click.
  function openUpdateDialog(content, onClose) {
    // Safety net: never leave an orphaned overlay behind.
    document.querySelectorAll(".upd-overlay").forEach((n) => n.remove());

    const previouslyFocused = document.activeElement;
    let closed = false;

    const overlay = document.createElement("div");
    overlay.className = "upd-overlay";

    const card = document.createElement("div");
    card.className = "upd-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "updMsg");

    const iconWrap = document.createElement("div");
    iconWrap.className = "upd-icon";
    iconWrap.setAttribute("aria-hidden", "true");

    const titleEl = document.createElement("div");
    titleEl.className = "upd-title";
    const msgEl = document.createElement("p");
    msgEl.className = "upd-msg";
    msgEl.id = "updMsg";
    const subEl = document.createElement("p");
    subEl.className = "upd-sub";

    const actions = document.createElement("div");
    actions.className = "upd-actions";
    const laterBtn = document.createElement("button");
    laterBtn.type = "button";
    laterBtn.className = "upd-btn-secondary";
    laterBtn.textContent = "Later";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "upd-btn-primary";
    actions.append(laterBtn, okBtn);

    card.append(iconWrap, titleEl, msgEl, subEl, actions);
    overlay.appendChild(card);

    // Fill / refresh the text. textContent keeps it safe (no HTML injection);
    // the icon is a trusted constant SVG string parsed as XML.
    function setContent({ icon, title, message, sub, confirmText }) {
      const svgDoc = new DOMParser().parseFromString(icon, "image/svg+xml");
      iconWrap.replaceChildren(document.importNode(svgDoc.documentElement, true));
      titleEl.textContent = title;
      msgEl.textContent = message;
      subEl.textContent = sub || "";
      subEl.hidden = !sub;
      okBtn.textContent = confirmText;
    }

    function close(result) {
      if (closed) {
        return;
      }
      closed = true;
      okBtn.disabled = true;
      laterBtn.disabled = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();

      // Give focus back to where the user was, without scrolling the page.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus({ preventScroll: true });
        } catch {
          // element can't take focus: ignore
        }
      }
      onClose(result);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(false);
      } else if (e.key === "Tab") {
        // Keep keyboard focus inside the dialog while it is open.
        e.preventDefault();
        (document.activeElement === okBtn ? laterBtn : okBtn).focus();
      }
    }

    okBtn.addEventListener("click", () => close(true));
    laterBtn.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close(false);
      }
    });
    document.addEventListener("keydown", onKey, true);

    setContent(content);
    document.body.appendChild(overlay);
    okBtn.focus({ preventScroll: true });

    return { setContent };
  }

  // What the dialog says right now. A new app version wins: its reload also
  // loads the fresh data.js, so one dialog covers both.
  function currentContent() {
    if (updateState.version) {
      return {
        icon: ICON_REFRESH,
        title: "Update Available",
        message: "New version available! Update now.",
        sub: "A newer version of the app is ready with the latest improvements.",
        confirmText: "Update Now",
      };
    }
    return {
      icon: ICON_BOOK,
      title: "Syllabus Updated",
      message: "New syllabus added, Please update.",
      sub: "Fresh syllabus content has been downloaded. Refresh to see it.",
      confirmText: "Refresh Now",
    };
  }

  // True while a Razorpay payment is in flight (donate.js exposes this).
  // An update must never reload the page in the middle of a payment.
  function checkoutBusy() {
    return typeof window.beuDonateBusy === "function" && window.beuDonateBusy();
  }

  // Debounce: signals arriving within a moment of each other (for example the
  // version message and the data comparison) end up in ONE dialog.
  function scheduleAnnounce() {
    if (updateState.reloading) {
      return;
    }
    clearTimeout(announceTimer);
    announceTimer = setTimeout(announceUpdates, ANNOUNCE_SETTLE_MS);
  }

  function announceUpdates() {
    announceTimer = null;
    if (updateState.reloading) {
      return;
    }
    if (!updateState.version && !updateState.dataHash) {
      return; // nothing to announce
    }

    // A reload is already queued, or a payment is running: no dialog now.
    if (updateState.reloadPending) {
      return;
    }
    if (checkoutBusy()) {
      scheduleAnnounce(); // look again once checkout has finished
      return;
    }

    // A dialog is already open: just refresh its text. Never open a second.
    if (updateState.dialog) {
      updateState.dialog.setContent(currentContent());
      return;
    }

    // Already shown (and dismissed) during this page load: stay quiet.
    if (updateState.shown) {
      return;
    }

    updateState.shown = true;
    updateState.dialog = openUpdateDialog(currentContent(), (ok) => {
      updateState.dialog = null;
      if (ok) {
        if (updateState.dataHash) {
          writeSeenHash(updateState.dataHash);
        }
        // Let the dialog finish leaving the DOM, then reload exactly once.
        requestAnimationFrame(applyUpdate);
      }
      // "Later": nothing else happens until the next page load.
    });
  }

  // Reload so the freshly cached data.js and shell are used. Runs once.
  function applyUpdate() {
    if (updateState.reloading) {
      return;
    }
    updateState.reloading = true;
    clearTimeout(announceTimer);

    const waiting = swRegistration && swRegistration.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
    }
    window.location.reload();
  }

  // ----- Syllabus data fingerprint -----
  // Lives on the page, not in the service worker: on a phone the app is
  // normally cold-started and data.js is served network-first, so only the
  // page can know what the user saw LAST time. It remembers a fingerprint of
  // data.js in localStorage; a difference at start-up means new syllabus.
  const SEEN_DATA_KEY = "beu_syllabus_seen_data_hash";
  const DATA_PAGE_URL = new URL(`${BASE}/js/data.js`, location.origin).href;
  let loadedDataHash = null; // fingerprint of the data this page is running
  let dataWatcherStarted = false;

  function hashText(text) {
    // FNV-1a 32 bit + length: tiny, fast, no secure-context requirement
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + "-" + text.length.toString(36);
  }

  function readSeenHash() {
    try {
      return localStorage.getItem(SEEN_DATA_KEY);
    } catch {
      return null;
    }
  }

  function writeSeenHash(hash) {
    try {
      localStorage.setItem(SEEN_DATA_KEY, hash);
    } catch {
      // storage blocked (private mode): the dialog then just won't repeat
    }
  }

  async function fetchDataHash() {
    const res = await fetch(`${DATA_PAGE_URL}?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error("data fetch failed: " + res.status);
    }
    return hashText(await res.text());
  }

  // Runs ONCE per page load.
  async function initDataWatcher() {
    if (dataWatcherStarted) {
      return;
    }
    dataWatcherStarted = true;

    try {
      const hash = await fetchDataHash();
      loadedDataHash = hash;

      const seen = readSeenHash();
      writeSeenHash(hash);

      // First ever visit (seen === null) is NOT an update: just remember it.
      if (seen && seen !== hash) {
        updateState.dataHash = hash;
        scheduleAnnounce();
      }
    } catch {
      // offline / server error: nothing to announce this time
    }
  }

  // Only used when the service worker reports fresh data while the page is
  // open. Compares against what THIS page loaded.
  async function confirmDataChange() {
    if (!loadedDataHash) {
      return;
    }
    try {
      const hash = await fetchDataHash();
      if (hash !== loadedDataHash) {
        updateState.dataHash = hash;
        scheduleAnnounce();
      }
    } catch {
      // offline: nothing to announce
    }
  }

  // ----- Signals from the service worker: each only sets ITS OWN flag -----
  function onVersionSignal() {
    // Ignore on first install (nothing to "update" from). Only hadController
    // is trusted: navigator.serviceWorker.controller becomes truthy on the
    // first visit too (clients.claim()).
    if (!hadController || updateState.version) {
      return;
    }
    updateState.version = true;
    scheduleAnnounce();
  }

  function onDataSignal() {
    // The worker noticed a change: let the page confirm against what it shows.
    confirmDataChange();
  }

  navigator.serviceWorker.addEventListener("message", (event) => {
    const type = event.data && event.data.type;

    if (type === "NEW_VERSION" || type === "VERSION_UPDATED") {
      onVersionSignal();
    } else if (type === "SYLLABUS_UPDATED") {
      onDataSignal();
    }
  });

  // ----- Service worker helpers -----
  function activeWorker() {
    return (
      navigator.serviceWorker.controller ||
      (swRegistration && swRegistration.active)
    );
  }

  // Ask for a Background Sync (fires when connection is back, even if offline
  // now). Browsers without Background Sync fall back to a direct message.
  function requestSyllabusSync() {
    if (!swRegistration) {
      return;
    }

    if ("sync" in swRegistration) {
      swRegistration.sync.register(SYNC_TAG).catch(postManualSync);
    } else {
      postManualSync();
    }
  }

  function postManualSync() {
    const sw = activeWorker();
    if (sw) {
      sw.postMessage({ type: "SYNC_SYLLABUS" });
    }
  }

  // Ask the service worker to compare version.json with the installed
  // release. Runs ONCE per page load.
  let versionCheckRequested = false;

  function requestVersionCheck() {
    if (versionCheckRequested) {
      return;
    }
    const sw = activeWorker();
    if (!sw) {
      return;
    }
    versionCheckRequested = true;
    sw.postMessage({ type: "CHECK_VERSION" });
  }

  // ----- Start: the one and only update check of this page load -----
  window.addEventListener(
    "load",
    () => {
      initDataWatcher();

      navigator.serviceWorker
        .register(`${BASE}/service-worker.js`)
        .then((registration) => {
          console.log("✅ SW Registered");
          swRegistration = registration;

          // Queue a sync now; it runs as soon as the network is available.
          return navigator.serviceWorker.ready;
        })
        .then(() => {
          requestSyllabusSync();
          requestVersionCheck();
        })
        .catch((err) => console.log("❌ SW Error:", err));
    },
    { once: true },
  );

  // ----- Auto-reload when a new worker takes control -----
  // The worker calls skipWaiting() on install and clients.claim() on
  // activate, so every deploy fires "controllerchange" in open pages.
  //   * hadController guards the very first visit (claim() fires the event
  //     too, and there is nothing to reload from).
  //   * updateState.reloading / reloadPending make sure it reloads only once
  //     and that the "Update Now" dialog never competes with it.
  //   * A running Razorpay payment postpones the reload until it is finished.
  function reloadWhenSafe() {
    if (updateState.reloading) {
      return;
    }
    if (checkoutBusy()) {
      setTimeout(reloadWhenSafe, 500);
      return;
    }
    updateState.reloading = true;
    clearTimeout(announceTimer);
    window.location.reload();
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || updateState.reloading || updateState.reloadPending) {
      return;
    }
    updateState.reloadPending = true;
    reloadWhenSafe();
  });
}
