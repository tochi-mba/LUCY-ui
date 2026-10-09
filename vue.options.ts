import type { Options } from "@vitejs/plugin-vue";

/**
 * How Vue compiles this app's templates, shared by the build and the tests so the two cannot
 * disagree. The face is a native custom element from agent-robot-avatar; Vue has to be told that
 * the tag is not one of its components, or it warns and renders nothing.
 */
export const vueOptions: Options = {
  template: {
    compilerOptions: {
      isCustomElement: (tag) => tag === "agent-robot-avatar",
    },
  },
};
