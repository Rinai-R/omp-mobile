package expo.modules.ompattention

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

/** JS face of the attention service: machines, enabled flag, on-screen session, notification taps. */
class OmpAttentionModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  /** Start the service when it should run, stop it when it should not. */
  private fun sync() {
    if (AttentionState.enabled(context) && AttentionState.machines(context).isNotEmpty()) {
      AttentionService.start(context)
    } else {
      AttentionService.stop(context)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("OmpAttention")

    Events("onOpenSession", "onAttention")

    OnCreate {
      Notifier.ensureChannels(context)
      AttentionState.onOpen = { machine, session ->
        sendEvent("onOpenSession", bundleOf("machineId" to machine, "sessionId" to session))
      }
      AttentionState.onFrame = { machine, frame ->
        sendEvent(
          "onAttention",
          bundleOf(
            "machineId" to machine.id,
            "machineName" to machine.name.ifEmpty { frame.machine },
            "kind" to frame.kind,
            "key" to frame.key,
            "sessionId" to frame.sessionId,
            "sessionTitle" to frame.sessionTitle,
            "text" to frame.text,
            "time" to frame.time.toDouble(),
          ),
        )
      }
    }

    OnDestroy {
      AttentionState.onOpen = null
      AttentionState.onFrame = null
    }

    /** Machines to follow, as a JSON array of {id, name, url, token}; restarts the streams that changed. */
    Function("setMachines") { json: String ->
      val array = JSONArray(json)
      val machines = List(array.length()) { Machine.fromJson(array.getJSONObject(it)) }
      AttentionState.setMachines(context, machines)
      sync()
    }

    Function("setEnabled") { enabled: Boolean ->
      AttentionState.setEnabled(context, enabled)
      sync()
    }

    Function("isEnabled") { AttentionState.enabled(context) }

    /** The session now on screen ("" for none); clears its notifications. */
    Function("setOnScreen") { machineId: String, sessionId: String ->
      if (machineId.isEmpty() || sessionId.isEmpty()) {
        AttentionState.onScreen = null
      } else {
        AttentionState.onScreen = machineId to sessionId
        Notifier.cancelSession(context, machineId, sessionId)
      }
    }

    /** A notification tap JS has not handled yet (it may have launched the app), consumed once. */
    Function("takePendingOpen") {
      val pending = AttentionState.pendingOpen ?: return@Function null
      AttentionState.pendingOpen = null
      mapOf("machineId" to pending.first, "sessionId" to pending.second)
    }

    /** Whether the system lets this app post notifications at all (permission and app switch). */
    Function("notificationsAllowed") { Notifier.canPost(context) }

    /** Whether Android may stop the service to save battery. */
    Function("isBatteryRestricted") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      return@Function !power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Ask the user to exempt the app from battery optimization (keeps the streams alive). */
    Function("requestBatteryExemption") {
      @Suppress("BatteryLife")
      val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      listOf(request, list).any { intent ->
        try {
          context.startActivity(intent)
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }

    /** Open the system notification settings for this app. */
    Function("openNotificationSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}
