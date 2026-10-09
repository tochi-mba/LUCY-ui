<script setup lang="ts">
import { computed, ref } from "vue";
import { isHeaded } from "../protocol/headed";
import { isLive, type Session } from "../protocol/sessions";

const props = defineProps<{
  sessions: Session[];
  currentId: string | null;
  follow: boolean;
  loaded: boolean;
}>();
const emit = defineEmits<{
  open: [id: string];
  create: [title: string];
  archive: [id: string];
  "update:follow": [on: boolean];
}>();

const naming = ref(false);
const title = ref("");

const rows = computed(() =>
  props.sessions.map((session) => ({
    session,
    live: isLive(session),
    headed: isHeaded(session.title),
    when: ago(session.updated_at),
  })),
);

function ago(at: number): string {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - at));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function create(): void {
  emit("create", title.value.trim());
  title.value = "";
  naming.value = false;
}
</script>

<template>
  <nav class="rail" aria-label="Conversations">
    <div class="rail-head">
      <p class="eyebrow signal">Conversations</p>
      <button type="button" class="button small" @click="naming = !naming">New</button>
    </div>
    <form v-if="naming" class="rail-new" @submit.prevent="create">
      <input v-model="title" aria-label="Name the conversation" placeholder="What is it about?" />
      <button type="submit" class="button small primary">Start</button>
    </form>

    <label class="rail-follow">
      <input type="checkbox" :checked="follow" @change="emit('update:follow', ($event.target as HTMLInputElement).checked)" />
      <span><strong>Follow</strong> whatever is live</span>
    </label>

    <p v-if="loaded && rows.length === 0" class="rail-empty">No conversations yet.</p>
    <ul class="rail-list">
      <li v-for="row in rows" :key="row.session.id">
        <button
          type="button"
          class="rail-row"
          :aria-current="row.session.id === currentId ? 'page' : undefined"
          @click="emit('open', row.session.id)"
        >
          <span class="rail-dot" :data-live="row.live" :data-waiting="row.session.status === 'input_required'" aria-hidden="true" />
          <span class="rail-title">{{ row.session.title }}</span>
          <span v-if="row.headed" class="rail-badge">Claude Code</span>
          <span class="rail-when">{{ row.when }}</span>
        </button>
        <button
          type="button"
          class="rail-archive"
          :aria-label="`Archive ${row.session.title}`"
          @click.stop="emit('archive', row.session.id)"
        >
          ×
        </button>
      </li>
    </ul>
  </nav>
</template>
