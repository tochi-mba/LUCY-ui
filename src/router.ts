import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "home", component: () => import("./views/HomeView.vue") },
  { path: "/s/:id", name: "session", component: () => import("./views/SessionView.vue"), props: true },
  { path: "/face", name: "face", component: () => import("./views/FaceLab.vue") },
  { path: "/:rest(.*)*", redirect: "/" },
];

export function makeRouter() {
  return createRouter({ history: createWebHistory(), routes });
}
