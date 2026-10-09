<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { Auth } from "../auth/auth";

/** Who is signed in and for how much longer. Keyring tokens live fifteen minutes. */
const props = defineProps<{ auth: Auth }>();

const now = ref(Date.now());
const tick = setInterval(() => {
  now.value = Date.now();
}, 1000);
onBeforeUnmount(() => clearInterval(tick));

const state = computed(() => props.auth.state);
const left = computed(() => props.auth.remaining(now.value));
const amber = computed(() => props.auth.expiring(now.value));
const clock = computed(() => {
  if (left.value === null) return "";
  const seconds = Math.round(left.value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});
</script>

<template>
  <button
    type="button"
    class="chip"
    :data-tone="state.phase !== 'signed_in' ? 'off' : amber ? 'amber' : 'on'"
    @click="auth.openDialog()"
  >
    <span class="chip-dot" aria-hidden="true" />
    <template v-if="state.phase === 'signed_in'">
      <span class="chip-who">{{ state.account ?? "Signed in" }}</span>
      <span v-if="clock" class="chip-clock" :aria-label="`Sign-in runs out in ${clock}`">{{ clock }}</span>
    </template>
    <span v-else class="chip-who">Sign in</span>
  </button>
</template>
