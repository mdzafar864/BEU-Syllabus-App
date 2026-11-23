<p align="center">
  <img src="./assets/logo.png" alt="BEU Syllabus App Logo" width="140">
</p>

<h1 align="center">📚 BEU Syllabus App</h1>

<p align="center">
  <b>One place for all Bihar Engineering University (BEU) B.Tech syllabus</b><br>
  Branch-wise • Semester-wise • Session-wise • Installable PWA
</p>

<p align="center">
  <a href="https://mdzafar864.github.io/BEU-Syllabus-App/"><img src="https://img.shields.io/badge/Live-Demo-blue?style=for-the-badge" alt="Live Demo"></a>
  <a href="./archive/v1.0"><img src="https://img.shields.io/badge/Serverless-v1.0%20Archive-purple?style=for-the-badge" alt="Serverless v1.0 Archive"></a>
  <img src="https://img.shields.io/badge/PWA-Supported-success?style=for-the-badge" alt="PWA">
  <img src="https://img.shields.io/badge/Responsive-Yes-brightgreen?style=for-the-badge" alt="Responsive">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white" alt="CSS3">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/MongoDB%20Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white" alt="MongoDB Atlas">
  <img src="https://img.shields.io/badge/Razorpay-0C2451?style=flat-square&logo=razorpay&logoColor=white" alt="Razorpay">
  <img src="https://img.shields.io/badge/GitHub%20Pages-222?style=flat-square&logo=github&logoColor=white" alt="GitHub Pages">
</p>

---

## 📑 Table of Contents

