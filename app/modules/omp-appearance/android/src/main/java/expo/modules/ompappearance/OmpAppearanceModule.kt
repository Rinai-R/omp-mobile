package expo.modules.ompappearance

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hands the app's light/dark choice to Android, which keeps it for the app.
 * The launch screen is drawn by the system before the app runs; from Android 12
 * it uses this stored mode, so a phone in light mode opening an app set to dark
 * starts on the dark launch screen instead of flashing the light one.
 */
class OmpAppearanceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OmpAppearance")

    /** "light", "dark", or "system" to follow the phone again. */
    Function("setNightMode") { mode: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function
      val context = appContext.reactContext ?: return@Function
      val manager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager ?: return@Function
      val night = when (mode) {
        "light" -> UiModeManager.MODE_NIGHT_NO
        "dark" -> UiModeManager.MODE_NIGHT_YES
        else -> UiModeManager.MODE_NIGHT_AUTO
      }
      manager.setApplicationNightMode(night)
    }
  }
}
