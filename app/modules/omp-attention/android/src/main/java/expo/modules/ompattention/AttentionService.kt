package expo.modules.ompattention

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Foreground service holding one Server-Sent Events connection per paired
 * computer to its daemon's `/events`, over the tailnet. Each frame becomes a
 * system notification unless the user is looking at that session.
 */
class AttentionService : Service() {
  /** One machine's stream, as it was when the worker started. */
  private class Worker(val machine: Machine) {
    lateinit var thread: Thread
    @Volatile var connection: HttpURLConnection? = null
    /**
     * Set once by [stop]. The thread's interrupt flag is not enough: the HTTP
     * stack swallows it, and a stopped worker reconnecting would keep a
     * stream the user no longer wants.
     */
    @Volatile var stopped = false
    /** Holds a pending kick: the wait before the next attempt ends as soon as one is offered. */
    private val wake = LinkedBlockingQueue<Boolean>(1)

    /** Stop for good, and drop the connection so a blocked read ends now. */
    fun stop() {
      stopped = true
      wake.offer(true)
      thread.interrupt()
      connection?.disconnect()
    }

    /**
     * The network changed: retry now instead of after the backoff, and when
     * [drop], abandon the current connection (it is bound to the old network
     * and would only notice after the read timeout).
     */
    fun kick(drop: Boolean) {
      wake.offer(true)
      if (drop) connection?.disconnect()
    }

    /** Wait up to [ms] before the next attempt; returns true when a kick cut it short. */
    fun pause(ms: Long): Boolean {
      val kicked = wake.poll(ms, TimeUnit.MILLISECONDS) != null
      wake.clear()
      return kicked
    }
  }

  private val workers = ConcurrentHashMap<String, Worker>()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var stopping = false
  @Volatile private var network: Network? = null
  private var networkSeen = false

  /** Reconnect every stream when the phone's default network comes up or changes. */
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(available: Network) {
      val previous = network
      network = available
      // Registration reports the current network at once: that is not a change.
      if (!networkSeen) {
        networkSeen = true
        return
      }
      val changed = previous != available
      workers.values.forEach { it.kick(drop = changed) }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    Notifier.ensureChannels(this)
    goForeground()
    try {
      getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(networkCallback)
    } catch (_: Exception) {
      // No network callback: the streams still reconnect on their own backoff.
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Refused as a foreground service: goForeground already stopped it.
    if (!goForeground()) return START_NOT_STICKY
    if (!AttentionState.enabled(this) || AttentionState.machines(this).isEmpty()) {
      stopping = true
      stopSelf()
      return START_NOT_STICKY
    }
    reconcile()
    return START_STICKY
  }

  /**
   * Android 15+ calls this when a time-limited type (dataSync, 6 hours per day) runs
   * out. The service runs as specialUse there, which has no limit, so this is a guard:
   * stop cleanly instead of being killed for overstaying. The streams resume the next
   * time the app or the boot receiver starts the service.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopping = true
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    stopping = true
    runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(networkCallback) }
    workers.values.forEach { it.stop() }
    workers.clear()
    connected.clear()
    AttentionState.seen.clear()
    super.onDestroy()
  }

  /** Returns false, having stopped the service, when the system refuses the foreground start. */
  private fun goForeground(): Boolean {
    val notification = Notifier.serviceNotification(this, connected.size, AttentionState.machines(this).size)
    // Android 15 caps dataSync at 6 hours per day and forbids starting it from
    // BOOT_COMPLETED; specialUse (API 34+) has neither restriction. Below 14 there
    // is no such cap and dataSync is the honest type.
    val type = when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      else -> 0
    }
    return try {
      ServiceCompat.startForeground(this, SERVICE_NOTIFICATION_ID, notification, type)
      true
    } catch (_: Exception) {
      // ForegroundServiceStartNotAllowedException and friends: never crash the app
      // over a notification.
      stopping = true
      stopSelf()
      false
    }
  }

  private fun refreshServiceNotification() {
    main.post { if (!stopping) goForeground() }
  }

