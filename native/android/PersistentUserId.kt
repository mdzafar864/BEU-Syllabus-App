package com.beu.syllabus.identity

import android.accounts.Account
import android.accounts.AccountManager
import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * One anonymous, persistent user id for Android phones/tablets AND Android TV.
 *
 * Two stores, because they survive different things:
 *
 *   EncryptedSharedPreferences  fast, encrypted, but lives in app data
 *                               -> LOST on "Clear data" and on uninstall.
 *   AccountManager account      lives in the system accounts database
 *                               -> SURVIVES "Clear data" / "Clear cache",
 *                                  lost only on uninstall (the account is
 *                                  removed with its authenticator app).
 *
 * Resolution order: AccountManager (authoritative) -> EncryptedSharedPreferences
 * -> generate a new UUID. Whichever store is missing the id is healed from the
 * other, so one clear-data event never produces a new user.
 *
 * Requires minSdk 23 (own-account-type access needs no GET_ACCOUNTS permission).
 */
object PersistentUserId {
    private const val TAG = "PersistentUserId"
    private const val PREFS_FILE = "beu_identity"
    private const val PREFS_KEY = "user_id"

    const val ACCOUNT_TYPE = "com.beu.syllabus.identity" // must match authenticator.xml
    private const val ACCOUNT_NAME = "BEU Syllabus"
    private const val USERDATA_KEY = "user_id"

    // Same pattern the server enforces (validate.js ID_RE); a UUID always matches.
    private val ID_RE = Regex("^[A-Za-z0-9_-]{8,64}$")

    @Volatile private var cached: String? = null
    private val lock = Any()

    /** Returns the persistent id, creating it on first ever call. Safe from any thread. */
    @JvmStatic
    fun get(context: Context): String {
        cached?.let { return it }
        synchronized(lock) {
            cached?.let { return it }
            val app = context.applicationContext

            val fromAccount = readAccount(app)
            val fromPrefs = readPrefs(app)

            val id = fromAccount ?: fromPrefs ?: UUID.randomUUID().toString()

            // Heal whichever store lost the value (e.g. after "Clear data").
            if (fromAccount != id) writeAccount(app, id)
            if (fromPrefs != id) writePrefs(app, id)

            cached = id
            return id
        }
    }

    /** "android-tv" or "android"; matches the platform values the server accepts. */
    @JvmStatic
    fun platform(context: Context): String {
        val ui = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        return if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) "android-tv" else "android"
    }

    // ---------------------------------------------------------------- Account Manager

    private fun readAccount(ctx: Context): String? = runCatching {
        val am = AccountManager.get(ctx)
        am.getAccountsByType(ACCOUNT_TYPE).firstNotNullOfOrNull { acc ->
            am.getUserData(acc, USERDATA_KEY)?.takeIf { ID_RE.matches(it) }
        }
    }.onFailure { Log.w(TAG, "AccountManager read failed", it) }.getOrNull()

    private fun writeAccount(ctx: Context, id: String) {
        runCatching {
            val am = AccountManager.get(ctx)
            val existing = am.getAccountsByType(ACCOUNT_TYPE).firstOrNull()
            if (existing != null) {
                am.setUserData(existing, USERDATA_KEY, id)
            } else {
                val account = Account(ACCOUNT_NAME, ACCOUNT_TYPE)
                // No password / token: this account only carries the id.
                am.addAccountExplicitly(account, null, Bundle().apply { putString(USERDATA_KEY, id) })
            }
        }.onFailure { Log.w(TAG, "AccountManager write failed", it) }
    }

    // ---------------------------------------------------------------- EncryptedSharedPreferences

    private fun prefs(ctx: Context) = EncryptedSharedPreferences.create(
        ctx,
        PREFS_FILE,
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private fun readPrefs(ctx: Context): String? = try {
        prefs(ctx).getString(PREFS_KEY, null)?.takeIf { ID_RE.matches(it) }
    } catch (t: Throwable) {
        // Known failure: keystore key and prefs file out of sync (restore from
        // backup, OS upgrade, OEM bug). The file is unreadable, so drop it; the
        // id is then recovered from the AccountManager copy.
        Log.w(TAG, "EncryptedSharedPreferences unreadable, resetting", t)
        ctx.deleteSharedPreferences(PREFS_FILE)
        null
    }

    private fun writePrefs(ctx: Context, id: String) {
        runCatching { prefs(ctx).edit().putString(PREFS_KEY, id).apply() }
            .onFailure { Log.w(TAG, "EncryptedSharedPreferences write failed", it) }
    }
}
