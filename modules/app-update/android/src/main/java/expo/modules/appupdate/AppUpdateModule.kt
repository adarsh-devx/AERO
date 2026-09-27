package expo.modules.appupdate

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicReference

/**
 * AppUpdate: the ONE native surface of Aero's in-app update system.
 *
 * Deliberately separate from FileDownloads (music downloads): update APKs
 * live in their own private directory (`filesDir/aero/updates`), never in
 * the music downloads store, and nothing here touches playback, streams or
 * the music download store.
 *
 * Responsibilities:
 * - Report the ACTUAL installed version (versionName/versionCode from
 *   PackageManager) so JS never trusts a hardcoded constant.
 * - Stream an update APK over HTTPS to `<fileName>.part` and atomically
 *   rename it on success (a partial file can never masquerade as a
 *   completed update), with throttled progress events.
 * - Validate a downloaded APK (readable, expected package name, not an
 *   downgrade) BEFORE any installer Intent is built.
 * - Hand the APK to Android's package installer through a
 *   content:// FileProvider URI with an explicit read grant - the system
 *   confirmation dialog is always shown; Aero never installs silently.
 * - Report/detect the Android O+ "install unknown apps" permission state
 *   and open the system settings screen for it (no bypass attempts).
 */
class AppUpdateModule : Module() {
  companion object {
    private const val TAG = "AppUpdate"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 20_000
    private const val PROGRESS_INTERVAL_MS = 150L
    private const val SUBDIRECTORY = "aero/updates"
    private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    /** Conservative file-name allowlist; no separators, must be an .apk. */
    private val SAFE_APK_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*\\.apk$")
  }

  private fun requireUpdatesDir(): File {
    val context = appContext.reactContext
      ?: throw IllegalStateException("React context is unavailable; cannot access the update directory.")
    val dir = File(context.filesDir, SUBDIRECTORY)
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return dir
  }

  /** Resolves a validated file inside the updates directory, or null. */
  private fun resolveUpdateFile(fileName: String): File? {
    if (!SAFE_APK_NAME.matches(fileName)) return null
    return try {
      val dir = requireUpdatesDir().canonicalFile
      val file = File(dir, fileName).canonicalFile
      if (file.parentFile != dir) null else file
    } catch (error: Exception) {
      Log.w(TAG, "resolveUpdateFile failed for $fileName: ${error.message}")
      null
    }
  }

  @Suppress("DEPRECATION")
  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  private fun emitProgress(bytesWritten: Long, totalBytes: Long) {
    sendEvent(
      "updateProgress",
      mapOf(
        "bytesWritten" to bytesWritten,
        "totalBytes" to totalBytes,
      ),
    )
  }

