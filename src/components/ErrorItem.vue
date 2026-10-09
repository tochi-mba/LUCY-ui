<script setup lang="ts">
import { computed } from "vue";
import { errorOf, type Item } from "../protocol/items";

const props = defineProps<{ item: Item }>();
const error = computed(() => errorOf(props.item.content));
</script>

<template>
  <div class="item item-error" data-kind="error" role="alert">
    <p class="item-who">Something went wrong</p>
    <p class="error-detail">{{ error.detail || "Lucy could not finish that." }}</p>
    <p class="error-code"><code>{{ error.code }}</code></p>
  </div>
</template>
