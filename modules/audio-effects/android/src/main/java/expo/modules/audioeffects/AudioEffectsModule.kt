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
 * AudioEffects: Aero's native maximum-loudness layer.
 *
 * At Aero volume = 100% this makes playback as loud as is safely/practically
 * possible by running the audio through Android's real effect pipeline
 * (AudioFlinger insert effect on the player's own audio session), NOT by
 * writing player volume above 1.0 (the mixer-level volume ceiling stays 1.0).
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
 * Gain is a single bounded constant (see MAX_LOUDNESS_GAIN_mB): +600 mB
 * (+6 dB). The AOSP LoudnessEnhancer applies this as makeup gain into its
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
     * The one loudness knob: +600 mB = +6.0 dB ≈ ×2.0 amplitude into the
     * enhancer's compressor stage. Bounded on purpose — this is "as loud
     * as safely/practically possible", not an arbitrary multiplier, and it
     * is applied by the effect chain, never by raising player volume.
     */
    private const val MAX_LOUDNESS_GAIN_mB = 600

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
    private class EffectState(val player: ExoPlayer) {
      var effect: LoudnessEnhancer? = null
      var effectSessionId: Int = C.AUDIO_SESSION_ID_UNSET
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
      if (state.effect != null && state.effectSessionId == sessionId) return

      releaseEffect(state)
      try {
        // The session id came from the live player, so its AudioTrack for
        // this session exists — never a guessed or arbitrary session.
        val effect = LoudnessEnhancer(sessionId)
        effect.setTargetGain(MAX_LOUDNESS_GAIN_mB)
        val status = effect.setEnabled(true)
        if (status != AudioEffect.SUCCESS) {
          effect.release()
          Log.w(TAG, "LoudnessEnhancer could not enable on session $sessionId (status $status)")
          return
        }
        state.effect = effect
        state.effectSessionId = sessionId
        Log.i(TAG, "LoudnessEnhancer attached to audio session $sessionId at +${MAX_LOUDNESS_GAIN_mB} mB")
      } catch (error: Throwable) {
        // Device without the effect library, session raced away, etc.:
        // loudness boost degrades to plain 1.0 playback, never playback failure.
        Log.w(TAG, "Could not attach LoudnessEnhancer to session $sessionId: ${error.message}")
      }
    }

    /** Attaches (or re-syncs) the loudness effect for one player. Idempotent. */
    private fun attach(player: ExoPlayer) {
      states[player]?.let { sync(it); return }

      val state = EffectState(player)
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
     * Starts keeping a bounded LoudnessEnhancer on the player's real audio
     * session. Fire-and-forget: all work is posted to the main thread, the
     * effect appears as soon as Media3 reports the session id (first
     * playback), and repeated calls are no-ops.
     *
     * [player] is the expo-audio AudioPlayer instance from JS — resolved
     * through expo-modules-core SharedRef (cross-library reference
     * passing) back to its underlying ExoPlayer. Declared as
     * SharedRef<ExoPlayer> so the converter verifies the actual ref type.
     */
    Function("attachLoudness") { player: SharedRef<ExoPlayer> ->
      mainHandler.post { attach(player.ref) }
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
