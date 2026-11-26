package expo.modules.ompupdates

import android.app.DownloadManager
import android.content.Context
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
  private val downloadLock = Any()

  override fun definition() = ModuleDefinition {
    Name("OmpUpdates")

    AsyncFunction("startDownload") { url: String, sha256: String ->
      synchronized(downloadLock) {
        val context = requireNotNull(appContext.reactContext)
        val source = Uri.parse(url)
        require(source.scheme == "https" && source.host == "github.com")
        require(sha256.matches(Regex("[a-fA-F0-9]{64}")))
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val prefs = context.getSharedPreferences("apk-download", Context.MODE_PRIVATE)
        val id = prefs.getLong("id", -1)
        if (prefs.getString("sha256", null) == sha256) {
          if (prefs.getBoolean("cached", false) && File(context.cacheDir, "omp-update.apk").isFile) {
            return@AsyncFunction
          }
          manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
            if (cursor.moveToFirst() &&
              cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) != DownloadManager.STATUS_FAILED) {
              return@AsyncFunction
            }
          }
        }
        if (id != -1L) manager.remove(id)
        val destination = File(requireNotNull(context.getExternalFilesDir(null)), "omp-update-$sha256.apk")
        if (destination.exists()) check(destination.delete())
        val request = DownloadManager.Request(source)
          .setTitle("OMP")
          .setMimeType("application/vnd.android.package-archive")
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
          .setAllowedOverMetered(true)
          .setAllowedOverRoaming(true)
          .setDestinationUri(Uri.fromFile(destination))
        val nextId = manager.enqueue(request)
        if (!prefs.edit().putLong("id", nextId).putString("sha256", sha256).putBoolean("cached", false).commit()) {
          manager.remove(nextId)
          error("Could not save download")
        }
      }
    }

    AsyncFunction("downloadStatus") { sha256: String ->
      synchronized(downloadLock) {
        val context = requireNotNull(appContext.reactContext)
        val prefs = context.getSharedPreferences("apk-download", Context.MODE_PRIVATE)
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        if (prefs.getString("sha256", null) != sha256) {
          return@AsyncFunction mapOf("kind" to "missing")
        }
        if (prefs.getBoolean("cached", false) && File(context.cacheDir, "omp-update.apk").isFile) {
          return@AsyncFunction mapOf("kind" to "complete")
        }
        val id = prefs.getLong("id", -1)
        manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
          if (!cursor.moveToFirst()) return@AsyncFunction mapOf("kind" to "missing")
          when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
            DownloadManager.STATUS_SUCCESSFUL -> {
              // External storage is not trusted. Copy to private cache, then verify
              // that copy before installation or removing the resumable source.
              val pending = File(context.cacheDir, "omp-update.apk.tmp")
              try {
                manager.openDownloadedFile(id).use { descriptor ->
                  android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    pending.outputStream().use { output -> input.copyTo(output) }
                  }
                }
                check(pending.renameTo(File(context.cacheDir, "omp-update.apk")))
              } finally {
                pending.delete()
              }
              mapOf("kind" to "complete")
            }
            DownloadManager.STATUS_FAILED -> mapOf("kind" to "failed")
            else -> {
              val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
              val written = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
              mapOf("kind" to "downloading", "percent" to if (total > 0) (100.0 * written / total).toInt().coerceIn(0, 100) else null)
            }
          }
        }
      }
    }

    AsyncFunction("discardDownload") {
      synchronized(downloadLock) {
        val context = requireNotNull(appContext.reactContext)
        val prefs = context.getSharedPreferences("apk-download", Context.MODE_PRIVATE)
        val id = prefs.getLong("id", -1)
        if (id != -1L) (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).remove(id)
        prefs.edit().clear().commit()
        File(context.cacheDir, "omp-update.apk").delete()
      }
    }

    AsyncFunction("verifyApk") { expectedSha256: String ->
      synchronized(downloadLock) {
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
        val matches = digest.digest().joinToString("") { "%02x".format(it) } == expectedSha256
        val prefs = context.getSharedPreferences("apk-download", Context.MODE_PRIVATE)
        if (matches && prefs.getString("sha256", null) == expectedSha256) {
          // Persist the private copy's state before removing the system task.
          // After a crash, restoration can reuse and reverify the private APK.
          check(prefs.edit().putBoolean("cached", true).commit())
          val id = prefs.getLong("id", -1)
          if (id != -1L) {
            (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).remove(id)
          }
        }
        matches
      }
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
