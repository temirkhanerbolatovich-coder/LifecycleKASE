/** Record the running application's real QA interactions, without wallet/API writes.
 * Uses installed Playwright/Chrome and the existing production web build.
 * KASE_QA_CAPTURE_URL defaults to an isolated localhost:3033/qa server.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(process.argv[2] || ".local-submission-media-20261012");
const url = process.env.KASE_QA_CAPTURE_URL || "http://127.0.0.1:3033/qa";
const target = new URL(url);
if (target.pathname !== "/qa") throw new Error("Recording is restricted to the walletless /qa route");
const modulePath = process.env.KASE_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("Set KASE_PLAYWRIGHT_MODULE to installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(modulePath).href);
const manifest = JSON.parse(await readFile(resolve(directory, "render-manifest.json"), "utf8"));
const demo = manifest.videos.find(video => video.id === "demo");
const starts = Array.from({ length: 8 }, (_, index) => demo.entries.find(entry => entry.scene === index + 1).start);
await mkdir(resolve(directory, "capture"), { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 850 },
  recordVideo: { dir: resolve(directory, "capture"), size: { width: 1440, height: 850 } },
  acceptDownloads: true,
});
await context.addCookies([{ name: "lifecyclekase_locale", value: "en", url, sameSite: "Lax" }]);
const page = await context.newPage();
const recording = page.video();
const errors = [], operations = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
const pageStarted = Date.now();
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Overview", exact: true }).waitFor();
  const started = Date.now();
  const waitUntil = async seconds => {
    const remaining = started + seconds * 1000 - Date.now();
    if (remaining < -2500) throw new Error(`Capture operation missed timeline at ${seconds}s`);
    if (remaining > 0) await page.waitForTimeout(remaining);
  };
  async function click(name, at) {
    await waitUntil(at);
    const button = page.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.hover(); await page.waitForTimeout(250); await button.click();
    operations.push({ seconds: (Date.now() - started) / 1000, name });
  }
  await page.screenshot({ path: resolve(directory, "capture", "overview-en.png") });
  await click("Instruments", starts[1] + 0.5);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(directory, "capture", "instruments-en.png") });
  await click("Investors", starts[1] + 8);
  for (let actionIndex = 0; actionIndex < 3; actionIndex++) {
    const at = starts[2 + actionIndex];
    const length = starts[3 + actionIndex] - at;
    const step = length / 15;
    await waitUntil(at);
    const selected = `20000000-0000-4000-8000-00000000000${actionIndex + 1}`;
    await page.evaluate(id => { window.location.hash = `actions?selected=${id}`; }, selected);
    await page.getByRole("button", { name: "Schedule action", exact: true }).waitFor();
    for (const [index, name] of ["Schedule action", "Capture holders", "Calculate entitlements", "Submit for approval", "Fund test budget", "Reserve budget"].entries()) {
      await click(name, at + (index + 1) * step);
    }
    await waitUntil(at + 7 * step);
    await page.locator("select").nth(1).selectOption("APPROVER");
    operations.push({ seconds: (Date.now() - started) / 1000, name: `Distinct APPROVER, action ${actionIndex + 1}` });
    await click("Approve calculation", at + 8 * step);
    await waitUntil(at + 9 * step);
    await page.locator("select").nth(1).selectOption("ISSUER");
    for (let index = 0; index < 3; index++) await click("Pay the next holder", at + (10 + index) * step);
    await click("Finalize action and create receipt", at + 13 * step);
    await page.screenshot({ path: resolve(directory, "capture", `action-${actionIndex + 1}-finalized-en.png`) });
  }
  await waitUntil(starts[5]);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download QA receipt", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(resolve(directory, "capture", "maturity-qa-receipt.json"));
  operations.push({ seconds: (Date.now() - started) / 1000, name: "Download simulated receipt" });
  await page.screenshot({ path: resolve(directory, "capture", "finalized-en.png") });
  await waitUntil(starts[5] + 3);
  await page.locator("select").nth(1).selectOption("AUDITOR");
  await click("Transactions", starts[5] + 6);
  await click("Audit", starts[5] + 11);
  await page.screenshot({ path: resolve(directory, "capture", "auditor-history-en.png") });
  await waitUntil(starts[6] + 1);
  if (errors.length) throw new Error(errors.join("; "));
  const result = { scope: "RECORDED_RUNNING_QA_APP; PAGE_LOCAL_SIMULATION; NO_WALLET_API_DB_RPC_WRITE", url, viewport: { width: 1440, height: 850 }, captureOffsetSeconds: (started - pageStarted) / 1000, capturedSeconds: (Date.now() - started) / 1000, operations, errors };
  await context.close();
  await recording.saveAs(resolve(directory, "qa-interactive-en.webm"));
  await writeFile(resolve(directory, "qa-capture-results.json"), JSON.stringify(result, null, 2));
  demo.footageOffset = result.captureOffsetSeconds;
  await writeFile(resolve(directory, "render-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
