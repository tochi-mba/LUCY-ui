import { describe, expect, it } from "vitest";

/** The text of a finished outcome; a test that reads it expects the turn to be over. */
function textOf(outcome: { done: boolean; text?: string }): string {
  expect(outcome.done).toBe(true);
  return outcome.text ?? "";
}

import {
  configPath,
  OK,
  parseArgs,
  REFUSED,
  ReplyCollector,
  sessionBody,
  tokenFromToml,
  UNREACHABLE,
  USAGE,
  watchLine,
} from "../../scripts/lib/headed-core.mjs";

describe("finding the saved sign-in", () => {
  it("prefers LUCY_CONFIG, then XDG, then APPDATA, then the home directory", () => {
    expect(configPath({ LUCY_CONFIG: "C:/own.toml" }, "/home/t")).toBe("C:/own.toml");
    expect(configPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/t")).toBe("/xdg/lucy/config.toml");
    expect(configPath({ APPDATA: "C:/Users/t/AppData/Roaming" }, "/home/t")).toBe(
      "C:/Users/t/AppData/Roaming\\lucy\\config.toml",
    );
    expect(configPath({}, "/home/t")).toBe("/home/t/.config/lucy/config.toml");
  });

  it("reads only the token key from the TOML, and no commented or empty one", () => {
    expect(tokenFromToml('url = "http://x"\ntoken = "tok-123"\nmode = "family"')).toBe("tok-123");
    expect(tokenFromToml('token = ""')).toBeNull();
    expect(tokenFromToml('# token = "old"\nurl = "x"')).toBeNull();
    expect(tokenFromToml("")).toBeNull();
  });
});

describe("the command line", () => {
  it("parses each command and refuses the rest", () => {
    expect(parseArgs(["new", "smoke", "test"])).toEqual({ command: "new", topic: "smoke test" });
    expect(parseArgs(["new"])).toEqual({ command: "new", topic: "" });
    expect(parseArgs(["say", "ses_1", "hello", "there"])).toEqual({
      command: "say",
      sessionId: "ses_1",
      text: "hello there",
    });
    expect(parseArgs(["say", "ses_1"])).toMatchObject({ error: expect.stringContaining("say") });
    expect(parseArgs(["watch", "ses_1"])).toEqual({ command: "watch", sessionId: "ses_1" });
    expect(parseArgs(["watch"])).toMatchObject({ error: expect.stringContaining("watch") });
    expect(parseArgs(["dance"])).toMatchObject({ error: expect.stringContaining("usage") });
  });

  it("keeps the CLI's exit vocabulary", () => {
    expect([OK, REFUSED, USAGE, UNREACHABLE]).toEqual([0, 1, 2, 3]);
  });
});

describe("collecting a reply", () => {
  const delta = (text: string) => ({ type: "lucy.content.text.delta", turn_id: "t1", data: { delta: text } });

  it("joins the words and ends with the turn", () => {
    const collector = new ReplyCollector("t1");
    expect(collector.feed(delta("Hel"))).toEqual({ done: false });
    collector.feed(delta("lo"));
    expect(collector.feed({ type: "lucy.turn.completed", turn_id: "t1", data: {} })).toEqual({
      done: true,
      code: OK,
      text: "Hello",
    });
  });

  it("ignores another turn's ending and events without a reading", () => {
    const collector = new ReplyCollector("t1");
    expect(collector.feed({ type: "lucy.turn.completed", turn_id: "t0", data: {} })).toEqual({ done: false });
    expect(collector.feed({ type: "lucy.stream.heartbeat" })).toEqual({ done: false });
    expect(collector.feed({ type: "lucy.turn.started", turn_id: "t1", data: {} })).toEqual({ done: false });
  });

  it("surfaces a card as a notice and keeps waiting", () => {
    const collector = new ReplyCollector("t1");
    collector.feed({ type: "lucy.approval.requested", turn_id: "t1", data: { description: "Play it?" } });
    expect(collector.notices).toEqual(["[Lucy is asking for approval in the UI: Play it?]"]);
    collector.feed({ type: "lucy.approval.requested", data: { tool: "music.play" } });
    expect(collector.notices[1]).toContain("music.play");
    collector.feed({ type: "lucy.approval.requested", data: {} });
    expect(collector.notices[2]).toContain("a card");
  });

  it("a failed turn reports the error item's words", () => {
    const collector = new ReplyCollector("t1");
    collector.feed({
      type: "lucy.content.item.added",
      turn_id: "t1",
      data: { type: "error", content: { code: "x", detail: "went wrong" } },
    });
    collector.feed({
      type: "lucy.content.item.added",
      turn_id: "t1",
      data: { type: "message", content: "not an error" },
    });
    collector.feed({ type: "lucy.content.item.added", turn_id: "t1", data: { type: "error", content: "unreadable" } });
    expect(collector.feed({ type: "lucy.turn.failed", turn_id: "t1", data: {} })).toEqual({
      done: true,
      code: REFUSED,
      text: "went wrong",
    });
    const silent = new ReplyCollector("t2");
    expect(textOf(silent.feed({ type: "lucy.turn.failed", turn_id: "t2", data: {} }))).toContain("could not finish");
    const errorless = new ReplyCollector("t3");
    collector.feed({
      type: "lucy.content.item.added",
      turn_id: "t3",
      data: { type: "error", content: { code: "only_code" } },
    });
    void errorless;
  });

  it("a cancelled or superseded turn says it was stopped", () => {
    for (const type of ["lucy.turn.cancelled", "lucy.turn.superseded"]) {
      const collector = new ReplyCollector("t1");
      expect(collector.feed({ type, turn_id: "t1", data: {} })).toMatchObject({ done: true, code: REFUSED });
    }
  });

  it("an error item that names nothing falls back to the plain sentence", () => {
    const collector = new ReplyCollector("t1");
    collector.feed({ type: "lucy.content.item.added", turn_id: "t1", data: { type: "error", content: {} } });
    expect(textOf(collector.feed({ type: "lucy.turn.failed", turn_id: "t1", data: {} }))).toContain("could not finish");
  });

  it("an error item that names only a code reports the code", () => {
    const collector = new ReplyCollector("t1");
    collector.feed({
      type: "lucy.content.item.added",
      turn_id: "t1",
      data: { type: "error", content: { code: "bad" } },
    });
    expect(textOf(collector.feed({ type: "lucy.turn.failed", turn_id: "t1", data: {} }))).toBe("bad");
  });
});

describe("watch lines", () => {
  it("writes one line per event, clipped", () => {
    expect(watchLine({ sequence_number: 4, type: "lucy.turn.started", turn_id: "t1", data: {} })).toBe(
      "4 lucy.turn.started t1 {}",
    );
    expect(watchLine({ type: "lucy.stream.heartbeat" })).toBe("- lucy.stream.heartbeat {}");
    expect(watchLine({ type: "lucy.stream.snapshot", data: { big: "x".repeat(400) } })).toHaveLength(
      "- lucy.stream.snapshot ".length + 160,
    );
  });
});

describe("starting a headed conversation", () => {
  it("titles it with the prefix and passes LUCY_MODEL when set", () => {
    expect(sessionBody("smoke", {}, "Claude Code · ")).toEqual({ title: "Claude Code · smoke" });
    expect(sessionBody("", { LUCY_MODEL: "clyde:haiku" }, "Claude Code · ")).toEqual({
      title: "Claude Code · conversation",
      model: "clyde:haiku",
    });
  });
});
