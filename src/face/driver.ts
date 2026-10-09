/**
 * Turning a mood into calls on the face.
 *
 * The face is agent-robot-avatar (CX ArtLab, MIT), a native custom element (ADR-0001). Everything
 * this UI knows about it is the `AvatarElement` interface below, so swapping in another face is a
 * second `FaceDriver`, not a change anywhere else (ADR-0004).
 *
 * Short moods (a message landing, a turn ending) are animations that need a moment to be seen.
 * While one plays, a newer mood waits its turn; only the latest waiting mood is kept, so the face
 * never replays a backlog.
 */
import type { Mood } from "./moods";

/** The part of `<agent-robot-avatar>` this driver uses. */
export interface AvatarElement {
  play(action: string): unknown;
  reset(): unknown;
  sleep(): unknown;
  wake(): unknown;
  input(active?: boolean): unknown;
  startWaiting(options?: { variant?: "default" | "wrap" }): unknown;
  stopWaiting(): unknown;
}

export interface FaceDriver {
  set(mood: Mood): void;
  destroy(): void;
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const HOLD_MS = 900;

const SHORT: ReadonlySet<Mood> = new Set(["sent", "done", "failed", "blocked"]);

const defaultTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class AvatarDriver implements FaceDriver {
  readonly #face: AvatarElement;
  readonly #timers: Timers;
  #current: Mood | null = null;
  #waiting: Mood | null = null;
  #hold: unknown = null;

  constructor(face: AvatarElement, timers: Timers = defaultTimers) {
    this.#face = face;
    this.#timers = timers;
  }

  set(mood: Mood): void {
    if (this.#hold !== null) {
      this.#waiting = mood;
      return;
    }
    this.#apply(mood);
  }

  destroy(): void {
    if (this.#hold !== null) this.#timers.clear(this.#hold);
    this.#hold = null;
    this.#waiting = null;
  }

  #apply(mood: Mood): void {
    if (mood === this.#current) return;
    this.#leave(this.#current);
    this.#current = mood;
    this.#enter(mood);
    if (SHORT.has(mood)) {
      this.#hold = this.#timers.set(() => {
        this.#hold = null;
        const next = this.#waiting;
        this.#waiting = null;
        if (next !== null) this.#apply(next);
      }, HOLD_MS);
    }
  }

  #leave(mood: Mood | null): void {
    if (mood === "thinking" || mood === "working") settle(this.#face.stopWaiting());
    else if (mood === "attentive" || mood === "speaking") settle(this.#face.input(false));
    else if (mood === "asleep") settle(this.#face.wake());
  }

  #enter(mood: Mood): void {
    const face = this.#face;
    switch (mood) {
      case "asleep":
        settle(face.sleep());
        return;
      case "idle":
        settle(face.reset());
        return;
      case "attentive":
      case "speaking":
        settle(face.input(true));
        return;
      case "sent":
        settle(face.play("send"));
        return;
      case "thinking":
        settle(face.startWaiting());
        return;
      case "working":
        settle(face.startWaiting({ variant: "wrap" }));
        return;
      case "needs_you":
        settle(face.play("warning"));
        return;
      case "blocked":
        settle(face.play("blocked"));
        return;
      case "done":
        settle(face.play("success"));
        return;
      case "failed":
        settle(face.play("failure"));
        return;
      case "disconnected":
        settle(face.play("connection-error"));
        return;
    }
  }
}

/** The face's methods may return a promise; one that rejects is an animation cut short, not news. */
function settle(result: unknown): void {
  if (result instanceof Promise) result.catch(() => {});
}
