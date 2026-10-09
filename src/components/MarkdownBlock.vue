<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../markdown/render";

const props = defineProps<{ text: string }>();
const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <!-- Safe to inject: renderMarkdown escapes raw HTML and refuses unsafe link schemes. -->
  <div class="markdown" v-html="html" />
</template>
