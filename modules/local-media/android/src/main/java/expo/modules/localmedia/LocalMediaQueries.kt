package expo.modules.localmedia

import android.content.Context
import android.os.Build
import android.provider.MediaStore

/**
 * MediaStore query helpers. Android-version handling is centralised
 * here: Android 13+ (API 33) uses the granular READ_MEDIA_AUDIO
 * permission, older versions use READ_EXTERNAL_STORAGE; the
 * IS_TRIMMED / IS_DRM / IS_PENDING columns only exist from API 29.
 */
internal object LocalMediaQueries {

  fun audioPermissionFor(@Suppress("UNUSED_PARAMETER") context: Context): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      android.Manifest.permission.READ_MEDIA_AUDIO
    } else {
      android.Manifest.permission.READ_EXTERNAL_STORAGE
    }

  /**
   * Queries MediaStore.Audio.Media for playable audio entries with a
   * real title and a non-zero duration. Results are ordered by _ID for
   * determinism. Only stable identifiers and metadata are returned —
   * no filesystem paths.
   */
  fun queryAudio(context: Context): List<Map<String, Any?>> {
    val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
    } else {
      MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    }

    val projection = arrayOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.DURATION,
    )

    // Base filters valid on every supported API level.
    val selection = buildString {
      append("${MediaStore.Audio.Media.DURATION} > 0")
      append(" AND ${MediaStore.Audio.Media.TITLE} IS NOT NULL")
      append(" AND ${MediaStore.Audio.Media.TITLE} != ''")
    }
    // API 29+ column filters, appended only where the columns exist.
    val selectionApi29Plus = " AND ${MediaStore.Audio.Media.IS_TRASHED} = 0" +
      " AND ${MediaStore.Audio.Media.IS_PENDING} = 0"

    val effectiveSelection =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) selection + selectionApi29Plus else selection

    val tracks = mutableListOf<Map<String, Any?>>()

    context.contentResolver.query(
      collection,
      projection,
      effectiveSelection,
      null,
      "${MediaStore.Audio.Media._ID} ASC",
    )?.use { cursor ->
      val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
      val titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
      val artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
      val albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
      val durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)

      while (cursor.moveToNext()) {
        val id = cursor.getLong(idColumn)

        tracks.add(
          mapOf(
            "trackId" to id.toString(),
            "title" to cursor.getString(titleColumn),
            // MediaStore's literal "<unknown>" placeholder is normalised
            // to null so the provider-agnostic Track stays clean.
            "artist" to cursor.getString(artistColumn)?.takeIf { it != MediaStore.UNKNOWN_STRING },
            "album" to cursor.getString(albumColumn)?.takeIf { it != MediaStore.UNKNOWN_STRING },
            "durationMs" to cursor.getLong(durationColumn),
          ),
        )
      }
    }

    return tracks
  }
}

