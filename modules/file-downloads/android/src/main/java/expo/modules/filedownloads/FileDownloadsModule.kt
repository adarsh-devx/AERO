package expo.modules.filedownloads

import android.util.Log
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
import java.util.concurrent.ConcurrentHashMap

/**
 * FileDownloads: foreground file download + file management for Aero's
 * offline downloads.
 *
 * One focused module — no background queues, no DownloadManager: the
 * product only promises reliable foreground downloads (documented).
 *
 * Design notes:
 * - Streams the response body straight to a `.part` file (never holds the
 *   audio in memory), then atomically renames it to the final name on
 *   success — a partial file can never masquerade as a completed one.
 * - Progress is emitted as throttled events (>= 150ms apart), so the JS
 *   side never updates React state per byte.
 * - cancelDownload() flips a flag and disconnects the connection; the
 *   active job then deletes its own `.part` file and rejects with
 *   E_DOWNLOAD_CANCELLED, leaving no entry, no file and no state behind.
 * - All files live in `filesDir/aero/downloads` (app-private, survives
 *   app restarts and Metro restarts; cleared only by uninstall or an
 *   explicit remove).
 */
class FileDownloadsModule : Module() {
  companion object {
    private const val TAG = "FileDownloads"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 20_000
    private const val PROGRESS_INTERVAL_MS = 150L
    private const val SUBDIRECTORY = "aero/downloads"
  }

  /** Mutable state of one active download job. */
  private class ActiveDownload {
    @Volatile var cancelled = false
    @Volatile var connection: HttpURLConnection? = null
  }

  private val active = ConcurrentHashMap<String, ActiveDownload>()

  private fun requireDownloadsDir(): File {
    val context = appContext.reactContext
      ?: throw IllegalStateException("React context is unavailable; cannot access the downloads directory.")
    val dir = File(context.filesDir, SUBDIRECTORY)
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return dir
  }

  private fun emitProgress(id: String, bytesWritten: Long, totalBytes: Long) {
    sendEvent(
      "downloadProgress",
      mapOf(
        "id" to id,
        "bytesWritten" to bytesWritten,
        "totalBytes" to totalBytes,
      ),
    )
  }

  override fun definition() = ModuleDefinition {
    Name("FileDownloads")

    Events("downloadProgress")

    /** Absolute path of the downloads directory (created on first use). */
    Function("getDownloadsDirectory") {
      requireDownloadsDir().absolutePath
    }

    /**
     * Streams `url` to `<downloadsDir>/<fileName>` while replaying the
     * headers the stream was resolved with (the googlevideo CDN rejects
     * requests whose User-Agent does not match the resolving client).
     * Resolves with the absolute path and final size; rejects with
     * E_DOWNLOAD_CANCELLED / E_DOWNLOAD_FAILED / E_DOWNLOAD_IN_PROGRESS.
     */
    AsyncFunction("downloadAsync") { id: String, url: String, fileName: String, headersJson: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        val dir = try {
          requireDownloadsDir()
        } catch (error: Exception) {
          promise.reject("E_STORAGE_UNAVAILABLE", error.message ?: "Storage unavailable.", error)
          return@launch
        }

        if (active.containsKey(id)) {
          promise.reject("E_DOWNLOAD_IN_PROGRESS", "A download for this track is already running.", null)
          return@launch
        }

        val job = ActiveDownload()
        active[id] = job
        val target = File(dir, fileName)
        val partial = File(dir, "$fileName.part")

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
            Log.w(TAG, "Ignoring malformed download headers: ${error.message}")
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
                if (job.cancelled) {
                  throw IOException("Download cancelled")
                }
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                written += read
                val now = System.currentTimeMillis()
                if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
                  lastEmitAt = now
                  emitProgress(id, written, total)
                }
              }
              out.flush()
            }
          }

          if (job.cancelled) {
            throw IOException("Download cancelled")
          }

          // Final progress tick so the UI can reach 100% without waiting
          // for the store round-trip.
          emitProgress(id, written, if (total > 0) total else written)

          if (target.exists()) target.delete()
          if (!partial.renameTo(target)) {
            throw IOException("Could not finalise the downloaded file.")
          }

          promise.resolve(
            mapOf(
              "filePath" to target.absolutePath,
              "sizeBytes" to target.length(),
            ),
          )
        } catch (error: Throwable) {
          // Partial file cleanup on failure AND cancellation: a failed or
          // cancelled download must leave nothing behind.
          runCatching { partial.delete() }
          if (job.cancelled) {
            promise.reject("E_DOWNLOAD_CANCELLED", "Download cancelled.", null)
          } else {
            promise.reject("E_DOWNLOAD_FAILED", error.message ?: "Download failed.", error)
          }
        } finally {
          active.remove(id)
          runCatching { job.connection?.disconnect() }
        }
      }
    }

    /**
     * Cancels the active download with the given id. Idempotent: unknown
     * ids are ignored. The running job observes the flag/disconnect,
     * deletes its partial file and rejects with E_DOWNLOAD_CANCELLED.
     */
    Function("cancelDownload") { id: String ->
      val job = active[id]
      if (job != null) {
        job.cancelled = true
        try {
          job.connection?.disconnect()
        } catch (error: Exception) {
          Log.w(TAG, "disconnect during cancel failed: ${error.message}")
        }
      }
    }

    /**
     * Deletes a file inside the downloads directory. Paths outside the
     * directory are refused (resolved false). A missing file resolves
     * true: deletion is a cleanup, and nothing to clean is success.
     */
    AsyncFunction("deleteFileAsync") { path: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val dir = requireDownloadsDir().canonicalFile
          val file = File(path).canonicalFile
          if (file.parentFile != dir) {
            promise.resolve(false)
            return@launch
          }
          val deleted = if (file.exists()) file.delete() else true
          promise.resolve(deleted)
        } catch (error: Exception) {
          Log.w(TAG, "deleteFileAsync failed for $path: ${error.message}")
          promise.resolve(false)
        }
      }
    }

    /** Whether the given file currently exists (startup reconciliation). */
    AsyncFunction("fileExistsAsync") { path: String, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          promise.resolve(File(path).exists())
        } catch (error: Exception) {
          promise.resolve(false)
        }
      }
    }

    /**
     * Lists every file in the downloads directory with its last-modified
     * time — one lightweight pass for startup reconciliation (missing
     * entries, orphaned files and stale `.part` leftovers).
     */
    AsyncFunction("listFilesAsync") { promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val files = requireDownloadsDir()
            .listFiles()
            ?.map { file ->
              mapOf(
                "filePath" to file.absolutePath,
                "lastModified" to file.lastModified(),
              )
            }
            ?: emptyList()
          promise.resolve(files)
        } catch (error: Exception) {
          promise.reject("E_LIST_FAILED", error.message ?: "Could not list downloads.", error)
        }
      }
    }
  }
}
