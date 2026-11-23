#!/usr/bin/env node
/*
 * Stamps build info into service-worker.js and version.json.
 * Run it before deploying shell changes or a new release:
 *   node scripts/build-sw.js
 *
 * BUILD_ID  = hash over the files the service worker caches (shell only).
 *             Deterministic: no timestamp, and js/data.js is NOT included,
 *             so a data-only change leaves service-worker.js byte-identical
 *             and the browser never sees a "new worker".
 * APP_VERSION = the "version" field of version.json, which YOU edit by hand.
 *             Changing it is what triggers the "New Version Available" popup.
 *
 * Options:
 *   --bump   also increment the patch number in version.json ("1.0.2" -> "1.0.3")
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const swPath = path.join(root, "service-worker.js");
const versionPath = path.join(root, "version.json");

// Shell files only. js/data.js is deliberately NOT listed.
const hashed = [
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/app.js",
  "js/analytics.js",
  "js/config.js",
  "js/tracker.js",
  "js/user-id.js",
  "js/donate.js",
  "js/stats.js",
  "css/stats.css",
];

const hash = crypto.createHash("sha1");
for (const file of hashed) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) {
    hash.update(file).update(fs.readFileSync(full));
  }
}
const buildId = hash.digest("hex").slice(0, 12);

// version.json: "version" is edited by hand; only "build" is written here.
let info = {};
try {
  info = JSON.parse(fs.readFileSync(versionPath, "utf8"));
} catch {
  info = { version: "1.0.0" };
}
if (process.argv.includes("--bump")) {
  const parts = String(info.version).split(".").map(Number);
  parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
  info.version = parts.join(".");
}
info.build = buildId;

// service-worker.js: stamp BUILD_ID and APP_VERSION
const buildMarker = /^const BUILD_ID = ".*"; \/\/ @build-id$/m;
const versionMarker = /^const APP_VERSION = ".*"; \/\/ @app-version$/m;
let sw = fs.readFileSync(swPath, "utf8");
if (!buildMarker.test(sw) || !versionMarker.test(sw)) {
  console.error(
    'Missing `const BUILD_ID = "..."; // @build-id` or ' +
      '`const APP_VERSION = "..."; // @app-version` line in service-worker.js.',
  );
  process.exit(1);
}
sw = sw
  .replace(buildMarker, `const BUILD_ID = "${buildId}"; // @build-id`)
  .replace(
    versionMarker,
    `const APP_VERSION = "${info.version}"; // @app-version`,
  );

// Write only when something actually changed (keeps files untouched on no-op runs).
if (sw !== fs.readFileSync(swPath, "utf8")) {
  fs.writeFileSync(swPath, sw);
}
const versionOut = JSON.stringify(info, null, 2) + "\n";
if (
  !fs.existsSync(versionPath) ||
  versionOut !== fs.readFileSync(versionPath, "utf8")
) {
  fs.writeFileSync(versionPath, versionOut);
}

console.log(`Build ${buildId} (version ${info.version})`);
console.log(`Cache name: beu-shell-${buildId}`);
