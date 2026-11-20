# Persistent user id (native shells)

The web app counts users by `visitors._id` in MongoDB, so **one stable id = one user**.
In a browser the id lives in `localStorage`, which "Clear data" wipes. The native shells
keep the id somewhere that survives and hand it to `js/tracker.js`.

| Platform | Store | Survives clear data/cache | Survives uninstall |
|---|---|---|---|
| Android phone/tablet | AccountManager (authoritative) + EncryptedSharedPreferences (cache) | Yes | No |
| Android TV | AccountManager + EncryptedSharedPreferences | Yes | No |
| Windows | Credential Manager | Yes | Yes |
| Browser / PWA | localStorage (unchanged) | No | No |

**Why Android uses two stores:** EncryptedSharedPreferences is a file in the app's own data
directory, so "Clear data" deletes it. Only the AccountManager copy outlives that; the
prefs copy is re-filled from it on next launch (and vice versa).

## Contract with the web app
Native injects one of these before the page's scripts run:
- `window.BEU_NATIVE_ID` (+ `window.BEU_PLATFORM`), used on Windows
- `window.BEUNative.getId()` / `getPlatform()`, used on Android

`tracker.js` validates it against the same regex as the server, prefers it over
`localStorage`, and sends `meta.platform` (`web | android | android-tv | windows`).

## Android setup
1. Copy the `.kt` files into package `com.beu.syllabus.identity`, `res/xml/authenticator.xml` into `res/xml/`.
2. Merge `AndroidManifest.snippet.xml`; set `minSdk 23`; add the `security-crypto` dependency.
3. Call `IdentityBridge.install(webView)` before `loadUrl`.
   Warm up in `Application.onCreate`: `Thread { PersistentUserId.get(this) }.start()`.

## Windows setup
Add the WebView2 NuGet package, copy `PersistentUserId.cs`, and call
`await PersistentUserId.InstallAsync(webView.CoreWebView2)` before the first `Navigate`.

## Limits worth knowing
- Uninstall on Android (and "Remove account" in Settings > Accounts) creates a new id. Android has no
  supported way for an app to keep an id across uninstall without a user sign-in.
- On phones the account appears under Settings > Accounts as "BEU Syllabus".
- `androidx.security:security-crypto` is deprecated by Google but still works; the code
  already survives its known keystore-mismatch crash by resetting the file.
- The id is not a secret. Anyone can POST an arbitrary id to `/api/track`, so this prevents
  honest double-counting, not deliberate inflation.
- Run `node scripts/build-sw.js` before deploying so the service worker picks up the new `tracker.js`.
- The Kotlin and C# were written without a compiler available here; build and test on a device.
