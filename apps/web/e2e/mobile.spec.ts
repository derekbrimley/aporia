import fs from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The associate's inbox at phone width: one pane at a time, a back bar and the browser's back
 * button between them, a reply composer that fits, and no sideways scrolling. Reads only, so it
 * leaves the shared session as it found it.
 */
const LOG = process.env.WEB_LOG ?? "/tmp/web.log";
const ASSOCIATE = process.env.E2E_EMAIL ?? "associate@dev-firm.example";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

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
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in") && !u.pathname.startsWith("/api/auth"), { timeout: 30_000 });
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the inbox works one pane at a time on a phone", async ({ page, request }) => {
  await signIn(page, request, ASSOCIATE);
  const list = page.getByRole("region", { name: "Threads" });
  const convo = page.getByRole("region", { name: "Conversation" });

  // The list comes first, on its own.
  const start = page.getByRole("listitem").filter({ hasText: "Start here: getting oriented" });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await expect(convo).toBeHidden();
  expect(await noSidewaysScroll(page)).toBe(true);

  // Tapping a thread shows only the conversation.
  await start.tap();
  await expect(convo.getByRole("heading", { name: "Start here: getting oriented" })).toBeVisible();
  await expect(list).toBeHidden();
  expect(await noSidewaysScroll(page)).toBe(true);

  // Reply opens a composer that fits the screen, with Send in reach.
  await convo.getByRole("button", { name: "Reply", exact: true }).first().tap();
  await expect(page.getByLabel("Email body")).toBeFocused();
  await expect(convo.getByRole("button", { name: /^Send/ })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await convo.getByRole("button", { name: "Discard" }).tap();

  // The back bar returns to the list; the browser's back button does too.
  await convo.getByRole("button", { name: "Inbox" }).tap();
  await expect(list).toBeVisible();
  await start.tap();
  await expect(convo).toBeVisible();
  await page.goBack();
  await expect(list).toBeVisible();
  await expect(convo).toBeHidden();
});
