package expo.modules.localmedia

import expo.modules.interfaces.permissions.Permissions
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Local media module: exposes Android MediaStore audio metadata to JS.
 *
 * Deliberately minimal — discovery only. No playback, no file-path
 * exposure (identifiers only), no network access.
 */
class LocalMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LocalMedia")

    Function("hasAudioPermission") { ->
      val permissions = requirePermissionsManager()
      permissions.hasGrantedPermissions(audioPermissionForDevice())
    }

    AsyncFunction("requestAudioPermissionAsync") { promise: Promise ->
      val permissions = requirePermissionsManager()
      val permission = audioPermissionForDevice()
      permissions.askForPermissions(
        PermissionsResponseListener { _ ->
          promise.resolve(permissions.hasGrantedPermissions(permission))
        },
        permission,
      )
    }

    AsyncFunction("getAudioAsync") { promise: Promise ->
      val permissions = requirePermissionsManager()
      val permission = audioPermissionForDevice()
      if (!permissions.hasGrantedPermissions(permission)) {
        promise.reject(LocalMediaErrors.PERMISSION_DENIED, LocalMediaErrors.PERMISSION_DENIED_MESSAGE, null)
        return@AsyncFunction
      }
      try {
        promise.resolve(queryAudioCollection())
      } catch (cause: Exception) {
        promise.reject(LocalMediaErrors.QUERY_FAILED, "MediaStore audio query failed: ${cause.localizedMessage}", cause)
      }
    }
  }

  private fun requirePermissionsManager(): Permissions {
    return appContext?.permissions
      ?: throw LocalMediaErrors.permissionsUnavailable()
  }

  private fun audioPermissionForDevice(): String {
    val context = appContext?.reactContext ?: throw LocalMediaErrors.contextUnavailable()
    return LocalMediaQueries.audioPermissionFor(context.applicationContext)
  }

  private fun queryAudioCollection(): List<Map<String, Any?>> {
    val context = appContext?.reactContext ?: throw LocalMediaErrors.contextUnavailable()
    return LocalMediaQueries.queryAudio(context.applicationContext)
  }
}

