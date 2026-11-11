// app.js

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
        page_location: window.location.href
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
const installBtn = document.getElementById("installBtn");

function isPWAStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        window.navigator.standalone === true ||
        document.referrer.startsWith("android-app://");
}

function updateInstallButton() {
    if (!installBtn) return;

    if (isPWAStandalone()) {
        installBtn.innerHTML = "✅ App Mode Active";
        installBtn.style.background = "#16a34a";
        installBtn.disabled = false;
        return;
    }

    if (localStorage.getItem("beu_pwa_installed") === "yes") {
        installBtn.innerHTML = "✅ App Already Installed";
        installBtn.style.background = "#16a34a";
        installBtn.disabled = false;
        return;
    }

    installBtn.innerHTML = "📲 Install App";
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
        platforms: Array.isArray(e.platforms) ? e.platforms.join(",") : "web"
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
            install_method: "browser_appinstalled_event"
        });
    }

    clearTimeout(installSuccessTimer);
    installSuccessTimer = setTimeout(() => {
        if (installSuccessPopupShown) return;
        installSuccessPopupShown = true;

        showMessage("✅ App installed successfully. You can now open it from your home screen.", 8000);
    }, 8000);
});

async function installPWA() {
    updateInstallButton();

    if (isPWAStandalone()) {
        showMessage("✅ You are already using the installed app.", 6000);
        installBtn.innerHTML = "✅ App Mode Active";
        installBtn.style.background = "#16a34a";
        return;
    }

    if (installInProgress) {
        showMessage("⏳ Installing the app. Please wait...", 5000);
        return;
    }

    if (localStorage.getItem("beu_pwa_installed") === "yes" && !deferredPrompt) {
        showMessage("✅ The app is already installed. Open it from your home screen.", 6000);
        return;
    }

    if (!deferredPrompt) {
        showMessage("ℹ️ Installation is not available right now. Use the browser menu (⋮) and choose Install App or Add to Home Screen.", 9000);
        return;
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    installInProgress = true;

    promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    if (choice.outcome === "accepted") {
        installBtn.innerHTML = "⏳ Installing...";
        installBtn.style.background = "#16a34a";
        showMessage("⏳ Installing the app. Please wait...", 15000);
    } else {
        installInProgress = false;
        showMessage("❌ App installation was cancelled.", 5000);
        updateInstallButton();
    }
}

window.addEventListener("DOMContentLoaded", updateInstallButton);
window.matchMedia("(display-mode: standalone)").addEventListener("change", updateInstallButton);

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
    msg.innerHTML = "Choose a branch, semester and session to view the syllabus.";
}

// ---------------------------------------------------------
// SYLLABUS LOOKUP  (data.js: syllabus[semester][session][branch] = Drive link)
// ---------------------------------------------------------
// Pulls the Drive file id out of ANY common Drive link format:
//   /file/d/<id>/preview | /view?usp=sharing | open?id=<id> | uc?id=<id>&export=download
function getDriveFileId(link) {
    const text = String(link || "").trim();
    if (!text) return null;
    const m = text.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/) ||
              text.match(/[?&]id=([\w-]{10,})/);
    return m ? m[1] : null;
}

// Returns { preview, download, view } for a selection, or null when no usable link exists.
function getSyllabusLinks(b, s, ses) {
    const raw = syllabus && syllabus[s] && syllabus[s][ses] && syllabus[s][ses][b];
    const text = String(raw || "").trim();
    if (!text) return null;

    const id = getDriveFileId(text);
    if (!id) {
        // Not a Drive link (e.g. a direct PDF URL): use it as-is.
        return /^https?:\/\//i.test(text) ? { preview: text, download: text, view: text } : null;
    }
    return {
        // /preview is the only Drive URL that allows being embedded in an iframe
        preview: `https://drive.google.com/file/d/${id}/preview`,
        download: `https://drive.google.com/uc?export=download&id=${id}`,
        view: `https://drive.google.com/file/d/${id}/view`
    };
}

