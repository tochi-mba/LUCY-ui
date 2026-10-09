<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Choice } from "../protocol/approvals";
import { approvalRequestOf } from "../protocol/items";
import type { Card, ConversationState } from "../stores/conversation";
import { cardsOf } from "../stores/conversation";
import ApprovalCard from "./ApprovalCard.vue";
import ErrorItem from "./ErrorItem.vue";
import GenericItem from "./GenericItem.vue";
import MessageItem from "./MessageItem.vue";
import StreamingText from "./StreamingText.vue";
import ToolResultItem from "./ToolResultItem.vue";

const props = defineProps<{ conversation: ConversationState; speaker: string }>();
const emit = defineEmits<{ answer: [approvalId: string, choice: Choice]; earlier: [] }>();

const scroller = ref<HTMLElement | null>(null);
const pinned = ref(true);

const cardByItem = computed(() => {
  const map = new Map<string, Card>();
  for (const card of cardsOf(props.conversation)) map.set(card.item.id, card);
  return map;
});

/** Streamed text that has not been retired into an item yet, and open reasoning. */
const liveBlocks = computed(() =>
  props.conversation.blocks.filter((block) => block.kind === "text" || block.open),
);

function onScroll(): void {
  const el = scroller.value;
  if (el === null) return;
  pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

async function stick(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  if (el !== null && pinned.value) el.scrollTop = el.scrollHeight;
}

const length = computed(
  () => props.conversation.items.length + liveBlocks.value.map((block) => block.text.length).reduce((a, b) => a + b, 0),
);
const stop = watch(length, stick);
onMounted(stick);
onBeforeUnmount(stop);

function answered(approvalId: string, choice: Choice): void {
  emit("answer", approvalId, choice);
}
</script>

<template>
  <div ref="scroller" class="transcript" @scroll.passive="onScroll">
    <p v-if="conversation.hasEarlier" class="transcript-earlier">
      <button type="button" class="button small ghost" @click="emit('earlier')">Show earlier</button>
    </p>
    <p v-if="conversation.loaded && conversation.items.length === 0 && liveBlocks.length === 0" class="transcript-empty">
      Nothing said yet. Say hello.
    </p>

    <template v-for="item in conversation.items" :key="item.id">
      <MessageItem v-if="item.type === 'message'" :item="item" :speaker="speaker" />
      <ToolResultItem v-else-if="item.type === 'tool_result'" :item="item" />
      <ErrorItem v-else-if="item.type === 'error'" :item="item" />
      <ApprovalCard
        v-else-if="item.type === 'approval_request' && cardByItem.has(item.id)"
        :card="cardByItem.get(item.id)!"
        @answer="(choice) => answered(approvalRequestOf(item.content)!.approval_id, choice)"
      />
      <template v-else-if="item.type === 'approval_response'" />
      <GenericItem v-else-if="item.type !== 'approval_request'" :item="item" />
    </template>

    <template v-for="block in liveBlocks" :key="block.key">
      <StreamingText v-if="block.kind === 'text'" :block="block" />
      <details v-else class="item item-reasoning" data-kind="reasoning">
        <summary>Lucy is thinking out loud</summary>
        <p class="reasoning-text">{{ block.text }}</p>
      </details>
    </template>

    <button v-if="!pinned" type="button" class="jump button small" @click="((pinned = true), stick())">
      Jump to latest ↓
    </button>
  </div>
</template>
