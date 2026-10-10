// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ErrorItem from "../../src/components/ErrorItem.vue";
import GenericItem from "../../src/components/GenericItem.vue";
import MarkdownBlock from "../../src/components/MarkdownBlock.vue";
import MessageItem from "../../src/components/MessageItem.vue";
import StreamingText from "../../src/components/StreamingText.vue";
import ToolResultItem from "../../src/components/ToolResultItem.vue";
import type { Item } from "../../src/protocol/items";

function item(partial: Partial<Item>): Item {
  return {
    id: "i",
    seq: 1,
    type: "message",
    role: "assistant",
    content: "",
    turn_id: null,
    agent_id: null,
    created_at: 0,
    ...partial,
  };
}

describe("MarkdownBlock", () => {
  it("renders markdown and keeps raw HTML inert", () => {
    const wrapper = mount(MarkdownBlock, { props: { text: "**bold** <script>x</script>" } });
    expect(wrapper.find("strong").exists()).toBe(true);
    expect(wrapper.find("script").exists()).toBe(false);
  });
});

describe("MessageItem", () => {
  it("labels the person's side with the speaker and keeps their text plain", () => {
    const wrapper = mount(MessageItem, {
      props: { item: item({ role: "user", content: "hi **there**" }), speaker: "Claude Code" },
    });
    expect(wrapper.text()).toContain("Claude Code");
    expect(wrapper.find("strong").exists()).toBe(false);
  });

  it("renders Lucy's side as markdown", () => {
    const wrapper = mount(MessageItem, { props: { item: item({ content: "hi **there**" }), speaker: "You" } });
    expect(wrapper.text()).toContain("Lucy");
    expect(wrapper.find("strong").exists()).toBe(true);
  });
});

describe("StreamingText", () => {
  it("shows the text and a live marker while open, catching up a frame later", async () => {
    const block = { key: "k", id: "b", kind: "text" as const, turnId: null, text: "Hel", open: true };
    const wrapper = mount(StreamingText, { props: { block } });
    expect(wrapper.text()).toContain("Hel");
    expect(wrapper.find(".item-live").exists()).toBe(true);
    block.text = "Hello";
    await wrapper.setProps({ block: { ...block } });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(wrapper.text()).toContain("Hello");
    block.open = false;
    await wrapper.setProps({ block: { ...block } });
    expect(wrapper.find(".item-live").exists()).toBe(false);
  });
});

describe("ToolResultItem", () => {
  it("shows the step, its note and its timing", () => {
    const wrapper = mount(ToolResultItem, {
      props: {
        item: item({
          type: "tool_result",
          content: { operation: "music.find", status: "ok", note: "Find it", summary: "1 track", duration_ms: 1500 },
        }),
      },
    });
    expect(wrapper.text()).toContain("music.find");
    expect(wrapper.text()).toContain("1.5 s");
    expect(wrapper.find(".tool-dot").classes()).not.toContain("failed");
  });

  it("marks a failed step and shows its error, and says when a step reported nothing", () => {
    const failed = mount(ToolResultItem, {
      props: {
        item: item({
          type: "tool_result",
          content: { operation: "x", status: "failed", error: "refused", duration_ms: 20 },
        }),
      },
    });
    expect(failed.find(".tool-dot").classes()).toContain("failed");
    expect(failed.text()).toContain("refused");
    expect(failed.text()).toContain("20 ms");
    const silent = mount(ToolResultItem, { props: { item: item({ type: "tool_result", content: {} }) } });
    expect(silent.text()).toContain("reported nothing");
  });
});

describe("ErrorItem and GenericItem", () => {
  it("speaks the error and its code", () => {
    const wrapper = mount(ErrorItem, {
      props: { item: item({ type: "error", content: { code: "bad_plan", detail: "refused" } }) },
    });
    expect(wrapper.text()).toContain("refused");
    expect(wrapper.text()).toContain("bad_plan");
    const empty = mount(ErrorItem, { props: { item: item({ type: "error", content: {} }) } });
    expect(empty.text()).toContain("could not finish");
  });

  it("shows an unknown kind as itself", () => {
    const wrapper = mount(GenericItem, {
      props: { item: item({ type: "compaction", role: "assistant", content: { covered: 4 } }) },
    });
    expect(wrapper.text()).toContain("compaction");
    expect(wrapper.find("pre").text()).toContain('"covered": 4');
  });
});

describe("StreamingText, in parts", () => {
  it("re-renders only the tail while a paragraph is arriving, and settles it when the paragraph ends", async () => {
    // The bug, named: every frame re-parsed the whole answer (4 ms for 5 KB), so a long answer
    // missed the frame budget while it streamed.
    const block = { key: "k", id: "b", kind: "text" as const, turnId: null, text: "First.\n\nSec", open: true };
    const wrapper = mount(StreamingText, { props: { block } });
    const settled = wrapper.find('[data-part="settled"]');
    expect(settled.text()).toBe("First.");
    expect(wrapper.find('[data-part="tail"]').text()).toBe("Sec");
    const before = settled.element.innerHTML;

    await wrapper.setProps({ block: { ...block, text: "First.\n\nSecond is longer" } });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(wrapper.find('[data-part="settled"]').element.innerHTML).toBe(before);
    expect(wrapper.find('[data-part="tail"]').text()).toBe("Second is longer");

    await wrapper.setProps({ block: { ...block, text: "First.\n\nSecond is done.\n\nThird" } });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(wrapper.find('[data-part="settled"]').text()).toContain("Second is done.");
    expect(wrapper.find('[data-part="tail"]').text()).toBe("Third");
  });
});
