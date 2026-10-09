<script setup lang="ts">
import type { ConversationState } from "../stores/conversation";
import ConnectionRequired from "./ConnectionRequired.vue";
import ContextMeter from "./ContextMeter.vue";

const props = defineProps<{ conversation: ConversationState }>();
const emit = defineEmits<{ cancel: [] }>();

const STREAM_TEXT: Record<string, string> = {
  idle: "",
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Connection lost; retrying…",
  unauthorized: "Sign in again to keep following.",
  closed: "Not following this conversation.",
};
</script>

<template>
  <aside class="panel" aria-label="Conversation state">
    <section v-if="conversation.turn.status !== 'idle'" class="panel-block">
      <p class="eyebrow">Turn</p>
      <p class="panel-line">
        <span class="rail-dot" :data-live="['queued', 'running', 'input_required', 'auth_required'].includes(conversation.turn.status)" aria-hidden="true" />
        {{ conversation.turn.status.replace("_", " ") }}
        <template v-if="conversation.turn.slow"> · taking a while</template>
      </p>
      <button
        v-if="['queued', 'running', 'input_required', 'auth_required'].includes(conversation.turn.status)"
        type="button"
        class="button small danger"
        @click="emit('cancel')"
      >
        Stop the turn
      </button>
    </section>

    <ConnectionRequired v-for="prompt in conversation.connections" :key="prompt.service" :prompt="prompt" />

    <ContextMeter v-if="conversation.window" :window="conversation.window" />

    <section v-if="conversation.work.length" class="panel-block">
      <p class="eyebrow">Work that finished</p>
      <ul class="panel-work">
        <li v-for="row in conversation.work.slice(0, 6)" :key="row.id">
          <code>{{ row.kind }}</code> {{ row.role || row.id }} · {{ row.state }} · {{ row.elapsedSeconds }}s
        </li>
      </ul>
    </section>

    <section class="panel-block panel-stream">
      <p class="panel-line muted">{{ STREAM_TEXT[conversation.stream] }}</p>
      <p v-if="conversation.unknownEvents > 0" class="panel-line muted">
        {{ conversation.unknownEvents }} event{{ conversation.unknownEvents === 1 ? "" : "s" }} this page has no view for.
      </p>
      <p v-if="conversation.compactedAt" class="panel-line muted">Older turns were summarised.</p>
    </section>
  </aside>
</template>