  override fun definition() = ModuleDefinition {
    Name("AppUpdate")

    Events("updateProgress")

    /**
     * The ACTUAL installed app version from PackageManager - the update
     * checker's source of truth for "what am I running". Resolves null when
     * the package state is unreadable (never fabricated).
     */
    Function("getInstalledVersion") {
      val context = appContext.reactContext ?: return@Function null
      try {
        @Suppress("DEPRECATION")
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        mapOf(
          "versionName" to (info.versionName ?: ""),
          "versionCode" to versionCodeOf(info),
        )
      } catch (error: PackageManager.NameNotFoundException) {
        Log.w(TAG, "getInstalledVersion failed: ${error.message}")
        null
      }
    }

    /**
     * Streams `url` (HTTPS only) to `<updatesDir>/<fileName>` via a
     * `.part` file that is atomically renamed on success. Rejects with
     * E_UPDATE_INVALID_URL / E_UPDATE_INVALID_FILE /
     * E_UPDATE_IN_PROGRESS / E_UPDATE_DOWNLOAD_FAILED.
     */
    AsyncFunction("downloadUpdateAsync") { url: String, headersJson: String, fileName: String, promise: Promise ->
      if (!url.startsWith("https://")) {
        promise.reject("E_UPDATE_INVALID_URL", "Update downloads require HTTPS.", null)
        return@AsyncFunction
      }

      val target = resolveUpdateFile(fileName)
      if (target == null) {
        promise.reject("E_UPDATE_INVALID_FILE", "Invalid update file name.", null)
        return@AsyncFunction
      }

      val job = ActiveDownload()
      if (!active.compareAndSet(null, job)) {
        promise.reject("E_UPDATE_IN_PROGRESS", "An update download is already running.", null)
        return@AsyncFunction
      }

      val partial = File(target.parentFile, "$fileName.part")

      CoroutineScope(Dispatchers.IO).launch {
        try {
          // Stale leftovers from an interrupted session must not survive
          // into (or alongside) a fresh download.
          if (target.exists()) target.delete()
          if (partial.exists()) partial.delete()

          val connection = URL(url).openConnection() as HttpURLConnection
          job.connection = connection
          connection.connectTimeout = CONNECT_TIMEOUT_MS
          connection.readTimeout = READ_TIMEOUT_MS
          connection.instanceFollowRedirects = true

          try {
            val headers = JSONObject(headersJson)
            val keys = headers.keys()
            while (keys.hasNext()) {
              val name = keys.next()
              val value = headers.optString(name, "")
              if (value.isNotEmpty()) {
                connection.setRequestProperty(name, value)
              }
            }
          } catch (error: Exception) {
            Log.w(TAG, "Ignoring malformed update download headers: ${error.message}")
          }

          val code = connection.responseCode
          if (code !in 200..299) {
            throw IOException("Server responded with HTTP $code")
          }

          val total = connection.contentLengthLong // -1 when unknown
          var written = 0L
          var lastEmitAt = 0L

          connection.inputStream.use { input ->
            FileOutputStream(partial).use { out ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                written += read
                val now = System.currentTimeMillis()
                if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
                  lastEmitAt = now
                  emitProgress(written, total)
                }
              }
              out.flush()
            }
          }

          // Final progress tick so the UI can reach 100% without waiting
          // for the round-trip.
          emitProgress(written, if (total > 0) total else written)

          if (partial.length() <= 0L) {
            throw IOException("Downloaded update file is empty.")
          }

          if (target.exists()) target.delete()
          if (!partial.renameTo(target)) {
            throw IOException("Could not finalise the downloaded update.")
          }

          promise.resolve(
            mapOf(
              "filePath" to target.absolutePath,
              "sizeBytes" to target.length(),
            ),
          )
        } catch (error: Throwable) {
          // A failed download must leave nothing behind.
          runCatching { partial.delete() }
          promise.reject("E_UPDATE_DOWNLOAD_FAILED", error.message ?: "Update download failed.", error)
        } finally {
          active.compareAndSet(job, null)
          runCatching { job.connection?.disconnect() }
        }
      }
    }

    /** Deletes leftover `.part` files from a session that died mid-download. */
    AsyncFunction("deletePartialsAsync") { promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val removed = requireUpdatesDir()
            .listFiles()
            ?.count { it.isFile && it.name.endsWith(".part") && it.delete() }
            ?: 0
          promise.resolve(removed)
        } catch (error: Exception) {
          Log.w(TAG, "deletePartialsAsync failed: ${error.message}")
          promise.resolve(0)
        }
      }
    }

    /** Whether an update APK currently exists on disk, and its size. */
    AsyncFunction("getUpdateFileInfoAsync") { fileName: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val file = resolveUpdateFile(fileName)
          if (file == null) {
            promise.resolve(mapOf("exists" to false, "sizeBytes" to 0L))
          } else {
            promise.resolve(
              mapOf(
                "exists" to (file.exists() && file.length() > 0L),
                "sizeBytes" to if (file.exists()) file.length() else 0L,
              ),
            )
          }
        } catch (error: Exception) {
          promise.resolve(mapOf("exists" to false, "sizeBytes" to 0L))
        }
      }
    }

    /** Deletes one update file; a missing file counts as success. */
    AsyncFunction("deleteUpdateFileAsync") { fileName: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val file = resolveUpdateFile(fileName)
          if (file == null) {
            promise.resolve(false)
            return@launch
          }
          val deleted = if (file.exists()) file.delete() else true
          promise.resolve(deleted)
        } catch (error: Exception) {
          Log.w(TAG, "deleteUpdateFileAsync failed for $fileName: ${error.message}")
          promise.resolve(false)
        }
      }
    }

    /**
     * Validates the downloaded APK and hands it to Android's package
     * installer (ACTION_VIEW + content:// URI + explicit read grant). The
     * SYSTEM always shows its confirmation dialog - this never installs
     * silently. Rejects with E_NO_ACTIVITY / E_APK_MISSING /
     * E_APK_UNREADABLE / E_APK_MISMATCH (package name is not ours) /
     * E_APK_OLDER (would downgrade) / E_INSTALL_UNAVAILABLE.
     */
    AsyncFunction("installApkAsync") { fileName: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val activity = appContext.currentActivity
            ?: run {
              promise.reject("E_NO_ACTIVITY", "No foreground activity to launch the installer from.", null)
              return@launch
            }

          val file = resolveUpdateFile(fileName)
          if (file == null || !file.exists() || file.length() <= 0L) {
            promise.reject("E_APK_MISSING", "The downloaded update file is missing.", null)
            return@launch
          }

          val packageManager = activity.packageManager
          val archive: PackageInfo = packageManager.getPackageArchiveInfo(file.absolutePath, 0)
            ?: run {
              promise.reject("E_APK_UNREADABLE", "The downloaded file is not a readable APK.", null)
              return@launch
            }

          // Package identity: never offer an APK that is not THIS app
          // (com.aero.musicplayer == the running applicationId).
          if (archive.packageName != activity.packageName) {
            promise.reject(
              "E_APK_MISMATCH",
              "The downloaded APK is '${archive.packageName}', expected '${activity.packageName}'.",
              null,
            )
            return@launch
          }

          // Never allow a downgrade (Android would refuse it anyway; fail
          // early with a clear, non-installer error instead).
          val installed = packageManager.getPackageInfo(activity.packageName, 0)
          if (versionCodeOf(archive) < versionCodeOf(installed)) {
            promise.reject("E_APK_OLDER", "The downloaded APK is older than the installed version.", null)
            return@launch
          }

          val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
          val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME_TYPE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          try {
            activity.startActivity(intent)
          } catch (error: ActivityNotFoundException) {
            promise.reject("E_INSTALL_UNAVAILABLE", "No Android installer is available.", error)
            return@launch
          } catch (error: SecurityException) {
            promise.reject("E_INSTALL_BLOCKED", "Android blocked the install request.", error)
            return@launch
          }

          promise.resolve(null)
        } catch (error: Exception) {
          promise.reject("E_INSTALL_FAILED", error.message ?: "Could not start the installer.", error)
        }
      }
    }

    /**
     * Android O+: whether this app may already hand APKs to the installer.
     * Pre-O the system's global unknown-sources setting applies and there
     * is nothing to query, so true is reported (the installer handles it).
     */
    Function("canInstallPackages") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
    }

    /**
     * Opens the per-app "Install unknown apps" system screen for THIS
     * package - the supported path when permission is missing. Never
     * attempts to bypass the setting.
     */
    Function("openInstallPermissionSettings") {
      val activity = appContext.currentActivity
      if (activity != null) {
        try {
          val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}"),
          )
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          activity.startActivity(intent)
        } catch (error: Exception) {
          Log.w(TAG, "Could not open install-permission settings: ${error.message}")
        }
      }
    }
  }

  /** Mutable state of the one active update download job. */
  private class ActiveDownload {
    @Volatile var connection: HttpURLConnection? = null
  }

  private val active = AtomicReference<ActiveDownload?>(null)
}
