<script setup lang="ts">
import { ref } from "vue";
import LucyFace from "../face/LucyFace.vue";
import { MOOD_TEXT, MOODS, type Mood } from "../face/moods";

const mood = ref<Mood>("idle");
</script>

<template>
  <main class="lab">
    <p class="eyebrow signal">Face lab</p>
    <h1>Every mood Lucy's face can show</h1>
    <p class="lab-lede">Each button is a state of a conversation. The face follows the conversation the same way.</p>
    <LucyFace :mood="mood" :size="200" />
    <p class="lab-now">{{ MOOD_TEXT[mood] }}</p>
    <div class="lab-moods" role="group" aria-label="Moods">
      <button
        v-for="name in MOODS"
        :key="name"
        type="button"
        class="button small"
        :class="{ primary: name === mood }"
        :aria-pressed="name === mood"
        @click="mood = name"
      >
        {{ name.replace("_", " ") }}
      </button>
    </div>
    <RouterLink class="lab-back" to="/">Back to conversations</RouterLink>
  </main>
</template>

<style scoped>
.lab {
  max-width: 760px;
  margin: 0 auto;
  padding: 48px var(--gutter);
  display: grid;
  gap: 18px;
  justify-items: center;
  text-align: center;
}
h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 38px);
  letter-spacing: -0.02em;
}
.lab-lede,
.lab-now {
  margin: 0;
  color: var(--muted);
}
.lab-now {
  min-height: 1.5em;
  color: var(--text);
}
.lab-moods {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.lab-back {
  font-size: 14px;
}
</style>
