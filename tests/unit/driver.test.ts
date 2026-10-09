import { describe, expect, it } from "vitest";
import { AvatarDriver, type AvatarElement, type Timers } from "../../src/face/driver";
import { MOODS } from "../../src/face/moods";

function build() {
  const calls: string[] = [];
  const face: AvatarElement = {
    play: (action) => void calls.push(`play:${action}`),
    reset: () => void calls.push("reset"),
    sleep: () => void calls.push("sleep"),
    wake: () => void calls.push("wake"),
    input: (active) => void calls.push(`input:${active}`),
    startWaiting: (options) => void calls.push(`wait:${options?.variant ?? "default"}`),
    stopWaiting: () => void calls.push("stopWaiting"),
  };
  const pending: (() => void)[] = [];
  const timers: Timers = {
    set: (callback) => {
      pending.push(callback);
      return pending.length - 1;
    },
    clear: () => void pending.splice(0),
  };
  const driver = new AvatarDriver(face, timers);
  return { driver, calls, fire: () => pending.shift()?.() };
}

describe("driving the face", () => {
  it("maps every mood to a call", () => {
    for (const mood of MOODS) {
      const { driver, calls, fire } = build();
      driver.set(mood);
      expect(calls.length).toBeGreaterThan(0);
      fire();
    }
  });

  it("enters and leaves the waiting loop", () => {
    const { driver, calls } = build();
    driver.set("thinking");
    driver.set("working");
    driver.set("idle");
    expect(calls).toEqual(["wait:default", "stopWaiting", "wait:wrap", "stopWaiting", "reset"]);
  });

  it("turns the attentive eyes off before any other mood", () => {
    const { driver, calls } = build();
    driver.set("speaking");
    driver.set("idle");
    expect(calls).toEqual(["input:true", "input:false", "reset"]);
  });

  it("wakes out of sleep on the way to the next mood", () => {
    const { driver, calls } = build();
    driver.set("asleep");
    driver.set("idle");
    expect(calls).toEqual(["sleep", "wake", "reset"]);
  });

  it("holds a short animation and then shows only the latest waiting mood", () => {
    const { driver, calls, fire } = build();
    driver.set("sent");
    driver.set("thinking");
    driver.set("speaking");
    expect(calls).toEqual(["play:send"]);
    fire();
    expect(calls).toEqual(["play:send", "input:true"]);
  });

  it("does nothing for the mood it is already showing", () => {
    const { driver, calls } = build();
    driver.set("idle");
    driver.set("idle");
    expect(calls).toEqual(["reset"]);
  });

  it("a hold with nothing waiting ends quietly", () => {
    const { driver, calls, fire } = build();
    driver.set("done");
    fire();
    expect(calls).toEqual(["play:success"]);
  });

  it("destroy clears a pending hold", () => {
    const { driver, fire, calls } = build();
    driver.set("failed");
    driver.set("idle");
    driver.destroy();
    fire();
    expect(calls).toEqual(["play:failure"]);
    driver.destroy();
  });

  it("lets a rejected animation promise die quietly", () => {
    const face: AvatarElement = {
      play: () => Promise.reject(new Error("cut short")),
      reset: () => {},
      sleep: () => {},
      wake: () => {},
      input: () => {},
      startWaiting: () => {},
      stopWaiting: () => {},
    };
    new AvatarDriver(face, { set: () => 0, clear: () => {} }).set("done");
  });
});
