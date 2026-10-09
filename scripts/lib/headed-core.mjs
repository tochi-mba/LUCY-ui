/**
 * The decisions behind `npm run headed`: where the CLI's saved token lives, what the arguments
 * mean, and when a followed turn is over. The wrapper in scripts/headed.mjs only does I/O.
 */

/** The CLI's exit codes, kept aligned with `lucy` (docs/cli.md): refused is 1, unreachable is 3. */
export const OK = 0;
export const REFUSED = 1;
export const USAGE = 2;
export const UNREACHABLE = 3;

/** Where `lucy setup` saved its configuration, by the same rules as the CLI. */
export function configPath(env, home) {
  if (env.LUCY_CONFIG) return env.LUCY_CONFIG;
  if (env.XDG_CONFIG_HOME) return `${env.XDG_CONFIG_HOME}/lucy/config.toml`;
  if (env.APPDATA && env.OS_NAME !== "posix") return `${env.APPDATA}\\lucy\\config.toml`;
  return `${home}/.config/lucy/config.toml`;
}

/** The one key this script reads from the CLI's TOML. Never printed, never written back. */
export function tokenFromToml(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*token\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (match) return match[1] || null;
  }
  return null;
}

/**
 * What was asked of the command line.
 * @returns {{command: "new", topic: string} | {command: "say", sessionId: string, text: string}
 *   | {command: "watch", sessionId: string} | {error: string}}
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "new") {
    return { command: "new", topic: rest.join(" ").trim() };
  }
  if (command === "say") {
    const [sessionId, ...words] = rest;
    const text = words.join(" ").trim();
    if (!sessionId || !text) return { error: "usage: headed say <session_id> <text>" };
    return { command: "say", sessionId, text };
  }
  if (command === "watch") {
    if (!rest[0]) return { error: "usage: headed watch <session_id>" };
    return { command: "watch", sessionId: rest[0] };
  }
  return {
    error: "usage: headed new <topic> | headed say <session_id> <text> | headed watch <session_id>",
  };
}

/**
 * Reads one turn off the event stream, the way `lucy talk` does: collect the text, surface an
 * approval card as a notice (the person answers it in the UI), and stop at the turn's ending.
 */
export class ReplyCollector {
  /** @param {string} turnId */
  constructor(turnId) {
    this.turnId = turnId;
    this.parts = [];
    this.notices = [];
    this.failure = "";
  }

  /**
   * @param {{type?: string, turn_id?: string, data?: Record<string, unknown>}} event
   * @returns {{done: false} | {done: true, code: number, text: string}}
   */
  feed(event) {
    const forThisTurn = event.turn_id === undefined || event.turn_id === this.turnId;
    const data = event.data ?? {};
    if (event.type === "lucy.content.text.delta" && typeof data.delta === "string") {
      this.parts.push(data.delta);
      return { done: false };
    }
    if (event.type === "lucy.approval.requested" && forThisTurn) {
      this.notices.push(`[Lucy is asking for approval in the UI: ${data.description ?? data.tool ?? "a card"}]`);
      return { done: false };
    }
    if (event.type === "lucy.content.item.added" && forThisTurn) {
      const content = data.content;
      if (data.type === "error" && content && typeof content === "object") {
        this.failure = String(content.detail ?? content.code ?? "");
      }
      return { done: false };
    }
    if (event.turn_id !== this.turnId) return { done: false };
    if (event.type === "lucy.turn.completed") return { done: true, code: OK, text: this.text() };
    if (event.type === "lucy.turn.failed") {
      return { done: true, code: REFUSED, text: this.failure || "Lucy could not finish that turn." };
    }
    if (event.type === "lucy.turn.cancelled" || event.type === "lucy.turn.superseded") {
      return { done: true, code: REFUSED, text: "The turn was stopped before it finished." };
    }
    return { done: false };
  }

  text() {
    return this.parts.join("");
  }
}

/** One stream event as one line for `headed watch`. */
export function watchLine(event) {
  const turn = event.turn_id ? ` ${event.turn_id}` : "";
  const data = JSON.stringify(event.data ?? {});
  const clipped = data.length > 160 ? `${data.slice(0, 157)}...` : data;
  return `${event.sequence_number ?? "-"} ${event.type}${turn} ${clipped}`;
}
