// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { FaceDriver } from "../../src/face/driver";
import LucyFace from "../../src/face/LucyFace.vue";
import type { Mood } from "../../src/face/moods";

function fakeDriver() {
  const moods: Mood[] = [];
  let destroyed = 0;
  const driver: FaceDriver = {
    set: (mood) => void moods.push(mood),
    destroy: () => {
      destroyed += 1;
    },
  };
  return { driver, moods, destroyed: () => destroyed };
}

describe("LucyFace", () => {
  it("registers the element, drives the first mood, and follows changes", async () => {
    const fake = fakeDriver();
    let registered = 0;
    const wrapper = mount(LucyFace, {
      props: {
        mood: "idle" as Mood,
        register: () => {
          registered += 1;
          return Promise.resolve();
        },
        driverFor: () => fake.driver,
      },
    });
    await flushPromises();
    expect(registered).toBe(1);
    expect(fake.moods).toEqual(["idle"]);
    await wrapper.setProps({ mood: "thinking" });
    expect(fake.moods).toEqual(["idle", "thinking"]);
    expect(wrapper.find(".face").attributes("data-mood")).toBe("thinking");
    expect(wrapper.find("[role=status]").text()).toContain("thinking");
    wrapper.unmount();
    expect(fake.destroyed()).toBe(1);
  });

  it("never builds a driver for a face unmounted while the element was loading", async () => {
    const fake = fakeDriver();
    let release: () => void = () => {};
    const wrapper = mount(LucyFace, {
      props: {
        mood: "idle" as Mood,
        register: () => new Promise<void>((resolve) => (release = resolve)),
        driverFor: () => fake.driver,
      },
    });
    wrapper.unmount();
    release();
    await flushPromises();
    expect(fake.moods).toEqual([]);
  });
});
