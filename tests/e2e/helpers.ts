import { expect, type Page } from "@playwright/test";

/** Opens the app and signs in through the device flow; the fake hub self-approves on its second poll. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Get a sign-in code" }).click();
  await expect(page.locator(".user-code")).toContainText("lucy approve FAKE-");
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".chip")).toHaveAttribute("data-tone", "on");
}

/** Starts a conversation from the home page with its first message, and waits to be inside it. */
export async function startWith(page: Page, words: string): Promise<void> {
  await page.getByLabel("Start a conversation").fill(words);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/s\/ses_/);
}
