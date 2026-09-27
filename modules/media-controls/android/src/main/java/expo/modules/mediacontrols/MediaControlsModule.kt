package expo.modules.mediacontrols

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * MediaControls: the thin Android command/event bridge for Aero's
 * lock-screen / notification media controls.
 *
 * This module owns NO playback state. It is a two-way pipe:
 *
 *  - JS → Android: `update(state, payloadJson)` forwards the latest
 *    PlayerController snapshot (metadata + transport state + position)
 *    to MediaPlaybackService, which renders the MediaSessionCompat /
 *    MediaStyle notification. The service is the only long-lived owner
 *    of the notification and session; this module just relays.
 *
 *  - Android → JS: transport actions (notification buttons, lock screen,
 *    Bluetooth headset media buttons) arrive as `onCommand` events and
 *    are routed by MediaControlsBridge into the existing PlayerController
 *    methods (togglePlayPause/next/previous/seek/stop) — queue logic is
 *    never duplicated in Kotlin.
 *
 *  - `onAudioBecomingNoisy`: ACTION_AUDIO_BECOMING_NOISY (headphones
 *    unplugged / Bluetooth audio output removed) is forwarded as an
 *    event; the bridge pauses only when actually playing.
 *
 * Degradation: if the service cannot be started, only a warning is
 * logged — playback itself (expo-audio) is completely unaffected.
 */
class MediaControlsModule : Module() {
  companion object {
    private const val TAG = "MediaControls"

    /**
     * The one live module instance, used by MediaPlaybackService to emit
     * command events back into JS. Cleared in OnDestroy so a hot reload
     * can never leave a stale bridge behind (at most one holder exists).
     */
    @Volatile
    var activeModule: MediaControlsModule? = null
  }

  /** Forwards a transport command to the JS bridge; drops when no bridge. */
  internal fun emitCommand(command: String, positionMs: Long?) {
    val module = activeModule ?: return
    try {
      module.sendEvent(
        "onCommand",
        if (positionMs != null) {
          mapOf("command" to command, "positionMs" to positionMs)
        } else {
          mapOf("command" to command)
        },
      )
    } catch (error: Exception) {
      Log.w(TAG, "Could not emit media command $command: ${error.message}")
    }
  }

  private val audioNoisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        val module = activeModule ?: return
        try {
          module.sendEvent("onAudioBecomingNoisy", emptyMap<String, Any?>())
        } catch (error: Exception) {
          Log.w(TAG, "Could not emit audio-becoming-noisy: ${error.message}")
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MediaControls")

    Events("onCommand", "onAudioBecomingNoisy")

    OnCreate {
      activeModule = this@MediaControlsModule
      // Wired headphones unplugged / Bluetooth A2DP disconnected while
      // playing: the platform broadcasts ACTION_AUDIO_BECOMING_NOISY.
      // NOT_EXPORTED is correct and safe for a system-protected broadcast.
      val context = appContext.reactContext
      if (context != null) {
        try {
          ContextCompat.registerReceiver(
            context,
            audioNoisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
          )
        } catch (error: Exception) {
          Log.w(TAG, "Could not register audio-becoming-noisy receiver: ${error.message}")
        }
      }
    }

    OnDestroy {
      if (activeModule === this@MediaControlsModule) {
        activeModule = null
      }
      try {
        appContext.reactContext?.unregisterReceiver(audioNoisyReceiver)
      } catch (_: Exception) {
        // Not registered (never created or already gone): nothing to undo.
      }
    }

    /**
     * Forwards one PlayerController snapshot mirror to the playback
     * service. `state` is one of: playing, paused, loading, stopped.
     * Active states start/keep the foreground media service; `stopped`
     * hides the notification and lets the service exit.
     *
     * Failures (background-start refusal, missing context) are logged
     * and swallowed: the notification may lag, playback never breaks.
     */
    Function("update") { state: String, payloadJson: String ->
      val context = appContext.reactContext
      if (context == null) {
        Log.w(TAG, "update($state) dropped: React context unavailable")
        return@Function
      }
      val intent = Intent(context, MediaPlaybackService::class.java)
        .setAction(MediaPlaybackService.ACTION_UPDATE)
        .putExtra(MediaPlaybackService.EXTRA_STATE, state)
        .putExtra(MediaPlaybackService.EXTRA_PAYLOAD, payloadJson)
      try {
        if (state == "stopped") {
          // Service must already be running whenever we stop; a plain
          // start avoids the startForeground() obligation for a service
          // that is about to exit (and is a no-op if it never ran).
          context.startService(intent)
        } else {
          context.startForegroundService(intent)
        }
      } catch (error: Exception) {
        Log.w(TAG, "Could not deliver media state '$state': ${error.message}")
      }
    }
  }
}
