package expo.modules.streamresolution

import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamType
import java.util.concurrent.atomic.AtomicBoolean

/**
 * StreamResolutionModule: Native Android module bridging NewPipeExtractor
 * to React Native / Expo for resolving YouTube audio streams.
 *
 * Extraction internals mirror the verified NØTE reference implementation:
 * StreamInfo.getInfo(ServiceList.YouTube, url), an explicit en-US/US
 * localization, and progressive-HTTP audio selection by highest average
 * bitrate. The promise boundary remains Aero's own.
 */
class StreamResolutionModule : Module() {
  companion object {
    private const val TAG = "StreamResolution"
    private val isInitialized = AtomicBoolean(false)

    /**
     * Serialises NewPipe.init().
     *
     * The AtomicBoolean alone was not enough once warm-up could run
     * concurrently with a real resolution: compareAndSet(false, true) published
     * the flag *before* NewPipe.init() ran, so a second caller could observe
     * isInitialized == true and proceed to use a half-initialised extractor.
     */
    private val initLock = Any()

    fun ensureInitialized() {
      if (isInitialized.get()) return
      synchronized(initLock) {
        // Re-check under the lock: another caller may have finished init while
        // this one was waiting.
        if (isInitialized.get()) return
        try {
          Log.i(TAG, "[Lifecycle] Initializing NewPipe with NoteNativeDownloader...")
          NewPipe.init(
            NoteNativeDownloader(),
            Localization("en", "US"),
            ContentCountry("US"),
          )
          // Published only after init succeeded, so anyone who sees the flag
          // set is guaranteed to see a fully initialised NewPipe.
          isInitialized.set(true)
          Log.i(TAG, "[Lifecycle] NewPipe.init() completed successfully.")
        } catch (e: Throwable) {
          Log.e(TAG, "[Lifecycle] NewPipe.init() FAILED: ${e.javaClass.name} - ${e.message}", e)
          throw e
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("StreamResolution")

    AsyncFunction("resolveStreamAsync") { videoId: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        val tStart = System.currentTimeMillis()
        Log.i(TAG, "[Resolve] resolve_start videoId='$videoId'")
        try {
          ensureInitialized()

          val cleanVideoId = videoId.trim().removePrefix("yt:")
          if (cleanVideoId.isEmpty()) {
            Log.e(TAG, "[Resolve] Clean video ID is empty for input: '$videoId'")
            promise.reject("E_INVALID_ID", "Video ID cannot be empty", null)
            return@launch
          }

          val videoUrl = "https://www.youtube.com/watch?v=$cleanVideoId"
          Log.i(TAG, "[Resolve] YouTube URL: $videoUrl")

          val info = StreamInfo.getInfo(ServiceList.YouTube, videoUrl)

          when (info.streamType) {
            StreamType.LIVE_STREAM, StreamType.AUDIO_LIVE_STREAM -> {
              Log.w(TAG, "[Resolve] Live stream is not supported.")
              promise.reject("E_LIVE_STREAM", "Live streams are not supported yet", null)
              return@launch
            }
            StreamType.NONE -> {
              Log.w(TAG, "[Resolve] StreamType.NONE - no playable stream for this item.")
              promise.reject("E_UNSUPPORTED", "No playable stream for this item", null)
              return@launch
            }
            else -> Unit
          }

          // Phase 1 — retrieve the audio stream list from the extracted info.
          val audioStreams = info.audioStreams
          audioStreams?.forEach { stream ->
            Log.d(TAG, "[Resolve] candidate: delivery=${stream.deliveryMethod}, format=${stream.format?.name}, mime=${stream.format?.mimeType}, bitrate=${stream.averageBitrate}, urlEmpty=${stream.content.isNullOrEmpty()}")
          }

          // Phase 2 — filter down to progressive-HTTP candidates.
          val progressiveStreams = progressiveCandidates(audioStreams)

          // Phase 3 — pick the final stream (highest average bitrate).
          val bestAudio = bestProgressiveAudio(progressiveStreams)
          if (bestAudio == null) {
            Log.w(TAG, "[Resolve] No progressive audio stream available.")
            promise.reject(
              "E_NO_AUDIO_STREAM",
              "No progressive audio stream available for video $cleanVideoId",
              null,
            )
            return@launch
          }

          val streamUrl = bestAudio.content
          if (streamUrl.isNullOrBlank()) {
            Log.e(TAG, "[Resolve] Selected stream URL is empty.")
            promise.reject("E_EMPTY_STREAM_URL", "Extracted audio stream URL is empty", null)
            return@launch
          }

          val mimeType = bestAudio.format?.mimeType ?: "audio/mp4"
          Log.i(TAG, "[Resolve] resolve_done elapsed=${System.currentTimeMillis() - tStart}ms")

          promise.resolve(
            mapOf(
              "uri" to streamUrl,
              "mimeType" to mimeType,
              "bitrate" to bestAudio.averageBitrate,
              "format" to (bestAudio.format?.name ?: "unknown"),
              // googlevideo ties a stream URL to the client that asked for it;
              // the player must replay this UA or the fetch is rejected.
              "userAgent" to NoteNativeDownloader.USER_AGENT,
            )
          )
        } catch (e: Throwable) {
          val stackTrace = Log.getStackTraceString(e)
          Log.e(TAG, "[Resolve] EXCEPTION CAUGHT: ${e.javaClass.name}: ${e.message}\n$stackTrace")
          promise.reject(
            "E_STREAM_RESOLUTION_FAILED",
            "Stream resolution failed for $videoId: ${e.javaClass.name}: ${e.localizedMessage ?: e.message}",
            e,
          )
        }
      }
    }

    /**
     * Cold-start warm-up. Moves work that is otherwise paid *inside the first
     * resolution* to a moment the caller chooses (app start, or the instant
     * online search results arrive).
     *
     * Two costs are provably on the first-resolution path today:
     *
     *  1. NewPipe.init(...) -- ensureInitialized() is the first statement of
     *     resolveStreamAsync, so the first tap always pays it.
     *  2. ServiceList static initialisation -- reading ServiceList.YouTube
     *     constructs every registered service. The first resolution forces it,
     *     because StreamInfo.getInfo(ServiceList.YouTube, url) names the field,
     *     and that happens inside getInfo().
     *
     * Both are pure and side-effect free: no network request is issued, no
     * stream is resolved, nothing is cached beyond what NewPipe.init already
     * holds, and no playback is started. ensureInitialized() is guarded by an
     * AtomicBoolean, so this is safe to call concurrently with (or after) a
     * real resolution, and it is safe to call more than once.
     */
    AsyncFunction("warmUpAsync") { promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          ensureInitialized()
          // Force the service registry to initialise. Reading the field is the
          // whole point; the id is used only so the expression is a real use.
          val youtubeServiceId = ServiceList.YouTube.serviceId
          Log.i(TAG, "[Lifecycle] warmUpAsync complete (NewPipe + services ready, youtubeId=$youtubeServiceId)")
          promise.resolve(null)
        } catch (e: Throwable) {
          // Best effort by definition: the real path calls ensureInitialized()
          // again, and a resolution failure must be surfaced there, not here.
          Log.w(TAG, "[Lifecycle] warmUpAsync failed: ${e.javaClass.name} - ${e.message}")
          promise.resolve(null)
        }
      }
    }
  }

  /**
   * expo-audio plays progressive HTTP sources. DASH/HLS entries would resolve
   * fine but fail at playback, so they are filtered out rather than handed to
   * the player. Matches NØTE's selection exactly.
   *
   * Kept as two named steps (filter, then pick) for readability. The
   * predicates and their order are unchanged, so the candidate list and the
   * selected stream are identical to the previous single-expression form.
   */
  private fun progressiveCandidates(streams: List<AudioStream>?): List<AudioStream>? =
    streams
      ?.filter { it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP }
      ?.filter { it.isUrl && !it.content.isNullOrBlank() }

  private fun bestProgressiveAudio(candidates: List<AudioStream>?): AudioStream? =
    candidates?.maxByOrNull { it.averageBitrate }
}