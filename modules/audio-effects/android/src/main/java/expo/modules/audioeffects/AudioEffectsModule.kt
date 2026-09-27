package expo.modules.audioeffects

import android.media.audiofx.AudioEffect
import android.media.audiofx.LoudnessEnhancer
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedRef

/**
 * AudioEffects: Aero's native loudness-normalization layer.
 *
 * Applies a PER-TRACK bounded gain through Android's real effect pipeline
 * (AudioFlinger insert effect on the player's own audio session), NEVER by
 * writing player volume above 1.0 — the mixer-level volume ceiling stays
 * 1.0 and the user's 0..1 volume slider is untouched.
 *
 * The gain is NOT a constant: JS passes the millibel gain derived from the
 * track's REAL loudness metadata (see src/playback/loudnessNormalization.ts)
 * on every attachLoudness call, bounded to -1500 mB (-15 dB) .. +300 mB
 * (+3 dB) on BOTH sides of the boundary. There is deliberately no fixed
 * boost: when a track has no loudness metadata — or normalization is off —
 * JS calls detachLoudness and no effect stays attached.
 *
 * How the player reaches this module (no node_modules patching):
 * expo-audio's native AudioPlayer extends expo-modules-core
 * `SharedRef<ExoPlayer>` — documented as "Allows passing references to
 * native instances among different independent libraries". JS hands the
 * expo-audio AudioPlayer object straight to these functions, and
 * SharedRefTypeConverter resolves it back to the live ExoPlayer instance.
 *
 * Attachment (never guessed, never an arbitrary session):
 *  - The session id is READ from the actual player
 *    (`Player.getAudioSessionId()`, `C.AUDIO_SESSION_ID_UNSET = 0` while
 *    no AudioTrack exists yet) and re-checked whenever Media3 reports
 *    `AnalyticsListener.onAudioSessionIdChanged` for this player.
 *  - LoudnessEnhancer is created only for a real, reported session id —
 *    at that point the AudioTrack for the session already exists.
 *  - A session change (AudioTrack rebuild) releases the old effect and
 *    attaches a fresh one; detach releases everything.
 *
 * Gain is always supplied per call and clamped to MIN_GAIN_mB..MAX_GAIN_mB
 * (-15 dB .. +3 dB), so this module can never become a blanket amplification
 * layer. The AOSP LoudnessEnhancer applies the gain as makeup gain into its
 * built-in adaptive dynamic-range compressor (EffectLoudnessEnhancer.cpp:
 * "makeup gain is applied on the input of the compressor"), so peaks are
 * compressed rather than blindly multiplied — this is the platform's
 * sanctioned loudness effect, not raw multiplication.
 *
 * Nothing here touches volume, focus, position, queue or stream
 * resolution: if the module is absent (Expo Go / non-Android) the calls
 * degrade to no-ops and playback is unaffected.
 */
