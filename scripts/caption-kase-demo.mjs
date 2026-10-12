import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWPORT = { width: 1440, height: 1080 };
// End on the redeemed instrument; the original retains its final mobile check.
const PRESENTATION_END_SECOND = 42;
const CAPTIONS = [
  [0, "LifecycleKASE services tokenized bonds after issuance: coupon, partial redemption and maturity"],
  [4.5, "Coupon: captured holdings 9 / 21 / 5; payments total 1,750 KZT-Test"],
  [10, "The effective cutoff is the finalized snapshot slot and time; later transfers cannot change entitlements"],
  [14.5, "Partial: 7,000 KZT-Test; burn 2 / 4 / 1; supply 35 → 28. Current supply is 0 after later maturity."],
  [20, "Each redemption payment and burn share one transaction; failure rolls both legs back"],
  [25, "Maturity: pay 29,400 KZT-Test including the final coupon and burn all remaining 28 bonds"],
  [34, "Three canonical JSON receipts are hash-committed to Solana ActionReceipt PDAs"],
  [38, "Supply reaches zero; the instrument is REDEEMED. KZT-Test funding and eligibility are simulated."],
];

function parseArguments(argv) {
  const defaults = {
    input: resolve("docs/submission/kase-three-actions.webm"),
    output: resolve("docs/submission/kase-three-actions-captioned.webm"),
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: node scripts/caption-kase-demo.mjs [--input source.webm] [--output captioned.webm]");
    console.log("Environment: KASE_PLAYWRIGHT_MODULE is required; KASE_CHROMIUM_EXECUTABLE optionally selects an installed browser.");
    process.exit(0);
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    defaults[argument.slice(2)] = resolve(value);
    index += 1;
  }
  if (defaults.input === defaults.output) throw new Error("Input and output paths must be different");
  return defaults;
}

async function loadChromium() {
  const modulePath = process.env.KASE_PLAYWRIGHT_MODULE;
  if (!modulePath) {
    throw new Error("Set KASE_PLAYWRIGHT_MODULE to an installed Playwright index.mjs");
  }
  try {
    const { chromium } = await import(pathToFileURL(modulePath).href);
    return chromium;
  } catch (error) {
    throw new Error(`Unable to import Playwright from ${modulePath}: ${error.message}`);
  }
}

function presentationHtml() {
  const serializedCaptions = JSON.stringify(CAPTIONS);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>LifecycleKASE submission demo</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #071019; }
      body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: white; }
      main { width: 100vw; height: 100vh; display: grid; grid-template-rows: 70px 900px 110px; background: #071019; }
      video { display: block; width: 100%; height: 900px; object-fit: contain; background: #071019; }
      .badge {
        display: flex; align-items: center; padding: 0 28px; border-bottom: 1px solid #233648;
        color: #dbeafe; font-size: 21px; font-weight: 650; letter-spacing: .01em;
      }
      .caption-wrap {
        display: flex; justify-content: center; align-items: center; padding: 10px 36px;
        border-top: 1px solid #233648;
      }
      .caption {
        max-width: 1300px;
        color: #f8fafc; font-size: 27px; font-weight: 690; line-height: 1.25; text-align: center;
        text-wrap: balance; text-shadow: 0 1px 2px rgba(0, 0, 0, .7);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="badge">Disposable Solana Localnet · read-only Auditor review · test signers</div>
      <video id="demo" src="/source.webm" muted playsinline preload="auto"></video>
      <div class="caption-wrap"><div id="caption" class="caption"></div></div>
    </main>
    <script>
      const video = document.querySelector("#demo");
      const caption = document.querySelector("#caption");
      const captions = ${serializedCaptions};
      function updateCaption() {
        const current = captions.findLast(([start]) => video.currentTime >= start);
        caption.textContent = current?.[1] || captions[0][1];
        requestAnimationFrame(updateCaption);
      }
      updateCaption();
      window.__presentationReady = new Promise((resolve, reject) => {
        video.addEventListener("canplaythrough", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("Source video could not be decoded")), { once: true });
        video.load();
      });
    </script>
  </body>
</html>`;
}

function sendMedia(request, response, filePath, fileSize) {
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": fileSize,
      "Content-Type": "video/webm",
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") return response.end();
    return createReadStream(filePath).pipe(response);
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
    return response.end();
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  const end = Math.min(requestedEnd, fileSize - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
    response.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
    return response.end();
  }
  response.writeHead(206, {
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Content-Type": "video/webm",
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") return response.end();
  return createReadStream(filePath, { start, end }).pipe(response);
}

async function startPresentationServer(sourcePath) {
  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile() || sourceStats.size === 0) throw new Error(`Source video is empty: ${sourcePath}`);
  const html = presentationHtml();
  const server = createServer((request, response) => {
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(html);
    }
    if (request.url === "/source.webm") return sendMedia(request, response, sourcePath, sourceStats.size);
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())),
  };
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function run() {
  const { input, output } = parseArguments(process.argv.slice(2));
  await stat(input).catch(() => { throw new Error(`Input video does not exist: ${input}`); });
  await mkdir(dirname(output), { recursive: true });

  const chromium = await loadChromium();
  const executablePath = process.env.KASE_CHROMIUM_EXECUTABLE;
  const launchOptions = { headless: true, ...(executablePath ? { executablePath } : {}) };
  // mkdtemp returns an invocation-owned directory; never clean an input/output directory.
  const recordingDirectory = await mkdtemp(join(tmpdir(), "lifecycle-kase-caption-"));
  let browser, server, context;
  try {
    browser = await chromium.launch(launchOptions);
    server = await startPresentationServer(input);
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: recordingDirectory, size: VIEWPORT },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    const videoInfo = await page.evaluate(async () => {
      await window.__presentationReady;
      const video = document.querySelector("#demo");
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    });
    if (!Number.isFinite(videoInfo.duration) || videoInfo.duration <= 0) {
      throw new Error(`Browser reported invalid source duration: ${videoInfo.duration}`);
    }
    if (videoInfo.width !== 1440 || videoInfo.height !== 900 || Math.abs(videoInfo.duration - 44.64) > 0.5) {
      throw new Error("This caption timeline requires the original 1440x900, 44.64-second KASE recording");
    }

    const recordedVideo = page.video();
    await page.evaluate(() => document.querySelector("#demo").play());
    await page.waitForFunction(end => document.querySelector("#demo").currentTime >= end, PRESENTATION_END_SECOND, {
      timeout: PRESENTATION_END_SECOND * 1000 + 20_000,
    });
    await page.evaluate(() => document.querySelector("#demo").pause());
    await page.waitForTimeout(350);
    if (pageErrors.length) throw new Error(`Presentation browser errors: ${pageErrors.join("; ")}`);
    await context.close();
    context = undefined;
    await recordedVideo.saveAs(output);

    const outputStats = await stat(output);
    if (outputStats.size === 0) throw new Error("Playwright produced an empty output video");
    console.log(JSON.stringify({
      input,
      output,
      source: videoInfo,
      presentationEndSecond: PRESENTATION_END_SECOND,
      outputBytes: outputStats.size,
      outputSha256: await sha256(output),
      scope: "CAPTIONED_COPY_OF_READ_ONLY_AUDITOR_VIDEO; NO_FINANCIAL_FLOW_RERUN",
    }, null, 2));
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await rm(recordingDirectory, { recursive: true, force: true });
  }
}

await run().catch(error => {
  console.error(`${basename(process.argv[1])}: ${error.message}`);
  process.exitCode = 1;
});
