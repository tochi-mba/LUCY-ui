<script setup lang="ts">
import { computed } from "vue";
import { type Item, readableBody, toolResultOf } from "../protocol/items";

const props = defineProps<{ item: Item }>();
const step = computed(() => toolResultOf(props.item.content));
const failed = computed(() => step.value.status === "failed" || step.value.error !== "");
const shown = computed(() => readableBody(step.value.body));
/** Said only when a result came from somewhere anyone can write to, the case worth noticing. */
const untrusted = computed(() => step.value.trust === "untrusted");
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
      <span class="tool-note">{{ step.note || step.operation }}</span>
      <span v-if="untrusted" class="tool-trust" :title="`Reported by ${step.source}, from somewhere anyone can write`">untrusted</span>
      <span v-if="duration" class="tool-time">{{ duration }}</span>
    </summary>
    <pre v-if="step.body" class="tool-summary tool-body">{{ shown }}</pre>
    <p v-if="step.error" class="tool-error">{{ step.error }}</p>
    <p v-if="!step.body && !step.error" class="tool-summary">This step reported nothing beyond its status.</p>
    <ul v-if="step.notices.length" class="tool-notices">
      <li v-for="(notice, i) in step.notices" :key="i">{{ notice }}</li>
    </ul>
  </details>
</template>
