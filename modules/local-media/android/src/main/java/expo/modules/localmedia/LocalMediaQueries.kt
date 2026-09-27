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
      // Stable identity for album grouping above the display title: two
      // different albums can share a name, ALBUM_ID cannot. Long is
      // stringified at the boundary (same reason as _ID above).
      MediaStore.Audio.Media.ALBUM_ID,
      // Real tag metadata MediaStore already carries: track/disc position
      // (TRACK), release year (YEAR) and composer credit (COMPOSER). All
      // standard columns since API 1; read leniently below so a vendor ROM
      // missing one degrades to "unknown", never to a failed library scan.
      MediaStore.Audio.Media.TRACK,
      MediaStore.Audio.Media.YEAR,
      MediaStore.Audio.Media.COMPOSER,
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
      val albumIdColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
      // Lenient for the enrichment columns: -1 (column absent on this ROM)
      // simply means "no value known", exactly like a 0/NULL cell.
      val trackColumn = cursor.getColumnIndex(MediaStore.Audio.Media.TRACK)
      val yearColumn = cursor.getColumnIndex(MediaStore.Audio.Media.YEAR)
      val composerColumn = cursor.getColumnIndex(MediaStore.Audio.Media.COMPOSER)

      while (cursor.moveToNext()) {
        val id = cursor.getLong(idColumn)

        // MediaStore TRACK: a plain track number, or — when the source
        // encoded disc info — disc * 1000 + track (the column's documented
        // packing convention). Decoded HERE so no MediaStore quirk ever
        // crosses the native boundary. Ambiguous plain values (< 1000) are
        // passed through verbatim as the track number; a disc number is
        // reported ONLY when the packing proves one.
        val rawTrack = if (trackColumn >= 0) cursor.getInt(trackColumn) else 0
        val trackNumber: Int? = when {
          rawTrack <= 0 -> null
          rawTrack >= 1000 -> (rawTrack % 1000).takeIf { it > 0 }
          else -> rawTrack
        }
        val discNumber: Int? =
          if (rawTrack >= 1000) (rawTrack / 1000).takeIf { it > 0 } else null
        // YEAR is the file's release-year tag (0/absent = unknown, dropped).
        val releaseYear =
          if (yearColumn >= 0) cursor.getInt(yearColumn).takeIf { it in 1000..9999 } else null
        val composer =
          if (composerColumn >= 0) cursor.getString(composerColumn)?.takeIf {
            it != MediaStore.UNKNOWN_STRING && it.isNotBlank()
          } else null

        tracks.add(
          mapOf(
            "trackId" to id.toString(),
            "title" to cursor.getString(titleColumn),
            // MediaStore's literal "<unknown>" placeholder is normalised
            // to null so the provider-agnostic Track stays clean.
            "artist" to cursor.getString(artistColumn)?.takeIf { it != MediaStore.UNKNOWN_STRING },
            "album" to cursor.getString(albumColumn)?.takeIf { it != MediaStore.UNKNOWN_STRING },
            "durationMs" to cursor.getLong(durationColumn),
            // 0 means MediaStore has no album for this entry; surfaced as
            // "absent" rather than a fake id so grouping falls back cleanly.
            "albumId" to cursor.getLong(albumIdColumn).takeIf { it > 0 }?.toString(),
            "trackNumber" to trackNumber,
            "discNumber" to discNumber,
            "year" to releaseYear,
            "composer" to composer,
          ),
        )
      }
    }

    return tracks
  }
}

