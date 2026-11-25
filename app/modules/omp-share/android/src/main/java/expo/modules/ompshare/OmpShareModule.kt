package expo.modules.ompshare

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * The system share sheet for a file the app downloaded into its cache. The file
 * goes out as a content URI from expo-file-system's FileProvider (which serves
 * the cache directory), readable by the app the user picks.
 */
class OmpShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OmpShare")

    AsyncFunction("shareFile") { uri: String, mimeType: String, title: String ->
      val activity = requireNotNull(appContext.currentActivity)
      val parsed = Uri.parse(uri)
      require(parsed.scheme == "file") { "Not a file URI" }
      val file = File(requireNotNull(parsed.path))
      // Only what the app itself downloaded: a file under its cache directory.
      require(file.canonicalPath.startsWith(activity.cacheDir.canonicalPath + File.separator)) { "Not in the cache" }
      check(file.isFile) { "No such file" }
      val content = FileProvider.getUriForFile(activity, "${activity.packageName}.FileSystemFileProvider", file)
      val send = Intent(Intent.ACTION_SEND)
        .setType(mimeType.ifBlank { "application/octet-stream" })
        .putExtra(Intent.EXTRA_STREAM, content)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      // ClipData carries the read grant through the chooser to the app the user picks.
      send.clipData = ClipData.newRawUri(file.name, content)
      activity.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }.runOnQueue(Queues.MAIN)
  }
}
