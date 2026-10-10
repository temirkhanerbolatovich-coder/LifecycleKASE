import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

async function demoBrowser() {
  const modulePath = process.env.KASE_PLAYWRIGHT_MODULE;
  if (!modulePath) throw new Error("Video capture requires KASE_PLAYWRIGHT_MODULE pointing to an installed Playwright module");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  return chromium.launch({ headless: true, ...(process.env.KASE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.KASE_CHROMIUM_EXECUTABLE } : {}) });
}

if (process.argv[2] === "--check-browser") {
  const browser = await demoBrowser();
  try {
    const dir = fileURLToPath(new URL("../generated/browser-preflight-" + randomUUID() + "/", import.meta.url));
    const context = await browser.newContext({ recordVideo: { dir, size: { width: 320, height: 240 } } });
    try { const page = await context.newPage(); assert.equal(await page.evaluate(() => 1 + 1), 2); }
    finally { await context.close(); }
  }
  finally { await browser.close(); }
  console.log("PASS installed demo browser and video encoder preflight");
}

/** Optional real UI capture against the still-running disposable API and database. */
export async function captureKaseDemo({ host, cookie, evidence }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Reload the helper between retries; the disposable API/ledger remain available.
      const module = await import(new URL("./capture-kase-demo.mjs?attempt=" + Date.now(), import.meta.url).href);
      return await module.captureKaseDemoOnce({ host, cookie, evidence });
    } catch (error) {
      if (attempt === 3) throw error;
      console.error("Browser capture attempt", attempt, "failed:", error.message, "Retrying in45seconds; financial transactions are not rerun.");
      await new Promise(resolve => setTimeout(resolve, 45_000));
    }
  }
}

export async function captureKaseDemoOnce({ host, cookie, evidence }) {
  const directory = fileURLToPath(new URL("../generated/kase-video-" + randomUUID() + "/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const log = createWriteStream(directory + "web.log");
  const server = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "dev", "--webpack", "--port", "13060", "--hostname", "127.0.0.1"], {
    cwd: fileURLToPath(new URL("../apps/web/", import.meta.url)), env: { ...process.env, API_SERVER_URL: host, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  server.stdout.pipe(log); server.stderr.pipe(log);
  let browser, context, page;
  try {
    const url = "http://localhost:13060";
    const deadline = Date.now() + 120_000;
    while (true) {
      if (server.exitCode !== null) throw new Error("Disposable web server exited; inspect generated web.log");
      try { if ((await fetch(url + "/dashboard", { signal: AbortSignal.timeout(15_000) })).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error("Disposable web server did not become ready");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    browser = await demoBrowser();
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: directory, size: { width: 1440, height: 900 } }, acceptDownloads: true });
    const separator = cookie.indexOf("=");
    await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url, httpOnly: true, sameSite: "Strict" }]);
    page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url + "/dashboard#actions", { waitUntil: "networkidle" });
    await page.getByText("KASE demo AUDITOR", { exact: true }).waitFor();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: directory + "actions-desktop.png", fullPage: true });
    const downloaded = [];
    for (const [index, action] of evidence.actions.entries()) {
      await page.goto(url + "/dashboard#actions?selected=" + action.actionId, { waitUntil: "networkidle" });
      const button = page.getByRole("button", { name: "Скачать итоговый документ JSON", exact: true });
      await button.waitFor({ timeout: 30_000 });
      await button.scrollIntoViewIfNeeded();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: directory + action.type.toLowerCase() + ".png", fullPage: true });
      const downloadPromise = page.waitForEvent("download"); await button.click();
      const download = await downloadPromise, path = directory + index + "-receipt.json";
      await download.saveAs(path);
      assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), action.receiptHash);
      downloaded.push({ type: action.type, path, sha256: action.receiptHash });
      await page.getByRole("tab", { name: "Условия и источник" }).click();
      await page.getByText("Фактическая фиксация", { exact: false }).filter({ visible: true }).first().waitFor();
      await page.waitForTimeout(4000);
    }
    await page.goto(url + "/dashboard#instruments?selected=" + evidence.instrumentId, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: directory + "redeemed-instrument.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + "/dashboard#actions?selected=" + evidence.actions[2].actionId, { waitUntil: "networkidle" });
    // Workspace deliberately preserves the detail tab while switching sections.
    await page.getByRole("tab", { name: "Работа с действием", exact: true }).click();
    await page.getByRole("button", { name: "Скачать итоговый документ JSON", exact: true }).waitFor();
    await page.screenshot({ path: directory + "maturity-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "Mobile viewport must not overflow");
    assert.deepEqual(errors, [], "Browser runtime errors");
    const video = page.video(); await context.close(); context = null;
    const videoPath = directory + "kase-three-actions.webm"; await video.saveAs(videoPath);
    console.log("PASS real browser UI, all three receipt downloads, desktop/mobile, no page errors; video:", videoPath);
    return { videoPath, directory, downloaded, scope: "READ_ONLY_AUDITOR_UI; actions executed by disposable test signers, not Phantom" };
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: directory + "capture-failure.png", fullPage: true }).catch(() => {});
    console.error("Browser diagnostics:", directory);
    throw error;
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    if (process.platform === "win32" && server.exitCode === null) {
      spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else server.kill();
    server.stdout.unpipe(log); server.stderr.unpipe(log); log.end();
  }
}
