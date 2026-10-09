/**
 * Server-sent events, parsed by hand.
 *
 * The browser's EventSource cannot send an Authorization header, and the hub authenticates the
 * stream with a bearer token like every other route. So the UI reads the stream with fetch and
 * parses it here. The headed script in scripts/ imports this same file, so the two clients cannot
 * disagree about what a frame is. It has no imports on purpose: Node runs it with type stripping.
 *
 * The grammar is the WHATWG one, cut down to the fields the hub sends. A frame without an `id:`
 * is reported without one, because the hub's heartbeat deliberately carries no id and a client
 * that moved its resume cursor on one would skip events.
 */

/** What one blank-line-terminated block of the stream said. */
export interface SseFrame {
  /** The `id:` field, present only when the frame carried one. */
  id?: string;
  /** The `event:` field, or `message` when there was none. */
  event: string;
  /** Every `data:` line, joined with newlines. */
  data: string;
}

/** Turns chunks of a stream, split anywhere, into whole frames. */
export class SseParser {
  #pending = "";
  #data: string[] = [];
  #event = "";
  #id: string | undefined;

  /** Feed one chunk; get back every frame it completed, in order. */
  push(chunk: string): SseFrame[] {
    let text = this.#pending + chunk;
    // A chunk can end between the \r and the \n of one line ending. Hold a trailing \r back until
    // the next chunk says whether it was a whole line ending or half of one.
    let held = "";
    if (text.endsWith("\r")) {
      held = "\r";
      text = text.slice(0, -1);
    }
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    this.#pending = lines.pop()! + held;
    const frames: SseFrame[] = [];
    for (const line of lines) {
      const frame = this.#line(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  #line(line: string): SseFrame | null {
    if (line === "") return this.#dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.#data.push(value);
    else if (field === "event") this.#event = value;
    else if (field === "id") this.#id = value;
    return null;
  }

  #dispatch(): SseFrame | null {
    const data = this.#data;
    const event = this.#event || "message";
    const id = this.#id;
    this.#data = [];
    this.#event = "";
    this.#id = undefined;
    if (data.length === 0) return null;
    const frame: SseFrame = { event, data: data.join("\n") };
    if (id !== undefined) frame.id = id;
    return frame;
  }
}