  /**
   * Start a worker for each followed machine; stop the workers of removed
   * machines and restart those whose address or token changed.
   */
  private fun reconcile() {
    val machines = AttentionState.machines(this).associateBy { it.id }
    for ((id, worker) in workers) {
      val machine = machines[id]
      if (machine != null && worker.machine.copy(name = machine.name) == machine) continue
      worker.stop()
      workers.remove(id)
      connected.remove(id)
    }
    // The machine count may have changed even when no stream did.
    refreshServiceNotification()
    for (machine in machines.values) {
      if (workers[machine.id]?.thread?.isAlive == true) continue
      val worker = Worker(machine)
      worker.thread = Thread({ follow(worker) }, "omp-events-${machine.id}")
      workers[machine.id] = worker
      worker.thread.start()
    }
  }

  /** Keep the stream open, reconnecting with capped backoff, until the worker is stopped. */
  private fun follow(worker: Worker) {
    val machine = worker.machine
    var delayMs = 1_000L
    while (!stopping && !worker.stopped) {
      var reached = false
      try {
        reached = stream(worker)
      } catch (_: InterruptedException) {
        return
      } catch (_: Exception) {
        // Unreachable computer, phone offline, daemon restarting: retry below.
      }
      // Stopped: its replacement owns the machine's connected mark now.
      if (worker.stopped) return
      if (connected.remove(machine.id)) refreshServiceNotification()
      if (reached) delayMs = 1_000L
      try {
        if (worker.pause(delayMs)) delayMs = 1_000L else delayMs = (delayMs * 2).coerceAtMost(60_000L)
      } catch (_: InterruptedException) {
        return
      }
    }
  }

  /** One connection: returns true when the stream opened (so the backoff starts over). */
  private fun stream(worker: Worker): Boolean {
    val machine = worker.machine
    val base = machine.url.trimEnd('/')
    val url = URL("$base/events?token=" + URLEncoder.encode(machine.token, "UTF-8"))
    val connection = url.openConnection() as HttpURLConnection
    worker.connection = connection
    // Stopped while this connection was made: stop() saw no connection to drop.
    if (worker.stopped) return false
    connection.connectTimeout = 10_000
    // The daemon sends a comment every 25 s; silence beyond this means a dead link.
    connection.readTimeout = 70_000
    connection.setRequestProperty("Accept", "text/event-stream")
    connection.useCaches = false
    try {
      if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
      if (connected.add(machine.id)) refreshServiceNotification()
      return BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use { reader ->
        val data = StringBuilder()
        var event = ""
        while (!worker.stopped) {
          val line = reader.readLine() ?: return true
          when {
            line.isEmpty() -> {
              // Only unnamed events carry frames; `event: live` marks the end of the replay.
              if (data.isNotEmpty() && event.isEmpty()) deliver(machine, data.toString())
              data.setLength(0)
              event = ""
            }
            line.startsWith(":") -> Unit
            line.startsWith("event:") -> event = line.removePrefix("event:").trim()
            line.startsWith("data:") -> {
              if (data.isNotEmpty()) data.append('\n')
              data.append(line.removePrefix("data:").trimStart())
            }
          }
        }
        true
      }
    } finally {
      worker.connection = null
      connection.disconnect()
    }
  }

  private fun deliver(machine: Machine, data: String) {
    val frame = AttentionFrame.parse(data) ?: return
    val seenKey = "${machine.id}|${frame.sessionId}|${frame.key}"
    if (frame.kind == "resolved") {
      AttentionState.seen.remove(seenKey)
      Notifier.cancel(this, machine.id, frame.sessionId, frame.key)
      AttentionState.onFrame?.let { listener -> main.post { listener(machine, frame) } }
      return
    }
    // A reconnect replays what is still open; it was shown already.
    if (frame.kind == "approval" || frame.kind == "question") {
      if (!AttentionState.seen.add(seenKey)) return
    }
    if (AttentionState.isOnScreen(machine.id, frame.sessionId)) return
    val visible = AttentionState.appVisible
    Notifier.post(this, machine, frame, quiet = visible)
    if (visible) {
      val listener = AttentionState.onFrame
      if (listener != null) main.post { listener(machine, frame) }
    }
  }

  companion object {
    private const val SERVICE_NOTIFICATION_ID = 7397

    /** Machines whose event stream is connected now. */
    private val connected: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, AttentionService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, AttentionService::class.java))
    }
  }
}
