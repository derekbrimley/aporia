import fs from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Associate smoke test against a running web server + worker (mock LLM, test mode).
 * Covers sign-in, orientation (M1), the term sheet arriving (M2), the document
 * panel, and the at-send sheet on the first deliverable.
 */
const LOG = process.env.WEB_LOG ?? "/tmp/web.log";
const shots = process.env.SHOTS_DIR ?? "/tmp/shots";
const EMAIL = process.env.E2E_EMAIL ?? "associate@dev-firm.example";

test("associate plays orientation and sends term sheet comments", async ({ page, request }) => {
  fs.mkdirSync(shots, { recursive: true });
  // Magic link: request it, then read the URL the server logged (no email provider configured).
  const before = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").length : 0;
  await request.post("/api/auth/magic-link", { data: { email: EMAIL } });
  let url = "";
  for (let i = 0; i < 20 && !url; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const tail = fs.readFileSync(LOG, "utf8").slice(before);
    const m = tail.match(/"url":"([^"]+)"/);
    if (m) url = m[1]!.replace(/\\u0026/g, "&");
  }
  expect(url).toContain("/api/auth/callback?token=");
  await page.goto("/sign-in");
  await page.screenshot({ path: `${shots}/1-sign-in.png` });
  await page.goto(url);
  await expect(page).toHaveURL(/\/$/);

  // M1: welcome email from Marcus.
  await expect(page.getByRole("heading", { name: "Start here: getting oriented" })).toBeVisible({ timeout: 30_000 });
  const convo = page.getByRole("region", { name: "Conversation" });
  await expect(convo.getByText("Welcome aboard. I'm Marcus")).toBeVisible();
  await page.screenshot({ path: `${shots}/2-first-inbox.png` });

  // Reply -> self-check arrives over the live connection.
  await page.getByRole("button", { name: "Reply" }).click();
  await page.getByLabel("Email body").fill("Thanks Marcus, I've read this and I'm ready for the questions.");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect(convo.getByText("Three questions, in your own words")).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: `${shots}/3-self-check.png` });

  await page.getByRole("button", { name: "Reply" }).click();
  await page.getByLabel("Email body").fill("1. The lender is underwriting the equity round behind the company. 2. IP is where the value sits; equipment is replaceable. 3. Gating Tranche 1 on the Series C protects the Bank from funding a company that cannot raise.");
  await page.getByRole("button", { name: /^Send/ }).click();

  // M2: Priya's term sheet lands (handoff first, then the client email).
  const termSheetThread = page.getByRole("listitem").filter({ hasText: "Halden Bank term sheet" });
  await expect(termSheetThread).toBeVisible({ timeout: 60_000 });
  await termSheetThread.click();
  await expect(convo.getByText("We haven't signed anything yet")).toBeVisible();
  await page.screenshot({ path: `${shots}/4-term-sheet-arrives.png` });

  // Open the attachment in the document panel.
  await page.getByRole("button", { name: /Term sheet/ }).first().click();
  await expect(page.getByRole("region", { name: "Documents" }).getByRole("heading", { name: "Summary of Terms" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("combobox", { name: "Contents" }).selectOption("Section 6");
  await page.screenshot({ path: `${shots}/5-document-panel.png` });

  // Quote in reply via selection, then the deliverable.
  await page.getByRole("button", { name: "Reply" }).click();
  await page.evaluate(() => {
    const el = document.querySelector('.deal-document [data-ref="Section 6"] p');
    if (!el) return;
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Quote in reply" }).click();
  await expect(convo.getByText("From Term sheet · Section 6")).toBeVisible();
  await page.getByLabel("Email body").fill(
    "Priya, a few thoughts on the Halden term sheet. First, Tranche 2 turns on revenue but the sheet never says how revenue is defined or measured, when it is tested, or what happens if we narrowly miss, so we should ask for the definition (GAAP vs contracted, trailing vs annualized) before anyone signs. Second, on collateral, please confirm the IP exclusion matches what the company expects; banks usually ask for a negative pledge on IP or a lien on IP proceeds in its place, so we should expect that in the loan agreement. Third, the covenants are left as 'customary to be agreed', which is where a minimum cash covenant will land, and given our burn that needs to be sized against the Series C timing. My recommendation is to ask what the company needs most before we respond.",
  );
  await page.screenshot({ path: `${shots}/6-compose-with-quote.png` });
  await page.getByRole("button", { name: /^Send/ }).click();

  // At-send sheet: rationale required at the decision point.
  const sheet = page.getByRole("dialog", { name: "Why are you sending this?" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole("button", { name: "Send email" })).toBeDisabled();
  await page.screenshot({ path: `${shots}/7-at-send-sheet.png` });
  await sheet.getByLabel("Your reasoning").fill("Priya is not a lawyer and wants to know what each point means for the business; the revenue definition and the cash covenant are what could hurt the company, so I led with those and asked her priorities before recommending a signature.");
  await sheet.getByRole("button", { name: "Send email" }).click();
  await expect(sheet).toBeHidden();
  await expect(convo.getByText("Your reasoning · Not part of the email")).toBeVisible();

  // Socratic follow-up from Marcus on the same thread.
  await expect(convo.getByText("A few questions before we go back to the client")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${shots}/8-socratic-follow-up.png`, fullPage: false });

  // Tester flag control exists on a character email and sends nothing to characters.
  await expect(page.getByRole("button", { name: "Flag as unrealistic" }).first()).toBeVisible();
});
