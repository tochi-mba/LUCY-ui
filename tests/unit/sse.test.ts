import { describe, expect, it } from "vitest";
import { SseParser } from "../../src/protocol/sse";

describe("the SSE parser", () => {
  it("reads one whole frame", () => {
    const parser = new SseParser();
    expect(parser.push("id: 4\nevent: lucy.turn.started\ndata: {}\n\n")).toEqual([
      { id: "4", event: "lucy.turn.started", data: "{}" },
    ]);
  });

  it("reassembles a frame split anywhere, including inside a CRLF", () => {
    const parser = new SseParser();
    expect(parser.push("id: 7\r")).toEqual([]);
    expect(parser.push('\nevent: a\r\ndata: {"x":')).toEqual([]);
    expect(parser.push("1}\r\n\r\n")).toEqual([{ id: "7", event: "a", data: '{"x":1}' }]);
  });

  it("joins several data lines with newlines", () => {
    const parser = new SseParser();
    expect(parser.push("data: one\ndata: two\n\n")).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("drops comment lines and frames with no data, as the opening frame is", () => {
    const parser = new SseParser();
    expect(parser.push("retry: 3000\n: lucy\n\n: ping\n\n")).toEqual([]);
  });

  it("reports a frame without an id without one, so a heartbeat cannot move a cursor", () => {
    const parser = new SseParser();
    const [frame] = parser.push("event: lucy.stream.heartbeat\ndata: {}\n\n");
    expect(frame).not.toHaveProperty("id");
  });

  it("keeps a later id out of an earlier frame", () => {
    const parser = new SseParser();
    const frames = parser.push("data: first\n\nid: 9\ndata: second\n\n");
    expect(frames).toEqual([
      { event: "message", data: "first" },
      { id: "9", event: "message", data: "second" },
    ]);
  });

  it("reads a field with no colon as a name with an empty value", () => {
    const parser = new SseParser();
    expect(parser.push("data\n\n")).toEqual([{ event: "message", data: "" }]);
  });

  it("strips only the first space after the colon", () => {
    const parser = new SseParser();
    expect(parser.push("data:  spaced\n\n")).toEqual([{ event: "message", data: " spaced" }]);
  });

  it("emits two frames fed in one chunk in order", () => {
    const parser = new SseParser();
    expect(parser.push("data: a\n\ndata: b\n\n").map((frame) => frame.data)).toEqual(["a", "b"]);
  });

  it("ignores unknown fields", () => {
    const parser = new SseParser();
    expect(parser.push("other: x\ndata: kept\n\n")).toEqual([{ event: "message", data: "kept" }]);
  });
});
