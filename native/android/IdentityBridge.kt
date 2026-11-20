package com.beu.syllabus.identity

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * Hands the persistent id to js/tracker.js (it looks for window.BEUNative).
 *
 * In your Activity, BEFORE webView.loadUrl(...):
 *     webView.settings.javaScriptEnabled = true
 *     IdentityBridge.install(webView)
 *
 * And in Application.onCreate(), warm the id off the main thread so the first
 * JS call never waits on the Keystore:
 *     Thread { PersistentUserId.get(this) }.start()
 */
class IdentityBridge(private val context: Context) {
    @JavascriptInterface fun getId(): String = PersistentUserId.get(context)
    @JavascriptInterface fun getPlatform(): String = PersistentUserId.platform(context)

    companion object {
        fun install(webView: WebView) {
            webView.addJavascriptInterface(IdentityBridge(webView.context.applicationContext), "BEUNative")
        }
    }
}
