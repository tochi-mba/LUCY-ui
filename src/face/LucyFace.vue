<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AvatarDriver, type AvatarElement, type FaceDriver } from "./driver";
import { MOOD_TEXT, type Mood } from "./moods";
import { registerFace } from "./register";

const props = withDefaults(
  defineProps<{
    mood: Mood;
    size?: number;
    /** Seams for tests: how the element is defined, and what drives it. */
    register?: () => Promise<void>;
    driverFor?: (element: HTMLElement) => FaceDriver;
  }>(),
  {
    size: 168,
    register: () => registerFace(),
    driverFor: (element: HTMLElement) => new AvatarDriver(element as unknown as AvatarElement),
  },
);

const host = ref<HTMLElement | null>(null);
let driver: FaceDriver | null = null;
let unmounted = false;

onMounted(async () => {
  await props.register();
  if (unmounted || host.value === null) return;
  driver = props.driverFor(host.value);
  driver.set(props.mood);
});

watch(
  () => props.mood,
  (mood) => driver?.set(mood),
);

onBeforeUnmount(() => {
  unmounted = true;
  driver?.destroy();
});
</script>

<template>
  <div class="face" :data-mood="mood">
    <div class="face-stage" aria-hidden="true">
      <agent-robot-avatar ref="host" :size="size" color="#1B221C" auto-sleep="0" wake-on="manual" motion="auto" />
    </div>
    <p class="sr-only" role="status" aria-live="polite">{{ MOOD_TEXT[mood] }}</p>
  </div>
</template>
