<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SHELL, useCore } from "./app/context";
import SessionRail from "./components/SessionRail.vue";
import SignInChip from "./components/SignInChip.vue";
import SignInDialog from "./components/SignInDialog.vue";
import { liveSession } from "./protocol/sessions";
import { useSessions } from "./stores/useSessions";

const core = useCore();
const route = useRoute();
const router = useRouter();

const follow = ref(false);
const busy = ref(false);
const signedIn = computed(() => core.auth.state.phase === "signed_in");
const sessions = useSessions(core.transport, { enabled: signedIn, follow });
provide(SHELL, { sessions, follow, busy });

const currentId = computed(() => (typeof route.params.id === "string" ? route.params.id : null));
const railOpen = ref(false);

// Follow: show whatever is live, but never pull the page out from under a person who is typing
// or deciding a card.
watch(
  () => [follow.value, busy.value, sessions.state.sessions] as const,
  () => {
    if (!follow.value || busy.value) return;
    const live = liveSession(sessions.state.sessions);
    if (live !== null && live.id !== currentId.value) void router.push({ name: "session", params: { id: live.id } });
  },
  { deep: false },
);

function open(id: string): void {
  railOpen.value = false;
  void router.push({ name: "session", params: { id } });
}

async function create(title: string): Promise<void> {
  const session = await sessions.create({ title: title || "New conversation" });
  if (session !== null) open(session.id);
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <button class="button small ghost rail-toggle" type="button" :aria-expanded="railOpen" @click="railOpen = !railOpen">
        ☰<span class="sr-only">Conversations</span>
      </button>
      <RouterLink class="brand" to="/">
        <span class="brand-company">REX Technologies</span>
        <span class="brand-name">LUCY</span>
      </RouterLink>
      <RouterLink class="topbar-link" to="/face">Face</RouterLink>
      <span class="topbar-spacer" />
      <SignInChip :auth="core.auth" />
    </header>
    <div class="body" :data-rail-open="railOpen">
      <SessionRail
        :sessions="sessions.visible()"
        :current-id="currentId"
        :follow="follow"
        :loaded="sessions.state.loaded"
        @open="open"
        @create="create"
        @archive="(id) => sessions.archive(id)"
        @update:follow="(on) => (follow = on)"
      />
      <RouterView />
    </div>
    <p v-if="sessions.state.error" class="shell-error" role="alert">{{ sessions.state.error }}</p>
    <SignInDialog :auth="core.auth" />
  </div>
</template>
