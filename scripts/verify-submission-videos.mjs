/** Decode recorded MP4 video/audio and save actual playback samples for review. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(process.argv[2] || ".local-submission-media-20261012");
const manifest = JSON.parse(await readFile(resolve(directory, "render-manifest.json"), "utf8"));
if (!process.env.KASE_PLAYWRIGHT_MODULE) throw new Error("Set KASE_PLAYWRIGHT_MODULE to installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(process.env.KASE_PLAYWRIGHT_MODULE).href);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      return response.end("<!doctype html><html><body style='margin:0;background:#10251d'><video id='v' style='width:1920px;height:1080px' muted></video></body></html>");
    }
    const path = resolve(directory, `.${decodeURIComponent(pathname)}`);
    if (!path.startsWith(directory + sep)) throw new Error("Outside video directory");
    const bytes = await readFile(path);
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1);
      if (!Number.isSafeInteger(start) || start > end) { response.writeHead(416); return response.end(); }
      response.writeHead(206, { "Content-Type": "video/mp4", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}` });
      response.end(bytes.subarray(start, end + 1));
    } else {
      response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": bytes.length, "Accept-Ranges": "bytes" });
      response.end(bytes);
    }
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const results = [];
try {
  for (const item of manifest.videos) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(origin);
    const metadata = await page.evaluate(async ({ name, expected }) => {
      const video = document.getElementById("v"); video.src = `/${name}`;
      await new Promise((resolveReady, reject) => { video.onloadeddata = resolveReady; video.onerror = reject; });
      // Fragmented MP4 initially advertises only its first fragment. Wait for
      // complete progressive demuxing before checking duration or seeking.
      await new Promise((resolveComplete, reject) => {
        const deadline = performance.now() + 15000;
        const check = setInterval(() => {
          if (Number.isFinite(video.duration) && Math.abs(video.duration - expected) < 1) {
            clearInterval(check); resolveComplete();
          } else if (performance.now() > deadline) {
            clearInterval(check); reject(new Error(`Incomplete MP4 duration: ${video.duration}`));
          }
        }, 100);
      });
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await (await fetch(`/${name}`)).arrayBuffer());
      const samples = decoded.getChannelData(0);
      let squareSum = 0, peak = 0, nonzero = 0;
      for (const sample of samples) {
        squareSum += sample * sample; peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) > 0.002) nonzero++;
      }
      const info = { videoSeconds: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight, audioSeconds: decoded.duration, audioChannels: decoded.numberOfChannels, audioSampleRate: decoded.sampleRate, audioRms: Math.sqrt(squareSum / samples.length), audioPeak: peak, audibleFraction: nonzero / samples.length };
      await context.close(); return info;
    }, { name: item.output, expected: item.duration });
    const limit = item.id === "pitch" ? 120 : 180;
    if (metadata.videoWidth !== 1920 || metadata.videoHeight !== 1080 || !Number.isFinite(metadata.videoSeconds) || metadata.videoSeconds > limit || Math.abs(metadata.videoSeconds - item.duration) > 1 || Math.abs(metadata.audioSeconds - item.duration) > 1 || metadata.audioRms < 0.005 || metadata.audioPeak > 1) {
      throw new Error(`Invalid ${item.id} playback metadata: ${JSON.stringify(metadata)}`);
    }
    const points = item.id === "demo" ? [2, 43, 67, 93, 114, 133, metadata.videoSeconds - 2] : [2, 40, 74, metadata.videoSeconds - 2];
    for (const point of points) {
      await page.evaluate(async seconds => {
        const video = document.getElementById("v"); video.currentTime = seconds;
        await new Promise(resolveSeek => video.onseeked = resolveSeek);
        await new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
      }, point);
      await page.screenshot({ path: resolve(directory, `${item.id}-playback-${point.toFixed(0)}s.png`) });
    }
    const bytes = await readFile(resolve(directory, item.output));
    results.push({ id: item.id, file: item.output, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...metadata, sampledPlaybackSeconds: points });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
  await writeFile(resolve(directory, "video-verification.json"), JSON.stringify({ checkedAt: new Date().toISOString(), scope: "LOCAL_MP4_DECODE_AUDIO_WAVEFORM_AND_SAMPLED_PLAYBACK; NO_HOST_UPLOAD", results }, null, 2));
} finally {
  await browser.close(); await new Promise(resolveClose => server.close(resolveClose));
}
