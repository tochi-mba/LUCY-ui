<script setup lang="ts">
import { computed, ref } from "vue";
import { isLiveTurn, type TurnStatus } from "../stores/conversation";

const props = defineProps<{ turn: TurnStatus; disabled?: boolean }>();
const emit = defineEmits<{ send: [text: string]; cancel: []; composing: [active: boolean] }>();

const draft = ref("");
const live = computed(() => isLiveTurn(props.turn));
const hint = computed(() => {
  if (props.turn === "queued") return "Queued…";
  if (props.turn === "running") return "Lucy is working. You can keep typing; your message waits its turn.";
  if (props.turn === "input_required") return "Lucy is waiting on the card above.";
  if (props.turn === "auth_required") return "Lucy needs a connection before she can go on.";
  return "";
});

function update(): void {
  emit("composing", draft.value.trim().length > 0);
}

function send(): void {
  const text = draft.value.trim();
  if (!text || props.disabled) return;
  draft.value = "";
  emit("composing", false);
  emit("send", text);
}

function onEnter(event: KeyboardEvent): void {
  if (event.shiftKey) return;
  event.preventDefault();
  send();
}
</script>

<template>
  <form class="composer" @submit.prevent="send">
    <textarea
      v-model="draft"
      class="composer-input"
      rows="2"
      placeholder="Say something to Lucy…"
      aria-label="Message to Lucy"
      :disabled="disabled"
      @input="update"
      @keydown.enter="onEnter"
    />
    <div class="composer-row">
      <p class="composer-hint" aria-live="polite">{{ hint }}</p>
      <button v-if="live" type="button" class="button small danger" @click="emit('cancel')">Stop the turn</button>
      <button type="submit" class="button small primary" :disabled="disabled || draft.trim().length === 0">Send</button>
    </div>
  </form>
</template>
