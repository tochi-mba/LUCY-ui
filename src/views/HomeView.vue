<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useCore, useShell } from "../app/context";
import LucyFace from "../face/LucyFace.vue";
import { moodFor } from "../face/moods";

const core = useCore();
const shell = useShell();
const router = useRouter();

const composing = ref(false);
const draft = ref("");

const mood = computed(() =>
  moodFor({
    signedIn: core.auth.state.phase === "signed_in",
    hasSession: false,
    stream: "idle",
    turn: "idle",
    pendingCards: 0,
    connectionNeeded: false,
    speaking: false,
    working: false,
    composing: composing.value,
    outcome: null,
    now: 0,
  }),
);

/** The first message starts the conversation and is also its name, clipped to a title. */
async function start(): Promise<void> {
  const text = draft.value.trim();
  if (!text) return;
  const session = await shell.sessions.create({ title: text.slice(0, 60) });
  if (session === null) return;
  await core.transport.send(session.id, [{ type: "input.message", content: text }], crypto.randomUUID());
  await router.push({ name: "session", params: { id: session.id } });
}
</script>

<template>
  <main class="home">
    <LucyFace :mood="mood" :size="200" />
    <h1>{{ core.auth.state.phase === "signed_in" ? "What should Lucy do?" : "Lucy is asleep." }}</h1>
    <form v-if="core.auth.state.phase === 'signed_in'" class="home-start" @submit.prevent="start">
      <input
        v-model="draft"
        aria-label="Start a conversation"
        placeholder="Ask her anything…"
        @input="composing = draft.trim().length > 0"
      />
      <button type="submit" class="button primary" :disabled="draft.trim().length === 0">Start</button>
    </form>
    <p v-else class="muted">Sign in from the chip above and she wakes up.</p>
    <p class="muted home-hint">Pick a conversation on the left, or try <RouterLink to="/face">every expression</RouterLink>.</p>
  </main>
</template>

<style scoped>
.home {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 16px;
  padding: 32px var(--gutter);
  text-align: center;
}
h1 {
  margin: 0;
  font-size: clamp(24px, 3.4vw, 36px);
  letter-spacing: -0.02em;
}
.muted {
  margin: 0;
  color: var(--muted);
}
.home-start {
  display: flex;
  gap: 10px;
  width: min(480px, 90vw);
}
.home-start input {
  flex: 1;
  min-height: 44px;
  padding: 0 14px;
  border-radius: var(--radius-m);
  border: 1px solid var(--line);
  background: var(--panel);
}
.home-hint {
  font-size: 13px;
}
</style>
