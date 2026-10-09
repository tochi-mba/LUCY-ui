<script setup lang="ts">
import { computed } from "vue";
import { type Item, toolResultOf } from "../protocol/items";

const props = defineProps<{ item: Item }>();
const step = computed(() => toolResultOf(props.item.content));
const failed = computed(() => step.value.status === "failed" || step.value.error !== "");
const duration = computed(() => {
  const ms = step.value.duration_ms;
  if (ms === null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
});
</script>

<template>
  <details class="item item-tool" data-kind="tool_result" :data-status="step.status">
    <summary>
      <span class="tool-dot" :class="{ failed }" aria-hidden="true" />
      <code class="tool-op">{{ step.operation }}</code>
      <span class="tool-note">{{ step.note || step.summary }}</span>
      <span v-if="duration" class="tool-time">{{ duration }}</span>
    </summary>
    <p v-if="step.summary" class="tool-summary">{{ step.summary }}</p>
    <p v-if="step.error" class="tool-error">{{ step.error }}</p>
    <p v-if="!step.summary && !step.error" class="tool-summary">This step reported nothing beyond its status.</p>
  </details>
</template>