// Only list sessions that actually have a link for the chosen branch + semester,
// so the user can't pick a combination that leads to "not available".
function populateSessionOptions(semValue, branchValue, keepValue) {
    session.innerHTML = "";

    if (!semValue) {
        session.disabled = true;
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Select Semester First";
        session.appendChild(opt);
        return;
    }

    const all = sessionsBySemester[semValue] || [];
    const options = branchValue
        ? all.filter(sess => getSyllabusLinks(branchValue, semValue, sess))
        : all;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    session.appendChild(placeholder);

    if (!options.length) {
        session.disabled = true;
        placeholder.textContent = "No syllabus added yet";
        return;
    }

    session.disabled = false;
    placeholder.textContent = "Select Session";
    options.forEach((sess) => {
        const opt = document.createElement("option");
        opt.value = sess;
        opt.textContent = sess;
        session.appendChild(opt);
    });

    // Keep the user's previous session if it is still valid; auto-pick a single option.
    if (keepValue && options.includes(keepValue)) session.value = keepValue;
    else if (options.length === 1) session.value = options[0];
}

// SEMESTER depends on branch: disabled until a branch is selected.
function updateSemesterState() {
    if (branch.value) {
        sem.disabled = false;
        // Branch changed: refresh the session list for the new branch
        populateSessionOptions(sem.value, branch.value, session.value);
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
    populateSessionOptions(sem.value, branch.value);
    resetMsg();
};

session.onchange = resetMsg;

// Initial state (also covers browser-restored form values):
// semester follows branch, session follows semester.
sem.disabled = !branch.value;
populateSessionOptions(sem.value, branch.value);

// OPEN PDF
const openBtn = document.getElementById("openBtn");
const pdfFrame = document.getElementById("pdfFrame");
const pdfModal = document.getElementById("pdfModal");

// Links of the syllabus currently open in the modal
let currentLinks = null;

openBtn.onclick = () => {
    const b = branch.value;
    const s = sem.value;
    const ses = session.value;

    if (!b || !s || !ses) {
        showMessage("❌ Please select a branch, semester and session.", 10000);
        return;
    }

    const links = getSyllabusLinks(b, s, ses);
    if (!links) {
        showMessage(`⏳ ${getBranchName(b)} - ${getSemesterName(s)} (${ses}) syllabus has not been added yet.`, 9000);
        return;
    }

    trackGA4Event("open_syllabus_click", {
        button_text: "Open Syllabus",
        click_location: "main_page"
    });

    currentLinks = links;
    pdfFrame.src = links.preview;
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
    msg.innerHTML = text;

    hideTimer = setTimeout(() => {
        msg.style.opacity = 0;
        resetTimer = setTimeout(resetMsg, 400);
    }, duration);
}

// CLOSE MODALS
function closePDF() {
    const pdfModalEl = document.getElementById("pdfModal");
    const pdfFrameEl = document.getElementById("pdfFrame");
    pdfModalEl.classList.remove("active");
    pdfModalEl.style.display = "none";
    pdfFrameEl.src = "";
    currentLinks = null;
}

// DEVELOPER OPTIONS / MODAL
function openDev() {
    const modal = document.getElementById("devModal");
    modal.style.display = "flex";
    modal.classList.add("active");
}

function closeDev() {
    const modal = document.getElementById("devModal");
    modal.classList.remove("active");
    modal.style.display = "none";
}

document.getElementById("devBtn").addEventListener("click", () => {
    trackGA4Event("developer_info_click", {
        button_text: "Developer Info",
        click_location: "main_page"
    });
    openDev();
});

document.getElementById("installBtn").addEventListener("click", () => {
    trackGA4Event("pwa_install_button_click", {
        button_text: installBtn.textContent.trim(),
        prompt_available: deferredPrompt ? "yes" : "no"
    });
    installPWA();
});

// Close developer modal when clicking outside card
document.getElementById("devModal").addEventListener("click", function(e) {
    if (e.target === this) closeDev();
});

// Close PDF modal when clicking outside card
document.getElementById("pdfModal").addEventListener("click", function(e) {
    if (e.target === this) closePDF();
});

// Close whichever modal is open when pressing Escape
document.addEventListener("keydown", function(e) {
    if (e.key !== "Escape") return;
    if (document.getElementById("pdfModal").classList.contains("active")) closePDF();
    if (document.getElementById("devModal").classList.contains("active")) closeDev();
});

// DOWNLOAD PDF + GA4 TRACKING
const downloadPDFBtn = document.getElementById("downloadPDFBtn");
downloadPDFBtn.onclick = () => {
    const pdfLink = currentLinks && currentLinks.download;
    const branchCode = branch.value;
    const semesterCode = sem.value;
    const sessionCode = session.value;

    if (!pdfLink || !branchCode || !semesterCode || !sessionCode) {
        showMessage("❌ No syllabus is available to download.", 5000);
        return;
    }

    const fileName = `${branchCode}_${semesterCode}_${sessionCode}_syllabus.pdf`;

    trackGA4Event("syllabus_download", {
        branch: getBranchName(branchCode),
        semester: getSemesterName(semesterCode),
        session: sessionCode,
        file_name: fileName,
        file_url: pdfLink,
        download_source: "syllabus_preview_modal"
    });

    const a = document.createElement("a");
    a.href = pdfLink;
    a.download = fileName;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();

    showMessage("✅ Download started.", 5000);
};

// SHARE PDF (native share sheet on mobile, copy-link fallback elsewhere)
const sharePDFBtn = document.getElementById("sharePDFBtn");
sharePDFBtn.onclick = async () => {
    const pdfLink = currentLinks && currentLinks.view;
    if (!pdfLink || !branch.value || !sem.value || !session.value) {
        showMessage("❌ No syllabus is available to share.", 5000);
        return;
    }

    const title = `${getBranchName(branch.value)} - ${getSemesterName(sem.value)} (${session.value}) BEU Syllabus`;

    trackGA4Event("syllabus_share", {
        branch: getBranchName(branch.value),
        semester: getSemesterName(sem.value),
        session: session.value,
        file_url: pdfLink
    });

    try {
        if (navigator.share) {
            await navigator.share({ title, text: title, url: pdfLink });
            return;
        }
        await navigator.clipboard.writeText(pdfLink);
        showMessage("🔗 Link copied to clipboard.", 5000);
    } catch (err) {
        if (err && err.name === "AbortError") return; // user closed the share sheet
        showMessage("❌ Could not share. Please try Download instead.", 5000);
    }
};

// PWA SERVICE WORKER
if ("serviceWorker" in navigator) {
    // Was the page already controlled by a SW when it loaded?
    // (Prevents a reload / dialog on the very first visit.)
    const hadController = !!navigator.serviceWorker.controller;
    let swRegistration = null;
    let refreshing = false;
    let newVersionPrompted = false;
    let syllabusPrompted = false;

    const SYNC_TAG = "sync-syllabus";

    // ---------- Styled update popup (replaces the plain browser confirm box) ----------
    // Popups are queued so two never overlap. Resolves true on "Update", false on "Later".
    let popupQueue = Promise.resolve();

    const ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>';
    const ICON_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';

    function showUpdatePopup({ icon, title, message, sub, confirmText }) {
        const run = () => new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "upd-overlay";
            overlay.innerHTML =
                '<div class="upd-card" role="alertdialog" aria-modal="true" aria-labelledby="updMsg">' +
                  '<div class="upd-icon" aria-hidden="true">' + icon + '</div>' +
                  '<div class="upd-title"></div>' +
                  '<p class="upd-msg" id="updMsg"></p>' +
                  '<p class="upd-sub"></p>' +
                  '<div class="upd-actions">' +
                    '<button type="button" class="upd-btn-secondary">Later</button>' +
                    '<button type="button" class="upd-btn-primary"></button>' +
                  '</div>' +
                '</div>';

            // textContent keeps the text safe (no HTML injection)
            overlay.querySelector(".upd-title").textContent = title;
            overlay.querySelector(".upd-msg").textContent = message;
            overlay.querySelector(".upd-sub").textContent = sub;
            const okBtn = overlay.querySelector(".upd-btn-primary");
            const laterBtn = overlay.querySelector(".upd-btn-secondary");
            okBtn.textContent = confirmText;

            const finish = result => {
                document.removeEventListener("keydown", onKey, true);
                overlay.remove();
                resolve(result);
            };
            const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); finish(false); } };

            okBtn.addEventListener("click", () => finish(true));
            laterBtn.addEventListener("click", () => finish(false));
            overlay.addEventListener("click", e => { if (e.target === overlay) finish(false); });
            document.addEventListener("keydown", onKey, true);

            document.body.appendChild(overlay);
            okBtn.focus();
        });

        popupQueue = popupQueue.then(run, run);
        return popupQueue;
    }

    function promptNewVersion() {
        if (newVersionPrompted) return;
        newVersionPrompted = true;

        showUpdatePopup({
            icon: ICON_REFRESH,
            title: "Update Available",
            message: "New version available! Update now.",
            sub: "A newer version of the app is ready with the latest improvements.",
            confirmText: "Update Now"
        }).then(ok => {
            if (!ok) return; // dismissed: don't nag again until the next page load

            // NEW_VERSION arrives while the worker is still "installing", so check both.
            const worker = swRegistration && (swRegistration.waiting || swRegistration.installing);
            if (worker) {
                worker.postMessage({ type: "SKIP_WAITING" }); // -> controllerchange -> reload
            } else {
                window.location.reload();
            }
        });
    }

    // Remember which syllabus version we already asked about, so the popup is
    // shown at most ONCE per real change - never again on later launches.
    const SEEN_KEY = "beu_syllabus_prompted_hash";
    function readSeen() { try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; } }
    function writeSeen(v) { try { localStorage.setItem(SEEN_KEY, v); } catch (e) {} }

    function promptSyllabusUpdate(hash) {
        if (syllabusPrompted) return;
        if (hash && readSeen() === hash) return;
        syllabusPrompted = true;
        if (hash) writeSeen(hash);

        showUpdatePopup({
            icon: ICON_BOOK,
            title: "Syllabus Updated",
            message: "New syllabus added, Please update.",
            sub: "Fresh syllabus content has been downloaded. Refresh to see it.",
            confirmText: "Refresh Now"
        }).then(ok => {
            if (ok) window.location.reload(); // re-runs js/data.js (already fresh in cache)
        });
    }

    // Ask for a Background Sync (fires when connection is back, even if offline now).
    // Browsers without Background Sync fall back to the "online" event.
    function requestSyllabusSync() {
        if (!swRegistration) return;

        if ("sync" in swRegistration) {
            swRegistration.sync.register(SYNC_TAG).catch(() => postManualSync());
        } else {
            postManualSync();
        }
    }

    function postManualSync() {
        const sw = navigator.serviceWorker.controller || (swRegistration && swRegistration.active);
        if (sw) sw.postMessage({ type: "SYNC_SYLLABUS" });
    }

    // Messages coming from the service worker
    navigator.serviceWorker.addEventListener("message", event => {
        const type = event.data && event.data.type;

        if (type === "NEW_VERSION") {
            // Ignore on first install (nothing to "update" from).
            // Only hadController is trusted: navigator.serviceWorker.controller
            // becomes truthy on the first visit too (clients.claim()), which
            // used to cause a false "New version available" popup.
            if (hadController) {
                promptNewVersion();
            }
        } else if (type === "SYLLABUS_UPDATED") {
            promptSyllabusUpdate(event.data.hash);
        }
    });

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js") // relative: works from any sub-path
            .then(registration => {
                console.log("✅ SW Registered");
                swRegistration = registration;

                // A new version may already be waiting (user dismissed earlier)
                if (registration.waiting && hadController) {
                    promptNewVersion();
                }

                // Queue a sync now; it runs as soon as the network is available.
                navigator.serviceWorker.ready.then(requestSyllabusSync);
            })
            .catch(err => console.log("❌ SW Error:", err));
    });

    // Connection restored -> make sure the cache gets refreshed
    window.addEventListener("online", requestSyllabusSync);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || refreshing) return; // skip reload on first install
        refreshing = true;
        window.location.reload();
    });
}
