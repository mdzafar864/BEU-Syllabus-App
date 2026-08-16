// pdf-viewer.js
// Renders PDFs page-by-page (with scroll-snap) using pdf.js so the user
// can scroll and land cleanly on the next page. Falls back automatically
// to the original Google Drive iframe embed if pdf.js can't load the
// file directly (e.g. blocked by CORS) — the app never breaks.

(function () {
    if (typeof pdfjsLib !== "undefined") {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    const pdfPagesEl = document.getElementById("pdfPages");
    const pdfFrameEl = document.getElementById("pdfFrame");
    const pdfLoadingEl = document.getElementById("pdfLoading");
    const pdfPageIndicator = document.getElementById("pdfPageIndicator");

    let currentDoc = null;
    let currentPageNum = 1;
    let renderToken = 0;

    function driveIdFromUrl(url) {
        const match = String(url || "").match(/\/file\/d\/([^/]+)/);
        return match ? match[1] : null;
    }

    function directDriveUrl(previewUrl) {
        const id = driveIdFromUrl(previewUrl);
        return id ? `https://drive.google.com/uc?export=download&id=${id}` : previewUrl;
    }

    function showFallbackIframe(previewUrl) {
        pdfPagesEl.style.display = "none";
        pdfFrameEl.style.display = "block";
        pdfFrameEl.src = previewUrl;
        if (pdfPageIndicator) pdfPageIndicator.textContent = "";
    }

    function clearPages() {
        pdfPagesEl.innerHTML = "";
    }

    async function renderPage(pdf, num) {
        const page = await pdf.getPage(num);
        const containerWidth = pdfPagesEl.clientWidth || 600;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth - 24) / baseViewport.width;
        const viewport = page.getViewport({ scale: Math.max(scale, 0.5) });

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.dataset.pageNumber = String(num);
        wrapper.appendChild(canvas);
        pdfPagesEl.appendChild(wrapper);

        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
    }

    function updatePageIndicator() {
        if (!pdfPageIndicator || !currentDoc) return;
        const pages = pdfPagesEl.querySelectorAll(".pdf-page");
        let closest = 1;
        let closestDist = Infinity;
        const containerTop = pdfPagesEl.getBoundingClientRect().top;
        pages.forEach((p) => {
            const dist = Math.abs(p.getBoundingClientRect().top - containerTop);
            if (dist < closestDist) {
                closestDist = dist;
                closest = Number(p.dataset.pageNumber);
            }
        });
        currentPageNum = closest;
        pdfPageIndicator.textContent = `Page ${currentPageNum} of ${currentDoc.numPages}`;
    }

    let scrollRAF = null;
    pdfPagesEl.addEventListener("scroll", () => {
        if (scrollRAF) cancelAnimationFrame(scrollRAF);
        scrollRAF = requestAnimationFrame(updatePageIndicator);
    });

    window.goToPDFPage = function (num) {
        const target = pdfPagesEl.querySelector(`.pdf-page[data-page-number="${num}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    window.nextPDFPage = function () {
        if (!currentDoc) return;
        window.goToPDFPage(Math.min(currentPageNum + 1, currentDoc.numPages));
    };

    window.prevPDFPage = function () {
        if (!currentDoc) return;
        window.goToPDFPage(Math.max(currentPageNum - 1, 1));
    };

    window.loadPDF = async function (previewUrl) {
        const myToken = ++renderToken;
        currentPageNum = 1;
        currentDoc = null;
        clearPages();
        pdfFrameEl.style.display = "none";
        pdfFrameEl.src = "";
        pdfPagesEl.style.display = "block";
        if (pdfPageIndicator) pdfPageIndicator.textContent = "";
        if (pdfLoadingEl) pdfLoadingEl.style.display = "flex";

        if (typeof pdfjsLib === "undefined") {
            showFallbackIframe(previewUrl);
            if (pdfLoadingEl) pdfLoadingEl.style.display = "none";
            return;
        }

        try {
            const url = directDriveUrl(previewUrl);
            const pdf = await pdfjsLib.getDocument(url).promise;
            if (myToken !== renderToken) return; // a newer PDF was requested meanwhile

            currentDoc = pdf;

            for (let i = 1; i <= pdf.numPages; i++) {
                if (myToken !== renderToken) return;
                await renderPage(pdf, i);
            }

            if (pdfPageIndicator) {
                pdfPageIndicator.textContent = `Page 1 of ${pdf.numPages}`;
            }
        } catch (err) {
            console.warn("pdf.js could not load the file directly, using embedded viewer instead:", err);
            if (myToken === renderToken) showFallbackIframe(previewUrl);
        } finally {
            if (myToken === renderToken && pdfLoadingEl) pdfLoadingEl.style.display = "none";
        }
    };

    window.unloadPDF = function () {
        renderToken++; // cancel any in-flight render loop
        clearPages();
        pdfFrameEl.src = "";
        pdfFrameEl.style.display = "none";
        currentDoc = null;
        currentPageNum = 1;
        if (pdfPageIndicator) pdfPageIndicator.textContent = "";
    };
})();
