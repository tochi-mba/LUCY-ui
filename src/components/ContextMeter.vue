<script setup lang="ts">
import { computed } from "vue";
import type { WindowReport } from "../stores/conversation";

const props = defineProps<{ window: WindowReport }>();
const label = computed(() => {
  const w = props.window;
  if (w.state === "over") return "Over the window; Lucy is compacting.";
  if (w.state === "compacting") return "Compacting the older turns.";
  return `${w.tokensUntilCompaction.toLocaleString()} tokens until Lucy summarises the older turns.`;
});
</script>

<template>
  <div class="meter" :data-state="window.state">
    <div class="meter-row">
      <span>Context</span>
      <strong>{{ window.percent }}%</strong>
    </div>
    <div
      class="meter-bar"
      role="meter"
      :aria-valuenow="window.percent"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="How full the conversation window is"
    >
      <span class="meter-fill" :style="{ width: `${Math.min(100, window.percent)}%` }" />
      <span class="meter-mark" :style="{ left: `${window.warnAtPercent}%` }" aria-hidden="true" />
      <span class="meter-mark compact" :style="{ left: `${window.compactAtPercent}%` }" aria-hidden="true" />
    </div>
    <p class="meter-note">{{ label }}</p>
    <p v-if="window.summarisedTurns > 0" class="meter-note">
      {{ window.summarisedTurns }} older turn{{ window.summarisedTurns === 1 ? "" : "s" }} read as a summary.
    </p>
  </div>
</template>
