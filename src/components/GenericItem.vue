<script setup lang="ts">
import { computed } from "vue";
import type { Item } from "../protocol/items";

/** Any item kind this UI has no view for yet. Shown, never silently dropped. */
const props = defineProps<{ item: Item }>();
const body = computed(() => JSON.stringify(props.item.content, null, 2) ?? "null");
</script>

<template>
  <details class="item item-generic" data-kind="generic">
    <summary>
      <code>{{ item.type }}</code>
      <span class="tool-note">from {{ item.role }}</span>
    </summary>
    <pre class="generic-body">{{ body }}</pre>
  </details>
</template>
