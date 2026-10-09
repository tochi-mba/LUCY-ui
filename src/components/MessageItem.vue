<script setup lang="ts">
import { computed } from "vue";
import { type Item, messageText } from "../protocol/items";
import MarkdownBlock from "./MarkdownBlock.vue";

const props = defineProps<{ item: Item; speaker: string }>();
const fromPerson = computed(() => props.item.role === "user");
const text = computed(() => messageText(props.item.content));
</script>

<template>
  <div class="item" :class="fromPerson ? 'item-user' : 'item-assistant'" data-kind="message">
    <p class="item-who">{{ fromPerson ? speaker : "Lucy" }}</p>
    <p v-if="fromPerson" class="item-said">{{ text }}</p>
    <MarkdownBlock v-else :text="text" />
  </div>
</template>
