#!/usr/bin/env node
/*
 * Stamps a fresh, unique build id into service-worker.js and version.json.
 * Run it before every deploy:   node scripts/build-sw.js
 *
 * Build id = base36 timestamp + 8 hex chars of a hash over the files the
 * service worker caches, so every run is unique and the id also changes
 * whenever the content does.
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

const hashed = [
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/app.js",
  "js/analytics.js",
  "js/data.js",
];

const hash = crypto.createHash("sha1");
for (const file of hashed) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) {
    hash.update(file).update(fs.readFileSync(full));
  }
}
const buildId = `${Date.now().toString(36)}-${hash.digest("hex").slice(0, 8)}`;

// service-worker.js: replace the line tagged "// @build-id"
const marker = /^const BUILD_ID = ".*"; \/\/ @build-id$/m;
const sw = fs.readFileSync(swPath, "utf8");
if (!marker.test(sw)) {
  console.error('Could not find the `const BUILD_ID = "..."; // @build-id` line.');
  process.exit(1);
}
fs.writeFileSync(
  swPath,
  sw.replace(marker, `const BUILD_ID = "${buildId}"; // @build-id`),
);

// version.json: keep "version", write the new "build"
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
fs.writeFileSync(versionPath, JSON.stringify(info, null, 2) + "\n");

console.log(`Build ${buildId} (version ${info.version})`);
console.log(`Cache name: beu-shell-${buildId}`);
