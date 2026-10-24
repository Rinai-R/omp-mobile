package expo.modules.ompattention

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * State shared by the JS module, the service, and the boot receiver.
 *
 * Persisted (SharedPreferences): the machines to follow, whether
 * notifications are enabled, and the notification text in the app's language. In memory: whether the app is on screen, the
 * session it shows, a notification tap JS has not consumed yet, and the open
 * requests already notified (a reconnect replays them).
 */
object AttentionState {
  private const val PREFS = "omp.attention"
  private const val MACHINES = "machines"
  private const val ENABLED = "enabled"
  private const val STRINGS = "strings"

  /** True while the app's activity is resumed. */
  @Volatile var appVisible = false

  /** Machine id and session id currently on screen, or null. */
  @Volatile var onScreen: Pair<String, String>? = null

  /** A notification tap waiting for the JS side: machine id and session id. */
  @Volatile var pendingOpen: Pair<String, String>? = null

  /** Called on the main thread when a tap arrives while the app is running. */
  @Volatile var onOpen: ((machineId: String, sessionId: String) -> Unit)? = null

  /** Called on the main thread for a frame while the app is visible, so it can show its in-app banner. */
  @Volatile var onFrame: ((machine: Machine, frame: AttentionFrame) -> Unit)? = null

  /** `machine|session|key` of approvals and questions already shown; a replay of one is not news. */
  val seen: MutableSet<String> = ConcurrentHashMap.newKeySet()

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun machines(context: Context): List<Machine> {
    val raw = prefs(context).getString(MACHINES, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      List(array.length()) { Machine.fromJson(array.getJSONObject(it)) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun setMachines(context: Context, machines: List<Machine>) {
    val array = JSONArray()
    machines.forEach { array.put(it.toJson()) }
    prefs(context).edit().putString(MACHINES, array.toString()).apply()
  }

  fun enabled(context: Context): Boolean = prefs(context).getBoolean(ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(ENABLED, enabled).apply()
  }

  /** The notification text the app last sent (key → text), so the boot receiver posts in the user's language too. */
  fun strings(context: Context): JSONObject {
    val raw = prefs(context).getString(STRINGS, null) ?: return JSONObject()
    return try {
      JSONObject(raw)
    } catch (_: Exception) {
      JSONObject()
    }
  }

  fun setStrings(context: Context, json: String) {
    prefs(context).edit().putString(STRINGS, json).apply()
  }

  /** Whether the user is looking at this session right now, so no notification is needed. */
  fun isOnScreen(machineId: String, sessionId: String): Boolean =
    appVisible && onScreen == (machineId to sessionId)
}
