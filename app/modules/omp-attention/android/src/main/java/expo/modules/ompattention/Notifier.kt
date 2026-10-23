package expo.modules.ompattention

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * System notifications for attention frames. Approvals and questions go on a
 * high-importance channel, so Android shows them heads-up over other apps;
 * finished turns on a default one; the service's own notification on a low one.
 */
object Notifier {
  const val CHANNEL_ATTENTION = "approvals"
  const val CHANNEL_TURNS = "turns"
  const val CHANNEL_SERVICE = "service"
  const val EXTRA_MACHINE = "omp.attention.machine"
  const val EXTRA_SESSION = "omp.attention.session"
  /** OMP's brand pink (accentB), the accent of expanded notifications. */
  private const val BRAND = 0xFFD42EA3.toInt()

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ATTENTION, "Approvals & questions", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "An OMP session is waiting for you"
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_TURNS, "Finished turns", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "An OMP session finished or failed"
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_SERVICE, "Background connection", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Keeps OMP connected to your computers"
        setShowBadge(false)
      },
    )
  }

  /** The ongoing notification the foreground service must show. */
  fun serviceNotification(context: Context, connected: Int, total: Int) =
    NotificationCompat.Builder(context, CHANNEL_SERVICE)
      .setSmallIcon(R.drawable.omp_notification)
      .setContentTitle(if (total == 1) "Watching 1 machine" else "Watching $total machines")
      .setContentText(if (connected == total) "Connected" else "Connected to $connected of $total")
      .setContentIntent(openIntent(context, null, null, 0))
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

  /**
   * Post (or replace) the notification for one frame.
   * @param quiet - the app is open: list it without sound or a heads-up (the in-app banner shows it).
   */
  fun post(context: Context, machine: Machine, frame: AttentionFrame, quiet: Boolean) {
    if (!canPost(context)) return
    val title = frame.sessionTitle.ifEmpty { "Session" }
    val (channel, headline) = when (frame.kind) {
      "approval" -> CHANNEL_ATTENTION to "Approval needed"
      "question" -> CHANNEL_ATTENTION to "Question for you"
      "done" -> CHANNEL_TURNS to "Turn finished"
      "failed" -> CHANNEL_TURNS to "Turn failed"
      else -> return
    }
    val where = machine.name.ifEmpty { frame.machine }
    val detail = frame.text.ifEmpty { where }
    val id = notificationId(machine.id, frame.sessionId, frame.key)
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.drawable.omp_notification)
      .setContentTitle("$headline · $title")
      .setContentText(detail)
      .setSubText(where)
      .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
      .setContentIntent(openIntent(context, machine.id, frame.sessionId, id))
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setColor(BRAND)
      .setWhen(if (frame.time > 0) frame.time else System.currentTimeMillis())
      .setShowWhen(true)
      .setPriority(if (channel == CHANNEL_ATTENTION) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(
        if (channel == CHANNEL_ATTENTION) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS,
      )
      .setGroup("omp.${machine.id}.${frame.sessionId}")
    if (quiet) builder.setSilent(true) else builder.setDefaults(NotificationCompat.DEFAULT_ALL)
    @Suppress("MissingPermission")
    NotificationManagerCompat.from(context).notify(id, builder.build())
  }

  /** Withdraw the approval/question notification a `resolved` frame settles. */
  fun cancel(context: Context, machineId: String, sessionId: String, key: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(machineId, sessionId, key))
  }

  /** Withdraw every notification of a session the user has just opened. */
  fun cancelSession(context: Context, machineId: String, sessionId: String) {
    val manager = context.getSystemService(NotificationManager::class.java)
    val group = "omp.$machineId.$sessionId"
    manager.activeNotifications.filter { it.notification.group == group }.forEach { manager.cancel(it.id) }
  }

  fun canPost(context: Context): Boolean =
    (
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
      ) && NotificationManagerCompat.from(context).areNotificationsEnabled()

  private fun notificationId(machineId: String, sessionId: String, key: String) =
    "$machineId|$sessionId|$key".hashCode()

  private fun openIntent(context: Context, machineId: String?, sessionId: String?, requestCode: Int): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (machineId != null && sessionId != null) {
      launch.putExtra(EXTRA_MACHINE, machineId).putExtra(EXTRA_SESSION, sessionId)
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
