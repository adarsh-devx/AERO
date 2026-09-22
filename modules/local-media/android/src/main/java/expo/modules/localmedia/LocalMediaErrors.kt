package expo.modules.localmedia

import expo.modules.kotlin.exception.CodedException

/**
 * Error codes and helpers for the LocalMedia module.
 * Codes are stable strings so the JS side can branch on them
 * (e.g. permission-denied vs a genuine query failure).
 */
internal object LocalMediaErrors {
  const val PERMISSION_DENIED = "E_LOCAL_MEDIA_PERMISSION_DENIED"
  const val PERMISSION_DENIED_MESSAGE =
    "Media access permission is not granted. The local library cannot be read."
  const val QUERY_FAILED = "E_LOCAL_MEDIA_QUERY_FAILED"
  const val UNAVAILABLE = "E_LOCAL_MEDIA_UNAVAILABLE"

  fun permissionsUnavailable(): CodedException =
    CodedException(
      UNAVAILABLE,
      "Permissions manager is unavailable. Is the permissions Expo module properly linked?",
      null,
    )

  fun contextUnavailable(): CodedException =
    CodedException(UNAVAILABLE, "Application context is unavailable.", null)
}
