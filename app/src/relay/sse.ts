/** Server-Sent Events, as the daemon's `/events` stream sends them; pure, for node:test. */

/** Parses Server-Sent Events text as it arrives; calls `onFrame` with each unnamed event's data. */
export function sseParser(onFrame: (data: string) => void): (text: string) => void {
  let buffer = "";
  let data: string[] = [];
  let event = "";
  return (text) => {
    buffer += text;
    for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      if (line === "") {
        // Only unnamed events carry frames; `event: live` marks the end of the replay.
        if (data.length > 0 && event === "") onFrame(data.join("\n"));
        data = [];
        event = "";
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }
  };
}
