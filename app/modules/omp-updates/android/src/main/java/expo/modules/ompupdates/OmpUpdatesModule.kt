package expo.modules.ompupdates

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest

class OmpUpdatesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OmpUpdates")

    AsyncFunction("verifyApk") { expectedSha256: String ->
      val context = requireNotNull(appContext.reactContext)
      val apk = File(context.cacheDir, "omp-update.apk")
      val digest = MessageDigest.getInstance("SHA-256")
      apk.inputStream().buffered().use { input ->
        val buffer = ByteArray(64 * 1024)
        var count = input.read(buffer)
        while (count != -1) {
          digest.update(buffer, 0, count)
          count = input.read(buffer)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) } == expectedSha256
    }

    AsyncFunction("installApk") {
      val activity = requireNotNull(appContext.currentActivity)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
        false
      } else {
        val apk = File(activity.cacheDir, "omp-update.apk")
        check(apk.isFile)
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.FileSystemFileProvider", apk)
        activity.startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        )
        true
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openInstallSettings") {
      val activity = requireNotNull(appContext.currentActivity)
      activity.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts("package", activity.packageName, null))
      )
    }.runOnQueue(Queues.MAIN)
  }
}
