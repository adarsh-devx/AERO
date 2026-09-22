package expo.modules.appstorage

import android.content.Context
import android.content.SharedPreferences
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * AppStorage: minimal persistent key-value storage for JS.
 *
 * Backed by Android SharedPreferences — the platform's own small-value
 * store, so no storage library is needed. Values are opaque strings;
 * the TS side owns serialization.
 *
 * Deliberately minimal: get / set / remove only. No listing, no
 * namespacing, no migrations.
 */
class AppStorageModule : Module() {
  companion object {
    private const val PREFERENCES_NAME = "aero.app.storage"
  }

  private val preferences: SharedPreferences
    get() {
      val context = appContext?.reactContext
        ?: throw IllegalStateException(
          "React context is unavailable; cannot open AppStorage preferences."
        )
      return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

  override fun definition() = ModuleDefinition {
    Name("AppStorage")

    Function("getItem") { key: String ->
      preferences.getString(key, null)
    }

    Function("setItem") { key: String, value: String ->
      preferences.edit().putString(key, value).apply()
    }

    Function("removeItem") { key: String ->
      preferences.edit().remove(key).apply()
    }
  }
}
