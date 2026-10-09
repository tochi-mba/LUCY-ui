import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const run = promisify(execFile);

test("a terminal drives Lucy, Follow brings it on screen, and the person answers the card", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "drives a second process; one engine is enough");
  await signIn(page);
  const token = await page.evaluate(() => sessionStorage.getItem("lucy-ui.token"));
  expect(token).toBeTruthy();
  await page.getByText("Follow", { exact: true }).click();

  const env = { ...process.env, LUCY_URL: "http://127.0.0.1:8765", LUCY_TOKEN: token ?? "" };
  const created = await run(process.execPath, ["scripts/headed.mjs", "new", `e2e ${Date.now()}`], { env });
  const sessionId = created.stdout.trim();

  // The script asks for music and waits; Lucy parks on a card, which keeps the conversation live
  // until the person in the browser decides.
  const saying = run(process.execPath, ["scripts/headed.mjs", "say", sessionId, "play lonely at the top by asake"], {
    env,
  });

  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}`), { timeout: 15_000 });
  await expect(page.getByText("Claude Code is driving")).toBeVisible();
  await expect(page.locator(".item-user .item-who").first()).toHaveText("Claude Code");
  await expect(page.locator(".rail-row[aria-current=page] .rail-badge")).toHaveText("Claude Code");

  await page.locator(".card").getByRole("button", { name: "Allow this time" }).click();
  const said = await saying;
  expect(said.stdout).toContain("Playing Lonely At The Top by Asake");
  expect(said.stderr).toContain("asking for approval in the UI");
});
