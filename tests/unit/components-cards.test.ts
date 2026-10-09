// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ApprovalCard from "../../src/components/ApprovalCard.vue";
import ConnectionRequired from "../../src/components/ConnectionRequired.vue";
import type { ApprovalRequest } from "../../src/protocol/items";
import type { Card } from "../../src/stores/conversation";

function card(partial: Partial<Card> = {}, request: Partial<ApprovalRequest> = {}): Card {
  return {
    item: {
      id: "itm",
      seq: 1,
      type: "approval_request",
      role: "assistant",
      content: {},
      turn_id: "t",
      agent_id: null,
      created_at: 0,
    },
    request: {
      approval_id: "apr",
      tool: "music.play",
      description: "Play what music.find found?",
      permission: "music.playback",
      arguments: { track: "$found" },
      limit: null,
      steps: [],
      ...request,
    },
    status: "pending",
    record: null,
    ...partial,
  };
}

describe("ApprovalCard", () => {
  it("shows the hub's question, the permission and the arguments", () => {
    const wrapper = mount(ApprovalCard, { props: { card: card() } });
    expect(wrapper.text()).toContain("Play what music.find found?");
    expect(wrapper.text()).toContain("music.playback");
    expect(wrapper.find(".card-args pre").text()).toContain("$found");
  });

  it("answers once, for the session, and always", async () => {
    const wrapper = mount(ApprovalCard, { props: { card: card() } });
    const buttons = wrapper.findAll(".card-actions button");
    await buttons[0]!.trigger("click");
    await buttons[1]!.trigger("click");
    await buttons[3]!.trigger("click");
    expect(wrapper.emitted("answer")).toEqual([
      [{ approved: true, lifetime: "once", only: undefined, instruction: "" }],
      [{ approved: true, lifetime: "session", only: undefined, instruction: "" }],
      [{ approved: true, lifetime: "account", only: undefined, instruction: "" }],
    ]);
  });

  it("denies only on the second press, carrying the reason", async () => {
    const wrapper = mount(ApprovalCard, { props: { card: card() } });
    await wrapper.find("textarea").setValue("too loud");
    const deny = wrapper.findAll(".card-actions button").at(-1)!;
    await deny.trigger("click");
    expect(wrapper.emitted("answer")).toBeUndefined();
    expect(deny.text()).toContain("Confirm");
    await deny.trigger("click");
    expect(wrapper.emitted("answer")).toEqual([[{ approved: false, instruction: "too loud" }]]);
  });

  it("limits a standing yes to the ticked values, and leaves a one-time yes unlimited", async () => {
    const wrapper = mount(ApprovalCard, {
      props: { card: card({}, { limit: { field: "repository", values: ["a/b", "c/d"] } }) },
    });
    await wrapper.findAll(".card-limit input").at(0)!.setValue(true);
    const buttons = wrapper.findAll(".card-actions button");
    await buttons[2]!.trigger("click");
    await buttons[0]!.trigger("click");
    const emitted = wrapper.emitted("answer")!;
    expect(emitted[0]).toEqual([{ approved: true, lifetime: "profile", only: ["a/b"], instruction: "" }]);
    expect(emitted[1]).toEqual([{ approved: true, lifetime: "once", only: undefined, instruction: "" }]);
  });

  it("unticking returns a value to the unlimited yes", async () => {
    const wrapper = mount(ApprovalCard, {
      props: { card: card({}, { limit: { field: "repository", values: ["a/b"] } }) },
    });
    const box = wrapper.find(".card-limit input");
    await box.setValue(true);
    await box.setValue(false);
    await wrapper.findAll(".card-actions button").at(3)!.trigger("click");
    expect(wrapper.emitted("answer")![0]).toEqual([
      { approved: true, lifetime: "account", only: undefined, instruction: "" },
    ]);
    expect(wrapper.text()).toContain("Nothing ticked");
  });

  it("lists the calls of a many-call card instead of raw arguments", () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        card: card(
          {},
          {
            steps: [
              { step: "s1", operation: "agents.spawn", arguments: {}, description: "researcher" },
              { step: "s2", operation: "agents.spawn", arguments: {}, description: "reviewer" },
            ],
          },
        ),
      },
    });
    expect(wrapper.text()).toContain("2 calls on this one card");
    expect(wrapper.findAll(".card-steps li")).toHaveLength(2);
    expect(wrapper.find(".card-args").exists()).toBe(false);
  });

  it("disables everything while the answer is in flight", () => {
    const wrapper = mount(ApprovalCard, { props: { card: card({ status: "answering" }) } });
    expect(wrapper.text()).toContain("Sending your answer");
    for (const button of wrapper.findAll(".card-actions button")) expect(button.attributes("disabled")).toBeDefined();
  });

  it("shows the outcome once decided, with the lifetime and the person's words", () => {
    const granted = mount(ApprovalCard, {
      props: { card: card({ status: "granted", record: { status: "granted", lifetime: "session", instruction: "" } }) },
    });
    expect(granted.text()).toContain("Allowed");
    expect(granted.text()).toContain("for this conversation");
    const denied = mount(ApprovalCard, {
      props: {
        card: card({ status: "denied", record: { status: "denied", lifetime: "once", instruction: "too loud" } }),
      },
    });
    expect(denied.text()).toContain("Denied");
    expect(denied.text()).toContain("too loud");
    expect(mount(ApprovalCard, { props: { card: card({ status: "expired" }) } }).text()).toContain("expired");
    expect(mount(ApprovalCard, { props: { card: card({ status: "closed" }) } }).text()).toContain("Already decided");
  });

  it("hides an empty argument object rather than showing {}", () => {
    const wrapper = mount(ApprovalCard, { props: { card: card({}, { arguments: {} }) } });
    expect(wrapper.find(".card-args").exists()).toBe(false);
  });
});

describe("ConnectionRequired", () => {
  it("shows the hub's sentence, the scopes, and a safe connect link", () => {
    const wrapper = mount(ConnectionRequired, {
      props: {
        prompt: {
          service: "spotify",
          scopes: ["playback"],
          connectUrl: "https://hub/connect?t=1",
          message: "Open the link.",
        },
      },
    });
    expect(wrapper.text()).toContain("Open the link.");
    expect(wrapper.text()).toContain("playback");
    const link = wrapper.find("a");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
    expect(link.attributes("target")).toBe("_blank");
  });

  it("still says something with no message and no link", () => {
    const wrapper = mount(ConnectionRequired, {
      props: { prompt: { service: "spotify", scopes: [], connectUrl: "", message: "" } },
    });
    expect(wrapper.text()).toContain("spotify is not connected");
    expect(wrapper.find("a").exists()).toBe(false);
  });
});
