package expo.modules.ompattention

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * One ongoing notification for what OMP is doing now, promoted to an Android 16
 * Live Update: the status-bar chip, the top of the shade and the lock screen
 * (HyperOS, ColorOS and MagicOS draw promoted notifications in their islands).
 * A session waiting for an answer takes it first ("Approve · bash · npm test");
 * otherwise the newest running session, with a running clock in the chip.
 * Fed by `running` frames (`/events?live=1`) and the approval and turn-end frames
 * the service already gets; withdrawn once nothing runs or waits.
 */
object LiveActivity {
  const val CHANNEL_LIVE = "live"
  private const val NOTIFICATION_ID = 7398
  /** A turn whose end never arrived (a stream gap the replay did not cover) stops showing after this. */
  private const val STALE_MS = 2 * 60 * 60 * 1000L

  private data class Entry(
    val machine: Machine,
    val sessionId: String,
    val title: String,
    /** When the turn started: the chip's clock counts from here. */
    val since: Long,
    /** The waiting question's text, while one is open; its key, to clear it on `resolved`. */
    val asking: String? = null,
    val askingKey: String? = null,
    val askingIsApproval: Boolean = false,
    val running: Boolean = false,
    val runKey: String? = null,
  )

  private val entries = ConcurrentHashMap<String, Entry>()
  private val lock = Any()

  private fun entryKey(machineId: String, sessionId: String) = "$machineId|$sessionId"

  fun ensureChannel(context: Context, name: String, detail: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    // Default importance, no sound: a promoted notification must be above MIN, and it updates often.
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_LIVE, name, NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = detail
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      },
    )
  }

  /** Fold one frame of [machine]'s stream into what is showing, and redraw. */
  fun onFrame(context: Context, machine: Machine, frame: AttentionFrame) {
    synchronized(lock) {
      val key = entryKey(machine.id, frame.sessionId)
      val current = entries[key]
      val time = if (frame.time > 0) frame.time else System.currentTimeMillis()
      when (frame.kind) {
        "running" -> entries[key] = (current ?: Entry(machine, frame.sessionId, frame.sessionTitle, time))
          .copy(title = frame.sessionTitle.ifEmpty { current?.title ?: "" }, since = time, running = true, runKey = frame.key)
        "approval", "question" -> entries[key] = (current ?: Entry(machine, frame.sessionId, frame.sessionTitle, time))
          .copy(asking = frame.text, askingKey = frame.key, askingIsApproval = frame.kind == "approval")
        "resolved" -> when {
          current == null -> {}
          current.runKey == frame.key -> entries.remove(key)
          current.askingKey == frame.key ->
            if (current.running) entries[key] = current.copy(asking = null, askingKey = null) else entries.remove(key)
        }
        "done", "failed" -> if (current != null && (current.runKey == null || current.runKey == frame.key)) entries.remove(key)
        else -> return
      }
      render(context)
    }
  }

  /** A machine's stream (re)connected: its replay states afresh what runs and waits there. */
  fun resetMachine(context: Context, machineId: String) {
    synchronized(lock) {
      if (entries.keys.removeIf { it.startsWith("$machineId|") }) render(context)
    }
  }

  /** Notifications were turned off or the machine removed: withdraw everything. */
  fun clear(context: Context) {
    synchronized(lock) {
      entries.clear()
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
  }

  /** Whether Android lets this app's notifications be promoted (Android 16 QPR1+); false where there is no such thing. */
  fun canPromote(context: Context): Boolean =
    Build.VERSION.SDK_INT >= 36 && runCatching { NotificationManagerCompat.from(context).canPostPromotedNotifications() }.getOrDefault(false)

  /** The system page where the user allows Live Updates for this app; false when the phone has none. */
  fun openPromotionSettings(context: Context): Boolean {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
      .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT < 36 || intent.resolveActivity(context.packageManager) == null) return false
    context.startActivity(intent)
    return true
  }

  private fun render(context: Context) {
    val now = System.currentTimeMillis()
    entries.entries.removeIf { now - it.value.since > STALE_MS }
    val manager = NotificationManagerCompat.from(context)
    if (entries.isEmpty() || !Notifier.canPost(context)) {
      manager.cancel(NOTIFICATION_ID)
      return
    }
    val all = entries.values
    val shown = all.filter { it.asking != null }.minByOrNull { it.since } ?: all.maxBy { it.since }
    val others = all.size - 1
    val title = shown.title.ifEmpty { Notifier.text(context, "common.session", "Session") }
    val where = shown.machine.name
    val builder = NotificationCompat.Builder(context, CHANNEL_LIVE)
      .setSmallIcon(R.drawable.omp_notification)
      .setContentTitle(title)
      .setContentIntent(Notifier.openIntent(context, shown.machine.id, shown.sessionId, NOTIFICATION_ID))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setRequestPromotedOngoing(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setTimeoutAfter(STALE_MS)
      .setSubText(if (others > 0) Notifier.text(context, "live.more", "{name} · {count} more", "name" to where, "count" to others) else where)
    if (shown.asking != null) {
      val headline = if (shown.askingIsApproval) Notifier.text(context, "live.approve", "Approve") else Notifier.text(context, "live.answer", "Answer")
      val detail = shown.asking.ifEmpty { headline }
      builder
        .setContentText("$headline · $detail")
        .setStyle(NotificationCompat.BigTextStyle().bigText("$headline · $detail"))
        .setShortCriticalText(headline)
        .setCategory(NotificationCompat.CATEGORY_REMINDER)
        .setShowWhen(false)
    } else {
      val working = Notifier.text(context, "live.working", "Working")
      builder
        .setContentText(working)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setWhen(shown.since)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setStyle(NotificationCompat.ProgressStyle().setProgressIndeterminate(true))
    }
    @Suppress("MissingPermission")
    manager.notify(NOTIFICATION_ID, builder.build())
  }
}