- [About](#-about)
- [Features](#-features)
- [Versions](#-versions)
- [Supported Branches & Semesters](#-supported-branches--semesters)
- [Project Architecture](#-project-architecture)
- [Project Structure](#-project-structure)
- [Screenshots](#-screenshots)
- [Getting Started](#-getting-started)
- [Deployment (CI/CD)](#-deployment-cicd)
- [Stats Bar & Usage Tracking](#-stats-bar--usage-tracking)
- [Donations (Razorpay)](#-donations-razorpay)
- [Archive Folder](#-archive-folder)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [Developer](#-developer)
- [License](#-license)

---

## 📖 About

**BEU Syllabus App** is a **Progressive Web App (PWA)** for students of **Bihar Engineering University (BEU)**. It gives **branch-wise**, **semester-wise** and **session-wise** B.Tech syllabus PDFs with an easy interface. Preview and download the latest syllabus from any device, no login needed.

---

## ✨ Features

|                                                                   |                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| 📚 Branch-wise syllabus                                           | 🎓 Semester & session navigation                 |
| 📄 In-app PDF preview                                             | 📥 One-click download                            |
| 📱 Mobile & desktop friendly                                      | 🌐 Installable PWA (works like an app)           |
| ⚡ Fast loading with service worker cache                         | 🔄 Auto-update on every deploy                   |
| 📊 Live stats bar (Total / Active users, Downloads)               | 🔒 Anonymous tracking, no personal data          |
| 💙 Support the project with **Razorpay** (UPI, cards, netbanking) | 🛟 UPI fallback if online payment is unavailable |

---

## 🗂 Versions

| Version               | Type                                       | Location                                 | Notes                                                        |
| --------------------- | ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| **Current (v1.0.9)** | Static frontend + analytics & payments API | [`/`](./) (root) + [`/server`](./server) | Stats bar, click tracking, Razorpay donations, MongoDB Atlas |
| **v1.0 (archive)**    | ⚡ **Serverless** (frontend only)          | [`/archive/v1.0`](./archive/v1.0)        | No backend, no database, no stats bar. Only GitHub Pages     |

> Want the simplest possible version with zero backend? Use the [serverless v1.0 archive](./archive/v1.0).

---

## 🎓 Supported Branches & Semesters

**Branches:** CSE • IT • AI • AIML • AIDS • Civil (CE) • Mechanical (ME) • Electrical (EE) • ECE • EEE • IoT

**Semesters:** 1st to 8th

---

## 🏗 Project Architecture

```text
                    ┌───────────────────────────────┐
                    │   GitHub Pages (static host)  │
                    │  index.html • css • js • PWA  │
                    └───────────────┬───────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
 Syllabus data (js/data.js)  tracker.js / stats.js /          donate.js
 semester → session →         user-id.js                        │
 branch → PDF                       │                    POST /api/create-order
                             POST /api/track             POST /api/verify-payment
                             POST /api/users
                             GET  /api/stats
                                    │                           │
                                    │                           │ ◄── Razorpay Checkout modal
                                    │                           │     (loaded only on Donate click)
                          ┌─────────▼───────────────────────────▼─────────┐
                          │             server/ (Node API)                │
                          │             Vercel / Render ...               │
                          │  api/ → src/app.js (analytics, users)         │
                          │       → src/payments.js (donations)           │
                          │         └─ src/razorpay-lite.js (fetch client)│
                          └───────┬───────────────────────────┬───────────┘
                                  │                           │
                       ┌──────────▼──────────┐       ┌────────▼─────────┐
                       │    MongoDB Atlas    │       │     Razorpay     │
                       │ events • visitors • │       │ orders, payments │
                       │ counters • donations│       └────────┬─────────┘
                       └─────────────────────┘                │
                                  ▲   POST /api/razorpay-webhook (signed)
                                  └───────────────────────────┘

   archive/v1.0  →  old serverless build (frontend only, no API / DB / payments)
```

### How it works

1. The frontend is fully static and hosted on **GitHub Pages**.
2. Syllabus links live in `js/data.js` as `syllabus[semester][session][branch] = pdfLink`.
3. `service-worker.js` caches the app for offline-friendly, fast loading. `scripts/build-sw.js` stamps a fresh build id on every deploy so users always get updates.
4. `user-id.js` gives every browser an anonymous `userId` (kept in `localStorage`) and registers it once with `POST /api/users`. `tracker.js` and `stats.js` talk to the **`server/`** API, which stores anonymous usage data in **MongoDB Atlas**. A static site cannot connect to Atlas directly (the password would be public), so the API sits in between.
5. `donate.js` handles donations. The browser only suggests an amount; the **`server/`** API creates the Razorpay order (through `src/razorpay-lite.js`, a small client built on Node's `fetch` instead of the `razorpay` npm package), verifies the payment signature and records the result in the `donations` collection. The Razorpay **key secret never reaches the browser**.

---

## 📂 Project Structure

```text
BEU-Syllabus-App
│
├── index.html                 # App entry point (PWA shell + CSP)
├── manifest.json              # PWA manifest
├── service-worker.js          # Offline cache (build id stamped on deploy)
├── version.json               # App version + build id
├── robots.txt                 # SEO
├── sitemap.xml                # SEO
├── README.md                  # This file
│
├── css/
│   ├── style.css              # Main styles
│   └── stats.css              # Stats bar styles
│
├── js/
│   ├── app.js                 # Core app logic / navigation
│   ├── data.js                # Syllabus data (semester → session → branch → PDF)
│   ├── analytics.js           # Google Analytics 4
│   ├── config.js              # API URL + tracking settings
│   ├── tracker.js             # Click / action tracking → MongoDB + GA4
│   ├── user-id.js             # Anonymous userId (localStorage) → POST /api/users
│   ├── stats.js               # Stats bar (Total, Active, Downloads)
│   └── donate.js              # Razorpay donations (amount picker, Checkout, verify)
│
├── assets/
│   ├── logo.png, Developer.png
│   ├── icon-192/512.png, icon-maskable-192/512.png, apple-touch-icon.png
│   ├── favicon.ico / .svg / -96x96.png
│   └── screenshots/           # README screenshots
│
├── server/                    # Analytics + payments API (Node.js + MongoDB Atlas)
│   ├── api/                   # Vercel functions (one file per route)
│   │   ├── track.js, stats.js, health.js     # analytics
│   │   ├── users.js                          # register anonymous userId
│   │   ├── create-order.js                   # Razorpay: create order
│   │   ├── verify-payment.js                 # Razorpay: verify signature + payment
│   │   └── razorpay-webhook.js               # Razorpay: signed webhook (raw body)
│   ├── src/                   # app, config, db, seed, validate, instance,
│   │                          # payments (donation logic), payments-instance,
│   │                          # razorpay-lite (minimal Razorpay REST client)
│   ├── scripts/seed.js        # Manual DB seed
│   ├── server.js              # Local / Node host entry (analytics + payment routes)
│   ├── vercel.json            # Vercel settings (Fluid compute, Mumbai region bom1)
│   ├── package.json           # Dependency: mongodb only
│   ├── .env.example           # Environment variable template (MongoDB + Razorpay)
│   ├── .gitignore             # Ignores node_modules/ and .env
│   └── README.md              # API documentation
│
├── scripts/
│   └── build-sw.js            # Stamps build id into service-worker.js & version.json
│
├── .github/workflows/
│   └── deploy.yml             # Build + deploy to GitHub Pages
│
└── archive/                   # 🗄 Store folder (old versions)
    ├── .nojekyll              # Tells GitHub Pages to skip Jekyll processing here
    └── v1.0/                  # ⚡ Serverless version (frontend only)
        ├── index.html, manifest.json, service-worker.js, version.json
        ├── robots.txt, sitemap.xml, README.md
        ├── css/style.css
        ├── js/ (app.js, analytics.js, data.js)
        ├── assets/            # icons, logo (.png + .svg), screenshots
        ├── scripts/build-sw.js
        └── .github/workflows/deploy.yml
```

---

## 📸 Screenshots

<table align="center">
  <tr>
    <td align="center"><b>🏠 Home</b><br><br><img src="./assets/screenshots/home.png" alt="Home" width="260"></td>
    <td align="center"><b>📂 Branch</b><br><br><img src="./assets/screenshots/branch.png" alt="Branch" width="260"></td>
    <td align="center"><b>🎓 Semester</b><br><br><img src="./assets/screenshots/semester.png" alt="Semester" width="260"></td>
  </tr>
  <tr>
    <td align="center"><b>📅 Session</b><br><br><img src="./assets/screenshots/session.png" alt="Session" width="260"></td>
    <td align="center"><b>📄 PDF Viewer</b><br><br><img src="./assets/screenshots/pdf-viewer.png" alt="PDF Viewer" width="260"></td>
    <td align="center"><b>👨‍💻 Developer Info</b><br><br><img src="./assets/screenshots/developer-info.png" alt="Developer Info" width="260"></td>
  </tr>
</table>

---

## 🚀 Getting Started

### Run the frontend

```bash
git clone https://github.com/mdzafar864/BEU-Syllabus-App.git
cd BEU-Syllabus-App
```

Open `index.html`, or serve it locally (recommended, needed for the service worker):

```bash
npx serve .
```

### Run the analytics API locally (optional)

```bash
cd server
cp .env.example .env      # add your MongoDB Atlas + Razorpay TEST details
npm install
npm run dev
```

Check it at `http://localhost:3000/api/health`. The user route (`/api/users`) and the donation routes (`/api/create-order`, `/api/verify-payment`, `/api/razorpay-webhook`) run on the same server. If `AUTO_SEED=false`, run `npm run seed` once to create the collections.

### Use the serverless version (no backend)

```bash
cd archive/v1.0
npx serve .
```

---

## 🔄 Deployment (CI/CD)

Pushing to `main` runs [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which:

1. Checks out the repo and sets up Node 22.
2. Runs `node scripts/build-sw.js` to stamp a fresh **build id** into `service-worker.js` and `version.json` (deployed copy only, nothing is committed back).
3. Removes `scripts`, `.github` and `.git` from the published output. (`js/donate.js` is part of the hashed, cached app shell like the other scripts.)
4. Uploads and deploys to **GitHub Pages**.

Bump the patch version when releasing:

```bash
node scripts/build-sw.js --bump     # 1.0.2 -> 1.0.3
```

---

## 📊 Stats Bar & Usage Tracking

A stats bar under the **Install / App Mode Active** button shows **Total Users**, **Active Users** and **Downloads**. Every button click, dropdown change and app action is saved to **MongoDB Atlas**, next to the existing **Google Analytics 4** tracking.

```text
Browser (GitHub Pages) ──► server/ API (Vercel / Render / ...) ──► MongoDB Atlas
tracker.js, stats.js,       POST /api/track   POST /api/users   GET /api/stats
   user-id.js
```

### Setup (about 10 minutes)

1. **Atlas:** create a free cluster and a database user. Under _Network Access_ allow your API host (Vercel needs `0.0.0.0/0`, so use a strong password).
2. **Deploy `server/`** to Vercel (Root Directory = `server`) or any Node host, using the variables from [`server/.env.example`](./server/.env.example). Open `https://YOUR-API/api/health` to verify.
   `server/vercel.json` runs functions in Mumbai (`bom1`); change it to the Vercel region nearest your Atlas cluster.
3. **Point the app at it** (same URL in both places):
   - `js/config.js` → `apiBase: "https://YOUR-API"`
   - `index.html` → add the same origin to `connect-src` in the Content Security Policy. (The Razorpay hosts are already allowed there for donations.)
4. Push. Until `apiBase` is set, tracking is off and the bar shows `—`.

The API creates its collections, indexes and default documents automatically on first connection to an empty database. More details: [`server/README.md`](./server/README.md).

### What is stored

| Collection  | Holds                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `events`    | One row per click / change / action (`type`, `name`, `data`, `visitorId`, `sessionId`, time). Auto-deleted after `EVENT_TTL_DAYS` (default 180). |
| `visitors`  | One row per anonymous browser id: first / last seen, language, screen. Powers Total and Active users.                                            |
| `counters`  | Running Downloads total (kept even after old events expire).                                                                                     |
| `donations` | One row per Razorpay order (see [Donations](#-donations-razorpay)). Not deleted automatically.                                                   |

- **Total users** = distinct anonymous browser ids.
- **Active users** = visitors whose page is open and in the foreground. A heartbeat every 20 s (`heartbeatMs`) keeps them counted; closing or backgrounding the page removes them immediately. `ACTIVE_WINDOW_MINUTES` (default 1) is the safety net for crashed tabs or lost connections.
- **Downloads** = presses of the Download button in the PDF viewer.
- 🔒 **Privacy:** no names, emails or IP addresses are stored. The id is a random value in `localStorage`; clearing site data creates a new one.
- Event types in `events`: `click`, `change`, `action` (mirrored GA4 events), `page_view`, `session_start`.
- Raw clicks and dropdown changes also go to GA4 as `ui_click` / `ui_select_change`. Set `mirrorUiEventsToGA: false` in `js/config.js` to turn that off.

---

## 💙 Donations (Razorpay)

The **Donate** button opens Razorpay Checkout (UPI, cards, netbanking, wallets). If the API or Razorpay script is unreachable, it falls back to the original UPI flow.

```text
Donate click → POST /api/create-order → Razorpay Checkout modal
             → POST /api/verify-payment → "Thank you" message
                       (Razorpay webhook confirms in the background)
```

### API routes

| Route                        | Called by | What it does                                                                                                                                                                            |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/create-order`     | Browser   | Validates the amount (whole ₹, within limits), converts to paise **on the server**, creates the Razorpay order, stores it as `created`, returns `{ orderId, amount, currency, keyId }`. |
| `POST /api/verify-payment`   | Browser   | Checks the HMAC signature, confirms the order is ours, fetches the payment from Razorpay and matches amount / currency / status, then marks the donation `paid`. Safe to call twice.    |
| `POST /api/razorpay-webhook` | Razorpay  | Signed with the webhook secret and verified against the **raw** body. Settles donors who paid but closed the tab. Handles `payment.captured`, `order.paid`, `payment.failed`.           |

### Setup

1. **Install (backend only):** `cd server && npm install`. No Razorpay package is needed: `src/razorpay-lite.js` calls the Razorpay REST API with Node's built-in `fetch`. Commit `package-lock.json` and run `npm audit --omit=dev`.
2. **Environment variables** (Vercel → Settings → Environment Variables, or `server/.env` locally):

   | Variable                                | Value                                                  |
   | --------------------------------------- | ------------------------------------------------------ |
   | `RAZORPAY_KEY_ID`                       | `rzp_test_...` first, `rzp_live_...` later             |
   | `RAZORPAY_KEY_SECRET`                   | From Razorpay Dashboard → API Keys (shown once)        |
   | `RAZORPAY_WEBHOOK_SECRET`               | Long random string you choose (`openssl rand -hex 32`) |
   | `DONATION_MIN_INR` / `DONATION_MAX_INR` | Optional limits, default ₹1 / ₹50,000                  |
   | `DONATION_RATE_LIMIT_PER_MIN`           | Optional per-IP limit, default 20                      |

3. **Webhook:** Razorpay Dashboard → Settings → Webhooks → URL `https://YOUR-API/api/razorpay-webhook`, same secret as above, events `payment.captured`, `order.paid`, `payment.failed` (optionally `payment.authorized`).
4. **Test with test keys** and check that the `donations` document becomes `paid`. Keep your browser console open for any CSP message on the first payment.
5. **Go live:** complete Razorpay activation, switch to `rzp_live_` keys, redeploy, make one small real payment.

### `donations` collection

| Field                     | Meaning                                                  |
| ------------------------- | -------------------------------------------------------- |
| `_id`                     | Razorpay order id                                        |
| `status`                  | `created` → `authorized` or `paid`                       |
| `amount`, `currency`      | In paise and `INR`                                       |
| `paymentId`, `method`     | Set once the payment is verified (`paymentId` is unique) |
| `donorName`               | Optional, sanitized                                      |
| `createdAt`, `verifiedAt` | Timestamps                                               |

### Security rules

- 🔐 The **key secret and webhook secret live only in server environment variables.** Never put them in `js/`, `index.html`, this README or git. Rotate the secret immediately if it leaks.
- The browser is never trusted for the amount or for "payment success". Only the server's signature check plus a Razorpay payment lookup marks a donation paid.
- Signatures are compared in constant time, routes are rate limited, CORS is limited to `ALLOWED_ORIGINS`, and responses are `Cache-Control: no-store`.

---

## 🗄 Archive Folder

The [`archive/`](./archive) folder is a **store folder** for old versions of the app. It is kept for reference and is not part of the active app.

| Item                                       | Purpose                                                                                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`archive/v1.0`](./archive/v1.0)           | ⚡ **Serverless BEU Syllabus App.** Frontend only: no `server/`, no MongoDB, no stats bar. Works with just GitHub Pages.                                                                                                                             |
| [`archive/.nojekyll`](./archive/.nojekyll) | Empty marker file. It tells GitHub Pages **not to run Jekyll** on this folder, so the archived files (including folders such as `.github` and underscore-named paths) are not processed or broken and cannot cause a Pages build / deployment error. |

### Rules for the archive

- Do not edit files inside `archive/` unless you are fixing a bug in that old version.
- Keep `.nojekyll` in place. Deleting it can bring back Jekyll processing errors.
- New old versions go in their own folder, for example `archive/v1.1`, `archive/v2.0`.

---

## 🚧 Roadmap

- [ ] 🔍 Search syllabus
- [ ] ❤️ Favorite subjects
- [ ] 🌙 Dark mode
- [ ] 📢 Notifications
- [ ] 📚 Notes section
- [ ] 📝 Previous year questions
- [ ] 🤖 Telegram bot integration
- [ ] 📱 Android app

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a branch: `git checkout -b feature-name`
3. Commit: `git commit -m "Add new feature"`
4. Push: `git push origin feature-name`
5. Open a Pull Request

---

## 👨‍💻 Developer

<p align="center">
  <img src="https://raw.githubusercontent.com/mdzafar864/BEU-Syllabus-App/main/assets/Developer.png" alt="Md Zafar" width="150">
</p>

<p align="center">
  <b>Md Zafar</b><br>
  💻 Full Stack Developer • 🎓 B.Tech Student • 🏫 Bihar Engineering University<br><br>
  <a href="https://mdzafar864.github.io/Portfolio/">🌐 Portfolio</a> •
  <a href="https://github.com/mdzafar864">🐙 GitHub</a> •
  <a href="https://mdzafar864.github.io/BEU-Syllabus-App/">🚀 Live App</a>
</p>

---

## 📜 License

Licensed under the **MIT License**.

## 🙏 Acknowledgements

Bihar Engineering University • GitHub • Open Source Community • All Contributors • Every BEU Student

---

<p align="center">
  ⭐ If this project helps you, please star the repo and share it with friends!<br><br>
  <a href="https://github.com/mdzafar864/BEU-Syllabus-App">⭐ Star Repository</a> •
  <a href="https://mdzafar864.github.io/BEU-Syllabus-App/">🌐 Live Demo</a> •
  <a href="https://github.com/mdzafar864">🐙 GitHub</a>
</p>

<p align="center">© 2026 MZ Tech Solutions. <b>All Rights Reserved.</b></p>
