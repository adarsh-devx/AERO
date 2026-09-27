package expo.modules.mediacontrols

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
// androidx.media:media ships these compat classes under their original
// android.support.v4.media.* package names (verified in the AAR).
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * MediaPlaybackService: Aero's Android foreground media service.
 *
 * It owns exactly two things — the MediaSessionCompat and the media
 * notification (MediaStyle, previous / play-pause / next + seek ±10s).
 * It owns NO queue and NO audio: every transport action is forwarded to
 * JS as an event (through MediaControlsModule.activeModule) and routed
 * by MediaControlsBridge into the existing PlayerController methods.
 *
 * State flows one way in: the module's `update(state, payloadJson)` is
 * delivered here as ACTION_UPDATE; the latest snapshot mirror is applied
 * to the session (playback state, metadata, position) and rendered into
 * the notification. Nothing is polled, no second timer exists — the
 * service only re-renders when JS pushes a change.
 *
 * Lifecycle: started as a foreground service (mediaPlayback type) while
 * audio is active; `state == "stopped"` (or JS stop) hides the
 * notification and exits. Swiping Aero away from Recent Apps triggers
 * `onTaskRemoved`, which stops JS playback through the existing command
 * bridge, retires the notification/session and stops this service —
 * while Home, lock-screen, app switching and screen-off NEVER reach that
 * callback, so normal background playback is untouched.
 */
class MediaPlaybackService : android.app.Service() {
  companion object {
    private const val TAG = "MediaControls"
    const val ACTION_UPDATE = "expo.modules.mediacontrols.UPDATE"
    const val EXTRA_STATE = "state"
    const val EXTRA_PAYLOAD = "payload"
    private const val ACTION_TOGGLE = "expo.modules.mediacontrols.TOGGLE"
    private const val ACTION_PREVIOUS = "expo.modules.mediacontrols.PREVIOUS"
    private const val ACTION_NEXT = "expo.modules.mediacontrols.NEXT"
    private const val ACTION_SEEK_BACKWARD = "expo.modules.mediacontrols.SEEK_BACKWARD"
    private const val ACTION_SEEK_FORWARD = "expo.modules.mediacontrols.SEEK_FORWARD"
    private const val CHANNEL_ID = "aero_media_playback"
    private const val NOTIFICATION_ID = 0xA3E0
    private const val SEEK_STEP_MS = 10_000L
    /** Artwork is downscaled to this max edge; enough for any lock screen. */
    private const val ARTWORK_MAX_EDGE = 512
  }

  /** Latest snapshot mirror pushed from JS (null until first update). */
  private data class UiState(
    val state: String,
    val positionMs: Long,
    val title: String?,
    val artist: String?,
    val album: String?,
    val artworkUri: String?,
    val durationMs: Long,
    val hasPrevious: Boolean,
    val hasNext: Boolean,
  )

