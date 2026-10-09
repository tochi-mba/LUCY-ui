<script setup lang="ts">
import type { ConnectionPrompt } from "../stores/conversation";

defineProps<{ prompt: ConnectionPrompt }>();
</script>

<template>
  <section class="connection" :aria-label="`Connect ${prompt.service}`">
    <p class="eyebrow">Not connected</p>
    <p class="connection-message">{{ prompt.message || `${prompt.service} is not connected yet.` }}</p>
    <p v-if="prompt.scopes.length" class="connection-scopes">
      Needs: <code v-for="scope in prompt.scopes" :key="scope">{{ scope }}</code>
    </p>
    <a v-if="prompt.connectUrl" class="button" :href="prompt.connectUrl" target="_blank" rel="noopener noreferrer">
      Connect {{ prompt.service }}
    </a>
  </section>
</template>
