/**
 * The answer to an approval card, built the way the hub will accept it.
 *
 * The hub refuses `only` with a one-time yes or with a denial (`permissions/approvals.py`
 * `answer_approval`). Building that here as well means the button that would send it is never
 * offered, instead of a person pressing it and reading a 409.
 */

export type Lifetime = "once" | "session" | "profile" | "account";

export interface Choice {
  approved: boolean;
  /** How long a yes stands. A denial is always for this card only. */
  lifetime?: Lifetime;
  /** "Always, for these": limit a standing yes to some values of the card's `limit.field`. */
  only?: string[];
  /** What the person wants Lucy told, at most 4096 characters. */
  instruction?: string;
}

export interface ApprovalInput {
  type: "input.approval";
  approval_id: string;
  approved: boolean;
  lifetime: Lifetime;
  only?: string[];
  instruction?: string;
}

export const MAX_INSTRUCTION = 4096;

export function answerFor(approvalId: string, choice: Choice): ApprovalInput {
  const lifetime: Lifetime = choice.approved ? (choice.lifetime ?? "once") : "once";
  const only = (choice.only ?? []).filter((value) => value.length > 0);
  if (only.length > 0 && (!choice.approved || lifetime === "once")) {
    throw new Error("A limit to some values belongs to a standing yes, never to a one-time yes or a denial.");
  }
  const answer: ApprovalInput = { type: "input.approval", approval_id: approvalId, approved: choice.approved, lifetime };
  if (only.length > 0) answer.only = only;
  const instruction = choice.instruction?.trim().slice(0, MAX_INSTRUCTION);
  if (instruction) answer.instruction = instruction;
  return answer;
}

/** The words a card's buttons and its record use for each lifetime. */
export const LIFETIME_LABEL: Record<Lifetime, string> = {
  once: "this time",
  session: "for this conversation",
  profile: "for this profile",
  account: "always",
};