@UnstableApi
class AudioEffectsModule : Module() {
  companion object {
    private const val TAG = "AudioEffects"

    /**
     * Meld's normalization bounds, enforced natively as well as in JS:
     * at most +3 dB of boost, at most -15 dB of attenuation. A fixed,
     * always-on boost is exactly what this module must never be.
     */
    private const val MIN_GAIN_mB = -1500
    private const val MAX_GAIN_mB = 300

    /** All player/effect interaction runs on the main thread (ExoPlayer's looper). */
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Per-player effect state, main-thread only (every mutation below is
     * posted to [mainHandler]). Strong keys are intentional: each entry is
     * removed by detachLoudness (wired into the engine's dispose path) or
     * by OnDestroy, whichever comes first.
     */
    private val states = HashMap<ExoPlayer, EffectState>()

    /** Tracks one player's loudness effect + the listener that keeps it in sync. */
    private class EffectState(val player: ExoPlayer, var targetGainMB: Int) {
      var effect: LoudnessEnhancer? = null
      var effectSessionId: Int = C.AUDIO_SESSION_ID_UNSET
      /** Gain actually programmed into the live effect (null = none). */
      var appliedGainMB: Int? = null
      var listener: AnalyticsListener? = null
    }

    /**
     * Releases the effect for [state] (idempotent). Every failure path of
     * an audio effect must end here so no enabled effect outlives its
     * session or its player.
     */
    private fun releaseEffect(state: EffectState) {
      val effect = state.effect ?: return
      state.effect = null
      state.effectSessionId = C.AUDIO_SESSION_ID_UNSET
      state.appliedGainMB = null
      try {
        effect.setEnabled(false)
      } catch (_: Throwable) {
        // Already torn down by AudioFlinger — nothing to undo.
      }
      try {
        effect.release()
      } catch (_: Throwable) {
        // Best effort: the session may already be gone with the track.
      }
    }

    /**
     * Brings [state]'s effect in line with the player's ACTUAL audio
     * session id: attach when the session is known and nothing is attached,
     * re-attach when the session changed, release when the player is gone.
     * Cheap no-op when everything already matches, so being called from
     * several listener hooks is harmless.
     */
    private fun sync(state: EffectState) {
      val player = state.player
      if (player.isReleased) {
        releaseEffect(state)
        return
      }
      val sessionId = try {
        player.audioSessionId
      } catch (_: Throwable) {
        return
      }
      // 0 = C.AUDIO_SESSION_ID_UNSET: no AudioTrack yet (nothing to attach
      // to); a real session id arrives via onAudioSessionIdChanged.
      if (sessionId == C.AUDIO_SESSION_ID_UNSET) return
      val existing = state.effect
      if (existing != null && state.effectSessionId == sessionId) {
        // Same session, possibly a NEW track: only the gain may differ.
        // Update it in place so the previous track's gain never survives
        // into this one, and never churn the effect object.
        if (state.appliedGainMB != state.targetGainMB) {
          try {
            existing.setTargetGain(state.targetGainMB)
            state.appliedGainMB = state.targetGainMB
            Log.i(TAG, "LoudnessEnhancer gain set to ${state.targetGainMB} mB on session $sessionId")
          } catch (error: Throwable) {
            Log.w(TAG, "Could not update LoudnessEnhancer gain: ${error.message}")
          }
        }
        return
      }

      releaseEffect(state)
      try {
        // The session id came from the live player, so its AudioTrack for
        // this session exists — never a guessed or arbitrary session.
        val effect = LoudnessEnhancer(sessionId)
        effect.setTargetGain(state.targetGainMB)
        val status = effect.setEnabled(true)
        if (status != AudioEffect.SUCCESS) {
          effect.release()
          Log.w(TAG, "LoudnessEnhancer could not enable on session $sessionId (status $status)")
          return
        }
        state.effect = effect
        state.effectSessionId = sessionId
        state.appliedGainMB = state.targetGainMB
        Log.i(TAG, "LoudnessEnhancer attached to audio session $sessionId at ${state.targetGainMB} mB")
      } catch (error: Throwable) {
        // Device without the effect library, session raced away, etc.:
        // normalization degrades to plain 1.0 playback, never playback failure.
        Log.w(TAG, "Could not attach LoudnessEnhancer to session $sessionId: ${error.message}")
      }
    }

    /** Attaches (or re-syncs) the loudness effect for one player at [gainMB]. Idempotent. */
    private fun attach(player: ExoPlayer, gainMB: Int) {
      val existing = states[player]
      if (existing != null) {
        // A newer call (e.g. the NEXT track's normalization) replaces the
        // desired gain; sync() applies it in place on the same session or
        // re-attaches on a new one. The old gain is never left behind.
        existing.targetGainMB = gainMB
        sync(existing)
        return
      }

      val state = EffectState(player, gainMB)
      state.listener = object : AnalyticsListener {
        override fun onAudioSessionIdChanged(eventTime: AnalyticsListener.EventTime, audioSessionId: Int) {
          // Media3 reports the REAL session id the AudioTrack got — the
          // authoritative moment an effect can (and must) be attached.
          sync(state)
        }

        override fun onIsPlayingChanged(eventTime: AnalyticsListener.EventTime, isPlaying: Boolean) {
          // Safety net: re-check on playback transitions in case a session
          // was (re)initialized without a preceding change event.
          if (isPlaying) sync(state)
        }
      }
      player.addAnalyticsListener(state.listener!!)
      states[player] = state
      sync(state)
    }

    /** Detaches and releases everything held for one player. Idempotent. */
    private fun detach(player: ExoPlayer) {
      val state = states.remove(player) ?: return
      state.listener?.let { listener ->
        try {
          player.removeAnalyticsListener(listener)
        } catch (_: Throwable) {
          // Player already released — the listener dies with it.
        }
      }
      releaseEffect(state)
    }

    /** Teardown (module destroy / hot reload): no enabled effect may leak. */
    private fun detachAll() {
      val players = states.keys.toList()
      for (player in players) {
        detach(player)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AudioEffects")

    /**
     * Keeps the loudness effect for [player] at [gainMB] (already clamped
     * to -1500..+300 mB): attach on the player's REAL audio session, update
     * the gain in place when only the gain changed, re-attach when the
     * session changed, release when the player is gone. Fire-and-forget —
     * all work is posted to the main thread, and repeated calls are cheap.
     *
     * [player] is the expo-audio AudioPlayer instance from JS — resolved
     * through expo-modules-core SharedRef (cross-library reference
     * passing) back to its underlying ExoPlayer.
     */
    Function("attachLoudness") { player: SharedRef<ExoPlayer>, gainMB: Int ->
      // Bounds enforced HERE as well as in JS: no caller can ever ask for
      // more than +3 dB of boost or more than -15 dB of attenuation.
      mainHandler.post { attach(player.ref, gainMB.coerceIn(MIN_GAIN_mB, MAX_GAIN_mB)) }
    }

    /** Removes the listener and releases the effect for this player. */
    Function("detachLoudness") { player: SharedRef<ExoPlayer> ->
      mainHandler.post { detach(player.ref) }
    }

    OnDestroy {
      mainHandler.post { detachAll() }
    }
  }
}
