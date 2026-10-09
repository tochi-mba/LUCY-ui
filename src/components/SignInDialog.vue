<script setup lang="ts">
import { computed, ref } from "vue";
import type { Auth } from "../auth/auth";

/**
 * Sign in without a password: the hub mints a short code, and a terminal that is already signed
 * in approves it with `lucy approve CODE`. A token can be pasted instead. The dialog never
 * navigates away, so a sign-in that expired mid-conversation costs nothing on screen.
 */
const props = defineProps<{ auth: Auth }>();

const pasted = ref("");
const copied = ref(false);

const state = computed(() => props.auth.state);
const command = computed(() => `lucy approve ${state.value.code?.user_code ?? ""}`);

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(command.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1400);
  } catch {
    copied.value = false;
  }
}

function paste(): void {
  void props.auth.usePasted(pasted.value);
  pasted.value = "";
}
</script>

<template>
  <div v-if="state.dialogOpen" class="scrim">
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="signin-title">
      <p class="eyebrow signal">Sign in</p>
      <h2 id="signin-title">{{ state.phase === "signed_in" ? "Sign in again" : "Wake Lucy up" }}</h2>
      <p v-if="state.phase === 'signed_in'" class="dialog-note">
        Your sign-in ran out or was refused. Approving a new code carries on exactly where you are.
      </p>

      <template v-if="state.phase === 'code' && state.code">
        <p>From a terminal already signed in as you:</p>
        <p class="code-row">
          <code class="user-code">{{ command }}</code>
          <button type="button" class="button small" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
        </p>
        <p class="dialog-note">Waiting for the approval… the code works for ten minutes.</p>
        <button type="button" class="button ghost" @click="auth.cancel()">Start over</button>
      </template>

      <template v-else>
        <button type="button" class="button primary" :disabled="state.phase === 'starting'" @click="auth.startDevice()">
          {{ state.phase === "starting" ? "Asking Lucy for a code…" : "Get a sign-in code" }}
        </button>
        <details class="dialog-paste">
          <summary>Or paste a token</summary>
          <form @submit.prevent="paste">
            <input
              v-model="pasted"
              type="password"
              autocomplete="off"
              aria-label="A keyring token for Lucy"
              placeholder="A token with audience lucy-api"
            />
            <button type="submit" class="button small" :disabled="pasted.trim().length === 0">Use it</button>
          </form>
        </details>
      </template>

      <p v-if="state.error" class="dialog-error" role="alert">{{ state.error }}</p>
      <button
        v-if="state.phase === 'signed_in'"
        type="button"
        class="dialog-close button small ghost"
        @click="auth.closeDialog()"
      >
        Not now
      </button>
    </section>
  </div>
</template>
