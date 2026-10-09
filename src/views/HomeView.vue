<script setup lang="ts">
import LucyFace from "../face/LucyFace.vue";
</script>

<template>
  <main class="home">
    <LucyFace mood="idle" :size="180" />
    <p class="eyebrow signal">LUCY · REX Technologies</p>
    <h1>Lucy's face is being built.</h1>
    <p class="muted">Sign-in, conversations and approval cards land on this page next.</p>
    <RouterLink class="button" to="/face">Try every expression</RouterLink>
  </main>
</template>

<style scoped>
.home {
  min-height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  padding: 32px var(--gutter);
  text-align: center;
}
h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 40px);
  letter-spacing: -0.02em;
}
.muted {
  margin: 0;
  color: var(--muted);
}
</style>
