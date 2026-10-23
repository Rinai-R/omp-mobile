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
      )
    } catch (_: Exception) {
      null
    }
  }
}

/** A paired computer whose events the service follows: its daemon base URL and bearer token. */
data class Machine(
  val id: String,
  val name: String,
  val url: String,
  val token: String,
) {
  fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("url", url).put("token", token)

  companion object {
    fun fromJson(json: JSONObject): Machine = Machine(
      id = json.getString("id"),
      name = json.optString("name"),
      url = json.getString("url"),
      token = json.getString("token"),
    )
  }
}
