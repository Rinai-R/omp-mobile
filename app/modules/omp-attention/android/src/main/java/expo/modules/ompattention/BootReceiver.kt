package expo.modules.ompattention

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Resumes the event streams after a reboot when the user had notifications on.
 * Android 15 forbids starting a dataSync foreground service from BOOT_COMPLETED;
 * the service runs as specialUse from Android 14 on, which may start here.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    if (AttentionState.enabled(context) && AttentionState.machines(context).isNotEmpty()) {
      AttentionService.start(context)
    }
  }
}
