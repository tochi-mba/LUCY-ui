<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown, settledLength } from "../markdown/render";
import type { Block } from "../stores/conversation";

/**
 * A block still arriving. Re-rendering markdown on every delta would parse the whole text
 * hundreds of times in a long answer, so the shown text trails the stream by one animation frame;
 * and each frame re-renders only the tail after the last settled paragraph, never the whole
 * answer (a 5 KB answer costs 4 ms to parse, so a long one would miss the frame budget).
 */
const props = defineProps<{ block: Block }>();

const shown = ref(props.block.text);
let frame: number | null = null;

watch(
  () => props.block.text,
  () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      shown.value = props.block.text;
    });
  },
);

const settled = computed(() => shown.value.slice(0, settledLength(shown.value)));
// Recomputed only when a paragraph completes: the string is equal frame to frame until then.
const settledHtml = computed(() => renderMarkdown(settled.value));
const tailHtml = computed(() => renderMarkdown(shown.value.slice(settled.value.length)));

onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame);
});
</script>

<template>
  <div class="item item-assistant" data-kind="streaming">
    <p class="item-who">Lucy</p>
    <!-- Safe to inject: renderMarkdown escapes raw HTML and refuses unsafe link schemes. -->
    <div class="markdown">
      <div class="markdown-part" data-part="settled" v-html="settledHtml" />
      <div class="markdown-part" data-part="tail" v-html="tailHtml" />
    </div>
    <p v-if="block.open" class="item-live" aria-hidden="true">●</p>
  </div>
</template>
