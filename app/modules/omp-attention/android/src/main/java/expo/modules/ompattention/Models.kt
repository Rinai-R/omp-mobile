package expo.modules.ompattention

import org.json.JSONObject

/** One frame of a computer's `/events` stream (daemon/src/attention.mjs). */
data class AttentionFrame(
  /** approval, question, resolved, done or failed. */
  val kind: String,
  /** The extension request id; `run:<n>` for done/failed. A `resolved` frame repeats the request's key. */
  val key: String,
  val sessionId: String,
  val sessionTitle: String,
  /** The computer's hostname. */
  val machine: String,
  val text: String,
  val time: Long,
  /** `running` only: the session's todo list progress, when it has one. */
  val plan: Plan? = null,
) {
  companion object {
    /** @return the frame, or null for malformed data (never thrown into the stream loop). */
    fun parse(data: String): AttentionFrame? = try {
      val json = JSONObject(data)
      AttentionFrame(
        kind = json.getString("kind"),
        key = json.getString("key"),
        sessionId = json.getString("sessionId"),
        sessionTitle = json.optString("sessionTitle"),
        machine = json.optString("machine"),
        text = json.optString("text"),
        time = json.optLong("time"),
        plan = json.optJSONObject("plan")?.let(Plan::parse),
      )
    } catch (_: Exception) {
      null
    }
  }
}

/**
 * A paired computer whose events the service follows: its daemon base URL and
 * bearer token, or [relay]: reached through a relay, whose events the app's JS
 * receives and hands to [AttentionService.deliver] (the service only keeps the process alive).
 */
data class Machine(
  val id: String,
  val name: String,
  val url: String,
  val token: String,
  val relay: Boolean = false,
) {
  fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("url", url).put("token", token).put("relay", relay)

  companion object {
    fun fromJson(json: JSONObject): Machine = Machine(
      id = json.getString("id"),
      name = json.optString("name"),
      url = json.getString("url"),
      token = json.getString("token"),
      relay = json.optBoolean("relay", false),
    )
  }
}

/** OMP's todo list progress (daemon `planOf`): tasks done, all tasks, tasks per phase. */
data class Plan(val done: Int, val total: Int, val phases: List<Int>) {
  companion object {
    fun parse(json: JSONObject): Plan? {
      val phases = json.optJSONArray("phases") ?: return null
      val counts = List(phases.length()) { phases.optInt(it) }.filter { it > 0 }
      val total = json.optInt("total")
      if (total <= 0 || counts.isEmpty()) return null
      return Plan(json.optInt("done").coerceIn(0, total), total, counts)
    }
  }
}
