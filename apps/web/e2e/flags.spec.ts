import fs from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Tester flags to eval cases, against a running web server + worker (mock LLM, test mode): the
 * associate reports a conversation as stuck, and an admin downloads an eval case for it.
 */
const LOG = process.env.WEB_LOG ?? "/tmp/web.log";
const ASSOCIATE = process.env.E2E_EMAIL ?? "associate@dev-firm.example";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "admin@dev-firm.example";

async function signIn(page: Page, request: APIRequestContext, email: string) {
  const before = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").length : 0;
  await request.post("/api/auth/magic-link", { data: { email } });
  let url = "";
  for (let i = 0; i < 20 && !url; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const m = fs.readFileSync(LOG, "utf8").slice(before).match(/"url":"([^"]+)"/);
    if (m) url = m[1]!.replace(/\\u0026/g, "&");
  }
  expect(url).toContain("/api/auth/callback?token=");
  await page.goto(url);
}

test("a stuck conversation flag becomes a downloadable eval case", async ({ browser }) => {
  // Associate: report the orientation thread as stuck.
  const associate = await browser.newContext();
  const a = await associate.newPage();
  await signIn(a, associate.request, ASSOCIATE);
  // Open the orientation thread (another spec may already have moved the session on).
  const start = a.getByRole("listitem").filter({ hasText: "Start here: getting oriented" });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expect(a.getByRole("heading", { name: "Start here: getting oriented" })).toBeVisible();
  await a.getByRole("button", { name: "Stuck or going in circles?" }).click();
  await a.getByLabel("What's going wrong in this conversation?").fill("Marcus keeps asking the same thing and I can't tell what he wants");
  await a.getByRole("button", { name: "Send flag" }).click();
  await expect(a.getByText("Flagged, thank you.")).toBeVisible();
  await associate.close();

  // Admin: the flag is listed as a conversation flag, and its eval case downloads.
  const admin = await browser.newContext();
  const p = await admin.newPage();
  await signIn(p, admin.request, ADMIN);
  await p.goto("/admin/flags");
  const row = p.getByRole("row").filter({ hasText: "Marcus keeps asking the same thing" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("conversation");
  const [download] = await Promise.all([p.waitForEvent("download"), row.getByRole("link", { name: "Eval case" }).click()]);
  const c = JSON.parse(fs.readFileSync((await download.path())!, "utf8"));
  expect(c.version).toBe(1);
  expect(c.flag.targetType).toBe("thread");
  expect(c.flag.note).toContain("Marcus keeps asking");
  expect(c.flagged.from).toBeTruthy();
  expect(c.flagged.body.length).toBeGreaterThan(0);
  expect(c.events.length).toBeGreaterThan(0);
  await admin.close();
});
