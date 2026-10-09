/**
 * Defining `<agent-robot-avatar>`, once, when a face is first shown.
 *
 * Importing the package registers the custom element as a side effect. It is loaded on demand so
 * the rest of the app, and every test that does not draw a face, never pays for it.
 */
let defining: Promise<void> | null = null;

export function registerFace(load: () => Promise<unknown> = () => import("agent-robot-avatar")): Promise<void> {
  defining ??= load().then(() => undefined);
  return defining;
}

/** For tests: forget that the face was defined. */
export function forgetFace(): void {
  defining = null;
}