  private var session: MediaSessionCompat? = null
  private var uiState: UiState? = null
  private var lastArtwork: Bitmap? = null
  @Volatile
  private var currentArtworkUri: String? = null
  private val artworkExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    session = MediaSessionCompat(this, "AeroMedia").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = emit("play", null)
        override fun onPause() = emit("pause", null)
        override fun onSkipToNext() = emit("next", null)
        override fun onSkipToPrevious() = emit("previous", null)
        override fun onStop() = emit("stop", null)
        override fun onSeekTo(positionMs: Long) = emit("seekTo", positionMs)
      })
      setActive(true)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Notification/lock-screen transport buttons: forward to JS only.
    when (intent?.action) {
      ACTION_TOGGLE -> { emit("toggle", null); return START_NOT_STICKY }
      ACTION_PREVIOUS -> { emit("previous", null); return START_NOT_STICKY }
      ACTION_NEXT -> { emit("next", null); return START_NOT_STICKY }
      ACTION_SEEK_BACKWARD -> { emit("seekBackward", null); return START_NOT_STICKY }
      ACTION_SEEK_FORWARD -> { emit("seekForward", null); return START_NOT_STICKY }
      ACTION_UPDATE -> { /* handled below */ }
      else -> return START_NOT_STICKY
    }

    // Active updates arrive via startForegroundService, which REQUIRES a
    // startForeground() call in this same callback (Android aborts the app
    // otherwise). So every non-stopped path promotes first — even when the
    // payload is missing or malformed — and only then applies what it has.
    val state = intent.getStringExtra(EXTRA_STATE) ?: "stopped"
    if (state == "stopped") {
      teardownNotification()
      stopSelf()
      return START_NOT_STICKY
    }

    val parsed = intent.getStringExtra(EXTRA_PAYLOAD)?.let { parsePayload(state, it) }
    val next = parsed ?: UiState(state, 0L, null, null, null, null, 0L, false, false)

    uiState = next
    promoteForeground(next)

    val ui = next
    session?.let { s ->
      s.setPlaybackState(buildPlaybackState(ui))
      s.setMetadata(buildMetadata(ui))
    }

    // Artwork: only re-fetch when the URI actually changed.
    if (ui.artworkUri != currentArtworkUri) {
      currentArtworkUri = ui.artworkUri
      lastArtwork = null
      if (ui.artworkUri != null) loadArtwork(ui.artworkUri)
      else refreshNotification()
    }
    return START_NOT_STICKY
  }

  /**
   * The user swiped Aero's task away from Recent Apps.
   *
   * This is the ONE Android lifecycle callback that distinguishes task
   * removal from every other backgrounding path (Home, app switch, screen
   * off, lock — none of which reach it). Cleanup order:
   *
   *  1. `stop` through the existing command bridge: MediaControlsBridge
   *     routes it into PlayerController.stop() — the same stop the session's
   *     onStop uses, so no second playback-stop path is invented. Audio
   *     (expo-audio) stops in the still-alive JS process.
   *  2. Native teardown of what THIS service owns: playback state → STOPPED,
   *     session deactivated here, foreground notification removed
   *     (teardownNotification) — and the session is released by onDestroy
   *     when stopSelf() lands.
   *  3. stopSelf() so the service never lingers after the task is gone.
   *
   * Every onStartCommand path already returns START_NOT_STICKY, so neither
   * this event nor the subsequent stopSelf() can restart the service. The
   * bridge emit is fire-and-forget: if no JS bridge exists, the native
   * teardown below still completes, so the service and notification can
   * never be left behind.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    emit("stop", null)
    teardownNotification()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    session?.release()
    session = null
    artworkExecutor.shutdownNow()
    super.onDestroy()
  }

  // ── State application ────────────────────────────────────────────────

  private fun parsePayload(state: String, payload: String): UiState? =
    try {
      val json = JSONObject(payload)
      UiState(
        state = state,
        positionMs = json.optLong("positionMs", 0L),
        title = json.optStringOrNull("title"),
        artist = json.optStringOrNull("artist"),
        album = json.optStringOrNull("album"),
        artworkUri = json.optStringOrNull("artworkUri"),
        durationMs = json.optLong("durationMs", 0L),
        hasPrevious = json.optBoolean("hasPrevious", false),
        hasNext = json.optBoolean("hasNext", false),
      )
    } catch (error: Exception) {
      Log.w(TAG, "Ignoring malformed media payload: ${error.message}")
      null
    }

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

  private fun buildPlaybackState(ui: UiState): PlaybackStateCompat {
    // Mirror of PlayerController semantics: next/previous availability is
    // exactly snapshot.hasNext / snapshot.hasPrevious — the system UI
    // hides a transport button the JS queue would no-op on anyway.
    var actions = PlaybackStateCompat.ACTION_PLAY or
      PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or
      PlaybackStateCompat.ACTION_SEEK_TO
    if (ui.hasPrevious) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    if (ui.hasNext) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT

    val state = when (ui.state) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "loading" -> PlaybackStateCompat.STATE_BUFFERING
      else -> PlaybackStateCompat.STATE_PAUSED
    }
    // Aero has NO playback-speed feature: audio always advances at 1.0×,
    // so the system UI interpolates the scrub bar at real time. Paused
    // reports 0 (position must not advance); playing/buffering report 1.0.
    // Queue logic still lives in PlayerController — this only mirrors
    // state to the system.
    val speed = if (ui.state == "paused") 0f else 1f
    // Position + speed: the system UI interpolates the scrub bar between
    // our pushes, so JS only has to forward position on real changes.
    return PlaybackStateCompat.Builder()
      .setActions(actions)
      .setState(state, ui.positionMs, speed)
      .build()
  }

  private fun buildMetadata(ui: UiState): MediaMetadataCompat =
    MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, ui.title ?: "")
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, ui.artist ?: "")
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, ui.album ?: "")
      .apply {
        if (ui.durationMs > 0) putLong(MediaMetadataCompat.METADATA_KEY_DURATION, ui.durationMs)
        lastArtwork?.let { bitmap ->
          putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bitmap)
          putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, bitmap)
        }
      }
      .build()

  private fun promoteForeground(ui: UiState) {
    val notification = buildNotification(ui)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to promote Aero media service to foreground", error)
    }
  }

  private fun teardownNotification() {
    // Clear the render source FIRST: an artwork callback already posted to
    // the main thread must not re-notify() after the notification is gone.
    uiState = null
    session?.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setState(PlaybackStateCompat.STATE_STOPPED, 0, 0f)
        .build(),
    )
    session?.setActive(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun refreshNotification() {
    val ui = uiState ?: return
    try {
      getSystemService(NOTIFICATION_SERVICE)?.let { manager ->
        (manager as NotificationManager).notify(NOTIFICATION_ID, buildNotification(ui))
      }
    } catch (error: Exception) {
      Log.w(TAG, "Notification refresh failed: ${error.message}")
    }
  }

  // ── Notification ─────────────────────────────────────────────────────

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW,
          ),
        )
      }
    }
  }

  private fun launchPendingIntent(): PendingIntent? {
    val appIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this,
      0,
      appIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun actionPendingIntent(action: String): PendingIntent =
    PendingIntent.getService(
      this,
      action.hashCode(),
      Intent(this, MediaPlaybackService::class.java).setAction(action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun smallIconResId(): Int {
    val appIcon = applicationInfo.icon
    return if (appIcon != 0) appIcon else android.R.drawable.ic_media_play
  }

  private fun buildNotification(ui: UiState): Notification {
    val s = session
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(smallIconResId())
      // A missing/empty title would make Android render
      // "<App> is running..." — the invisible placeholder avoids that.
      .setContentTitle(ui.title ?: "\u200E")
      .setContentText(ui.artist)
      .setSubText(ui.album)
      .setLargeIcon(lastArtwork)
      .setContentIntent(launchPendingIntent())
      .setAutoCancel(false)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)

    // Required transport controls + seek, in the classic media order.
    // Compact view shows prev / play-pause / next (indices 1-3).
    builder.addAction(
      NotificationCompat.Action(
        android.R.drawable.ic_media_rew,
        "Seek backward",
        actionPendingIntent(ACTION_SEEK_BACKWARD),
      ),
    )
    builder.addAction(
      NotificationCompat.Action(
        android.R.drawable.ic_media_previous,
        "Previous",
        actionPendingIntent(ACTION_PREVIOUS),
      ),
    )
    builder.addAction(
      NotificationCompat.Action(
        if (ui.state == "playing") android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        if (ui.state == "playing") "Pause" else "Play",
        actionPendingIntent(ACTION_TOGGLE),
      ),
    )
    builder.addAction(
      NotificationCompat.Action(
        android.R.drawable.ic_media_next,
        "Next",
        actionPendingIntent(ACTION_NEXT),
      ),
    )
    builder.addAction(
      NotificationCompat.Action(
        android.R.drawable.ic_media_ff,
        "Seek forward",
        actionPendingIntent(ACTION_SEEK_FORWARD),
      ),
    )

    if (s != null) {
      builder.setStyle(
        MediaStyle()
          .setMediaSession(s.sessionToken)
          .setShowActionsInCompactView(1, 2, 3),
      )
    }
    return builder.build()
  }

  // ── Artwork ──────────────────────────────────────────────────────────

  /**
   * Loads artwork off the main thread for http(s), file:// and content://
   * URIs. Any failure (offline, missing file, undecodable bytes) leaves
   * `lastArtwork` null: the notification and metadata stay fully
   * functional without artwork — it can never break playback or the
   * session.
   */
  private fun loadArtwork(uri: String) {
    artworkExecutor.execute {
      val bitmap = try {
        decodeArtwork(uri)
      } catch (error: Exception) {
        Log.w(TAG, "Artwork load failed for $uri: ${error.message}")
        null
      }
      mainHandler.post {
        // A newer update owns the artwork slot now; drop the stale result.
        if (uri != currentArtworkUri) return@post
        lastArtwork = bitmap
        uiState?.let { ui ->
          session?.setMetadata(buildMetadata(ui))
          refreshNotification()
        }
      }
    }
  }

  private fun decodeArtwork(uri: String): Bitmap? {
    val bytes = readAllBytes(uri) ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    var maxEdge = maxOf(bounds.outWidth, bounds.outHeight)
    while (maxEdge / 2 >= ARTWORK_MAX_EDGE) {
      sample *= 2
      maxEdge /= 2
    }
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun readAllBytes(uri: String): ByteArray? = when {
    uri.startsWith("http://") || uri.startsWith("https://") -> {
      val connection = URL(uri).openConnection() as HttpURLConnection
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      connection.instanceFollowRedirects = true
      connection.inputStream.use { input ->
        ByteArrayOutputStream().also { out ->
          val buffer = ByteArray(16 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
          }
        }.toByteArray()
      }
    }
    uri.startsWith("content://") -> {
      contentResolver.openInputStream(Uri.parse(uri))?.use { input ->
        ByteArrayOutputStream().also { out ->
          val buffer = ByteArray(16 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
          }
        }.toByteArray()
      }
    }
    uri.startsWith("file://") || uri.startsWith("/") -> {
      FileInputStream(uri.removePrefix("file://")).use { input ->
        ByteArrayOutputStream().also { out ->
          val buffer = ByteArray(16 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
          }
        }.toByteArray()
      }
    }
    else -> null
  }

  private fun emit(command: String, positionMs: Long?) {
    MediaControlsModule.activeModule?.emitCommand(command, positionMs)
      ?: Log.w(TAG, "Dropped media command '$command': no JS bridge attached")
  }
}
