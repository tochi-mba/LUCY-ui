<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import type { Block } from "../stores/conversation";
import MarkdownBlock from "./MarkdownBlock.vue";

/**
 * A block still arriving. Re-rendering markdown on every delta would parse the whole text
 * hundreds of times in a long answer, so the shown text trails the stream by one animation frame.
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

onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame);
});
</script>

<template>
  <div class="item item-assistant" data-kind="streaming">
    <p class="item-who">Lucy</p>
    <MarkdownBlock :text="shown" />
    <p v-if="block.open" class="item-live" aria-hidden="true">●</p>
  </div>
</template>
