package expo.modules.shareintent

import android.content.Intent
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * ShareIntent: the thin Android → JS bridge for incoming link intents —
 * ACTION_SEND text shares AND ACTION_VIEW deep links (opened URLs).
 *
 * This module owns NO parsing and NO business logic — its entire job is to
 * hand incoming text to JavaScript exactly once:
 *
 *  - the native side reads EXTRA_TEXT from a text/plain ACTION_SEND intent
 *    (consumed with removeExtra) or the data URI of an ACTION_VIEW intent
 *    (consumed by clearing the data), so the same intent can never be
 *    delivered twice no matter how many code paths observe intents;
 *  - only these two actions are read; every other intent is ignored;
 *  - cold start: JS pulls the launch intent through getInitialSharedText();
 *  - warm app: expo-modules-core's OnNewIntent hook receives the new
 *    intent (ReactActivity → ReactContext ActivityEventListener chain),
 *    with no MainActivity changes — this covers BOTH share and view intents;
 *  - intents that arrive with a recreated activity while the JS process
 *    lives are caught by OnActivityEntersForeground reading getIntent();
 *  - text that arrives before a JS listener exists is parked as pending and
 *    handed over by the next getInitialSharedText() call.
 *
 * URL parsing, validation and everything provider-side stay in TypeScript.
 */
class ShareIntentModule : Module() {
  /** Text consumed while no listener existed; handed to the next read. */
  @Volatile
  private var pendingText: String? = null

  /** True while a JS listener is subscribed to onSharedText. */
  private var isObserving = false

  /** Delivers to JS when listening; parks the text otherwise (never drops it). */
  private fun deliver(text: String) {
    if (!isObserving) {
      pendingText = text
      return
    }
    try {
      sendEvent("onSharedText", mapOf("text" to text))
    } catch (error: Exception) {
      Log.w("ShareIntent", "Could not deliver shared text: ${error.message}")
      pendingText = text
    }
  }

  /**
   * Extracts the incoming payload from an intent and CONSUMES it, so the
   * same intent can never be delivered twice no matter how many code paths
   * observe it:
   *
   *  - ACTION_SEND + text/plain → EXTRA_TEXT (share-sheet payload),
   *    consumed with removeExtra();
   *  - ACTION_VIEW + http/https  → the opened URL (intent data), consumed
   *    by clearing the data. Non-http(s) VIEW intents are ignored untouched
   *    (the manifest only ever routes http/https here; this is defense in
   *    depth — no other scheme is ever forwarded to JS).
   *
   * Synchronized: the initial-read, on-new-intent and foreground paths all
   * funnel through here — exactly-once is enforced natively, not in JS.
   */
  @Synchronized
  private fun drainIncomingText(intent: Intent?): String? {
    if (intent == null) return null
    val text = when (intent.action) {
      Intent.ACTION_SEND -> {
        val type = intent.type
        if (type != null && !type.startsWith("text/plain")) {
          null
        } else {
          // CharSequence on purpose: some apps hand back a styled sequence.
          intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
        }
      }

      Intent.ACTION_VIEW -> {
        val data = intent.data
        val scheme = data?.scheme?.lowercase()
        if (scheme == "http" || scheme == "https") data.toString().trim() else null
      }

      else -> null
    }
    if (text.isNullOrEmpty()) return null
    when (intent.action) {
      Intent.ACTION_SEND -> intent.removeExtra(Intent.EXTRA_TEXT)
      Intent.ACTION_VIEW -> intent.data = null // consume: later paths see nothing
      else -> Unit
    }
    return text
  }

  override fun definition() = ModuleDefinition {
    Name("ShareIntent")

    Events("onSharedText")

    OnStartObserving {
      isObserving = true
    }

    OnStopObserving {
      isObserving = false
    }

    /**
     * Warm arrival (share OR opened link): the new intent is dispatched
     * here by expo-modules-core (no MainActivity override needed). An
     * intent with no drainable payload simply finds nothing and is ignored.
     */
    OnNewIntent { intent ->
      val text = drainIncomingText(intent)
      if (text != null) deliver(text)
    }

    /**
     * Catches intents that arrive with a freshly (re)created activity while
     * the JS process is alive — onNewIntent does not run for those, but the
     * new activity's getIntent() carries the share/link. No-op on ordinary
     * foregrounds (the payload was already consumed).
     */
    OnActivityEntersForeground {
      val text = drainIncomingText(appContext.currentActivity?.intent)
      if (text != null) deliver(text)
    }

    /**
     * Cold-start read: the launch intent's payload (consumed), or any text
     * parked by an early delivery. Returns null when there is none.
     */
    Function("getInitialSharedText") {
      val fromIntent = drainIncomingText(appContext.currentActivity?.intent)
      val text = fromIntent ?: pendingText
      pendingText = null
      text
    }

    OnDestroy {
      pendingText = null
      isObserving = false
    }
  }
}
