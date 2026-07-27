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

        showMessage("✅ App install successfully completed. Ab app icon se open karein.", 8000);
    }, 8000);
});

async function installPWA() {
    updateInstallButton();

    if (isPWAStandalone()) {
        showMessage("✅ App mode active hai. Aap installed app ke andar ho.", 6000);
        installBtn.innerHTML = "✅ App Mode Active";
        installBtn.style.background = "#16a34a";
        return;
    }

    if (installInProgress) {
        showMessage("⏳ App install ho raha hai...", 5000);
        return;
    }

    if (localStorage.getItem("beu_pwa_installed") === "yes" && !deferredPrompt) {
        showMessage("✅ App already installed hai. App icon se open karein.", 6000);
        return;
    }

    if (!deferredPrompt) {
        showMessage("ℹ️ Install option abhi available nahi hai. Chrome menu (⋮) se Add to Home Screen / Install App karein.", 9000);
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
        showMessage("⏳ App install ho raha hai...", 15000);
    } else {
        installInProgress = false;
        showMessage("❌ App install cancel ho gaya.", 5000);
        updateInstallButton();
    }
}

window.addEventListener("DOMContentLoaded", updateInstallButton);
window.matchMedia("(display-mode: standalone)").addEventListener("change", updateInstallButton);

let hideTimer;

// RESET MSG ON CHANGE
const branch = document.getElementById("branch");
const sem = document.getElementById("sem");
const msg = document.getElementById("msg");

branch.onchange = sem.onchange = () => {
    msg.style.opacity = 1;
    msg.innerHTML = "Choose branch & semester to view syllabus.";
};

// OPEN PDF
const openBtn = document.getElementById("openBtn");
const pdfFrame = document.getElementById("pdfFrame");
const pdfModal = document.getElementById("pdfModal");

openBtn.onclick = () => {
    let b = branch.value;
    let s = sem.value;

    if (!b || !s) {
        showMessage("❌ Please select both branch & semester.", 10000);
        return;
    }

    if (!syllabus[s] || !syllabus[s][b]) {
        showMessage("❌ Syllabus not available for this selection.", 9000);
        return;
    }

    trackGA4Event("open_syllabus_click", {
        button_text: "Open Syllabus",
        click_location: "main_page"
    });

    let pdflink = syllabus[s][b];
    pdfFrame.src = pdflink;
    pdfModal.style.display = "flex";
    pdfModal.classList.add("active");

    showMessage("📄 Preview opened. Click Download to save.", 8000);
};

// SHOW MESSAGE
function showMessage(text, duration) {
    clearTimeout(hideTimer);
    msg.style.opacity = 1;
    msg.innerHTML = text;

    hideTimer = setTimeout(() => {
        msg.style.opacity = 0;
        setTimeout(() => {
            msg.innerHTML = "Choose branch & semester to view syllabus.";
            msg.style.opacity = 1;
        }, 400);
    }, duration);
}

// CLOSE MODALS
function closePDF() {
    const pdfModalEl = document.getElementById("pdfModal");
    const pdfFrameEl = document.getElementById("pdfFrame");
    pdfModalEl.classList.remove("active");
    pdfModalEl.style.display = "none";
    pdfFrameEl.src = "";
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

// Track Open Syllabus button click
document.getElementById("openBtn").addEventListener("click", () => {
    trackGA4Event("open_syllabus_click", {
        button_text: "Open Syllabus",
        click_location: "main_page"
    });
});

// Close developer modal when clicking outside card
document.getElementById("devModal").addEventListener("click", function(e) {
    if (e.target === this) closeDev();
});

// DOWNLOAD PDF + GA4 TRACKING
const downloadPDFBtn = document.getElementById("downloadPDFBtn");
downloadPDFBtn.onclick = () => {
    const pdfLink = pdfFrame.src;
    const branchCode = branch.value;
    const semesterCode = sem.value;

    if (!pdfLink || !branchCode || !semesterCode) {
        showMessage("❌ Download ke liye syllabus available nahi hai.", 5000);
        return;
    }

    const fileName = `${branchCode}_${semesterCode}_syllabus.pdf`;

    trackGA4Event("syllabus_download", {
        branch: getBranchName(branchCode),
        semester: getSemesterName(semesterCode),
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

    showMessage("✅ Download request started!", 5000);
};

// PWA SERVICE WORKER
const BASE = location.hostname.includes("github.io") ?
    "/BEU-Syllabus-App" :
    "";

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register(`${BASE}/service-worker.js`)
            .then(registration => {
                console.log("✅ SW Registered");

                registration.onupdatefound = () => {
                    const newWorker = registration.installing;

                    newWorker.onstatechange = () => {
                        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                            if (confirm("🚀 New version available! Update now?")) {
                                newWorker.postMessage("skipWaiting");
                            }
                        }
                    };
                };
            })
            .catch(err => console.log("❌ SW Error:", err));
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
    });
}