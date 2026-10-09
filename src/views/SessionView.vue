<script setup lang="ts">
import { computed, onScopeDispose, ref, toRef, watch } from "vue";
import { useCore, useShell } from "../app/context";
import MessageComposer from "../components/MessageComposer.vue";
import SidePanel from "../components/SidePanel.vue";
import TranscriptView from "../components/TranscriptView.vue";
import LucyFace from "../face/LucyFace.vue";
import { moodFor } from "../face/moods";
import type { Choice } from "../protocol/approvals";
import { speakerFor } from "../protocol/headed";
import { isSpeaking, isWorking, pendingCards } from "../stores/conversation";
import { useConversation } from "../stores/useConversation";

const props = defineProps<{ id: string }>();

const core = useCore();
const shell = useShell();
const conversation = useConversation(core.transport, toRef(props, "id"));
const state = conversation.state;

const composing = ref(false);
const now = ref(Date.now());
const tick = setInterval(() => {
  now.value = Date.now();
}, 1000);
onScopeDispose(() => {
  clearInterval(tick);
  shell.busy.value = false;
});

const pending = computed(() => pendingCards(state));
const speaker = computed(() => speakerFor(state.title));
const mood = computed(() =>
  moodFor({
    signedIn: core.auth.state.phase === "signed_in",
    hasSession: true,
    stream: state.stream,
    turn: state.turn.status,
    pendingCards: pending.value.length,
    connectionNeeded: state.connections.length > 0,
    speaking: isSpeaking(state),
    working: isWorking(state),
    composing: composing.value,
    outcome: state.outcome,
    now: now.value,
  }),
);

// A draft or an open card holds Follow still (the shell reads this).
watch(
  [composing, pending],
  ([typing, cards]) => {
    shell.busy.value = typing || cards.length > 0;
  },
  { immediate: true },
);

function answer(approvalId: string, choice: Choice): void {
  void conversation.answer(approvalId, choice);
}
</script>

<template>
  <main class="session" aria-label="Conversation">
    <section class="stage">
      <LucyFace :mood="mood" :size="148" />
      <div class="stage-title">
        <p class="eyebrow">{{ speaker === "Claude Code" ? "Claude Code is driving" : "Conversation" }}</p>
        <h1>{{ state.title || "…" }}</h1>
      </div>
    </section>

    <TranscriptView :conversation="state" :speaker="speaker" @answer="answer" @earlier="conversation.loadEarlier()" />

    <p v-if="state.error" class="session-error" role="alert">
      {{ state.error }}
      <button type="button" class="button small ghost" @click="conversation.dismissError()">Dismiss</button>
    </p>

    <MessageComposer
      :turn="state.turn.status"
      :disabled="core.auth.state.phase !== 'signed_in'"
      @send="(text) => conversation.send(text)"
      @cancel="conversation.cancel()"
      @composing="(active) => (composing = active)"
    />

    <SidePanel :conversation="state" @cancel="conversation.cancel()" />
  </main>
</template>
