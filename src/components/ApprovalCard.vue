<script setup lang="ts">
import { computed, ref } from "vue";
import { type Choice, LIFETIME_LABEL, type Lifetime, MAX_INSTRUCTION } from "../protocol/approvals";
import type { Card } from "../stores/conversation";

/**
 * The card a parked turn is waiting on. One answer decides every call on it; a standing yes may
 * be limited to some of the values the card's own `limit` names. The question shown is the hub's
 * description, never a model sentence.
 */
const props = defineProps<{ card: Card }>();
const emit = defineEmits<{ answer: [choice: Choice] }>();

const chosen = ref<Set<string>>(new Set());
const instruction = ref("");
const denying = ref(false);

const request = computed(() => props.card.request);
const open = computed(() => props.card.status === "pending");
const busy = computed(() => props.card.status === "answering");
const args = computed(() => {
  const value = request.value.arguments;
  if (value === null || (typeof value === "object" && Object.keys(value as object).length === 0)) return "";
  return JSON.stringify(value, null, 2) ?? "";
});
const limitChosen = computed(() => (chosen.value.size > 0 ? [...chosen.value] : undefined));

function toggle(value: string): void {
  const next = new Set(chosen.value);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  chosen.value = next;
}

function allow(lifetime: Lifetime): void {
  emit("answer", {
    approved: true,
    lifetime,
    only: lifetime === "profile" || lifetime === "account" ? limitChosen.value : undefined,
    instruction: instruction.value,
  });
}

function deny(): void {
  emit("answer", { approved: false, instruction: instruction.value });
}

const OUTCOME: Record<string, string> = {
  granted: "Allowed",
  denied: "Denied",
  expired: "This card expired before it was answered.",
  closed: "Already decided",
};
</script>

<template>
  <section class="card" :data-status="card.status" :aria-label="`Approval: ${request.description}`">
    <p class="eyebrow signal">Lucy asks</p>
    <p class="card-question">{{ request.description }}</p>
    <p class="card-permission">
      Permission <code>{{ request.permission }}</code>
      <template v-if="request.steps.length > 1"> · {{ request.steps.length }} calls on this one card</template>
    </p>

    <ol v-if="request.steps.length > 0" class="card-steps">
      <li v-for="step in request.steps" :key="step.step || step.operation + step.description">
        <code>{{ step.operation }}</code> {{ step.description }}
      </li>
    </ol>
    <details v-else-if="args" class="card-args">
      <summary>What it would run</summary>
      <pre>{{ args }}</pre>
    </details>

    <template v-if="open || busy">
      <fieldset v-if="request.limit" class="card-limit">
        <legend>A standing yes can be only for:</legend>
        <label v-for="value in request.limit.values" :key="value">
          <input type="checkbox" :checked="chosen.has(value)" :disabled="busy" @change="toggle(value)" />
          <code>{{ value }}</code>
        </label>
        <p class="card-limit-note">
          {{ chosen.size > 0 ? `“${LIFETIME_LABEL.profile}” and “${LIFETIME_LABEL.account}” will cover only these.` : "Nothing ticked means the yes covers every value." }}
        </p>
      </fieldset>

      <div class="card-actions">
        <button type="button" class="button primary" :disabled="busy" @click="allow('once')">Allow {{ LIFETIME_LABEL.once }}</button>
        <button type="button" class="button" :disabled="busy" @click="allow('session')">Allow {{ LIFETIME_LABEL.session }}</button>
        <button type="button" class="button" :disabled="busy" @click="allow('profile')">Allow {{ LIFETIME_LABEL.profile }}</button>
        <button type="button" class="button" :disabled="busy" @click="allow('account')">Always allow</button>
        <button type="button" class="button danger" :disabled="busy" @click="denying ? deny() : (denying = true)">
          {{ denying ? "Confirm deny" : "Deny" }}
        </button>
      </div>
      <label class="card-instruction">
        <span>Tell Lucy why, or what to do instead (optional)</span>
        <textarea v-model="instruction" rows="2" :maxlength="MAX_INSTRUCTION" :disabled="busy" />
      </label>
      <p v-if="busy" class="card-outcome" role="status">Sending your answer…</p>
    </template>

    <p v-else class="card-outcome" :data-approved="card.status === 'granted'">
      {{ OUTCOME[card.status] }}<template v-if="card.record && card.status === 'granted' && card.record.lifetime !== 'once'">, {{ LIFETIME_LABEL[card.record.lifetime as Lifetime] ?? card.record.lifetime }}</template>
      <template v-if="card.record?.instruction"> · “{{ card.record.instruction }}”</template>
    </p>
  </section>
</template>
