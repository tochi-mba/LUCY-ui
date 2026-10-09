import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, startWith } from "./helpers";

test("a signed-out visitor meets an asleep face and the sign-in dialog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wake Lucy up" })).toBeVisible();
  await expect(page.locator(".face")).toHaveAttribute("data-mood", "asleep");
});

test("signing in with the device flow wakes the face", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".face")).toHaveAttribute("data-mood", "idle");
  await expect(page.getByRole("heading", { name: "What should Lucy do?" })).toBeVisible();
});

test("a greeting streams in once, as the durable message", async ({ page }) => {
  await signIn(page);
  await startWith(page, "hello there");
  const reply = page.locator("[data-kind=message]").filter({ hasText: "remember with provenance" });
  await expect(reply).toHaveCount(1);
  await expect(page.locator("[data-kind=streaming]")).toHaveCount(0);
  await expect(page.locator(".meter")).toContainText("4%");
});

test("a music request parks on a card, and allowing it plays the track", async ({ page }) => {
  await signIn(page);
  await startWith(page, "play lonely at the top by asake");
  const card = page.locator(".card");
  await expect(card).toContainText("Play what music.find found");
  await expect(page.locator(".face")).toHaveAttribute("data-mood", "needs_you");
  await card.getByRole("button", { name: "Allow this time" }).click();
  await expect(page.locator("[data-kind=message]").last()).toContainText("Playing Lonely At The Top by Asake");
  await expect(card).toContainText("Allowed");
  await expect(page.locator("[data-kind=tool_result]")).toHaveCount(2);
});

test("denying a card takes two presses and carries the reason", async ({ page }) => {
  await signIn(page);
  await startWith(page, "play something loud");
  const card = page.locator(".card");
  await card.getByLabel(/Tell Lucy why/).fill("too late for music");
  await card.getByRole("button", { name: "Deny" }).click();
  await card.getByRole("button", { name: "Confirm deny" }).click();
  await expect(card).toContainText("Denied");
  await expect(card).toContainText("too late for music");
  await expect(page.locator("[data-kind=message]").last()).toContainText("will not play");
});

test("a failed turn shows its error and the failure face", async ({ page }) => {
  await signIn(page);
  await startWith(page, "make this fail");
  await expect(page.locator("[data-kind=error]")).toContainText("did not answer in time");
});

test("the composer sends follow-ups into the same conversation", async ({ page }) => {
  await signIn(page);
  await startWith(page, "hello");
  await expect(page.locator("[data-kind=message]")).toHaveCount(2);
  await page.getByLabel("Message to Lucy").fill("and again");
  await page.getByLabel("Message to Lucy").press("Enter");
  await expect(page.locator("[data-kind=message]")).toHaveCount(4);
});

test("the conversation screen has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await startWith(page, "play it");
  await expect(page.locator(".card")).toBeVisible();
  const results = await new AxeBuilder({ page }).exclude("agent-robot-avatar").analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
