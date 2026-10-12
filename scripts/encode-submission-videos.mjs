/** Encode prepared local frames and narration with Chrome's H.264/AAC recorder.
 * Required environment: KASE_PLAYWRIGHT_MODULE points to an installed index.mjs.
 * Optional: KASE_CHROMIUM_EXECUTABLE; otherwise use installed Chrome.
 * No remote request, wallet, existing browser profile, or application state.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, appendFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(process.argv[2] || ".local-submission-media-20261012");
const manifest = JSON.parse(await readFile(resolve(directory, "render-manifest.json"), "utf8"));
const modulePath = process.env.KASE_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("KASE_PLAYWRIGHT_MODULE must point to installed Playwright index.mjs");
const { chromium } = await import(pathToFileURL(modulePath).href);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><html><body style='margin:0;background:#10251d'><canvas id='video'></canvas></body></html>");
      return;
    }
    const file = resolve(directory, `.${pathname}`);
    if (!file.startsWith(directory + sep)) throw new Error("Outside media directory");
    const content = await readFile(file);
    const mime = { ".png": "image/png", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".webm": "video/webm" }[extname(file)] || "application/octet-stream";
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || content.length - 1), content.length - 1);
      if (!Number.isSafeInteger(start) || start > end) { response.writeHead(416); return response.end(); }
      response.writeHead(206, { "Content-Type": mime, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${content.length}` });
      response.end(content.subarray(start, end + 1));
    } else {
      response.writeHead(200, { "Content-Type": mime, "Content-Length": content.length, "Accept-Ranges": "bytes" });
      response.end(content);
    }
  } catch {
    response.writeHead(404); response.end("Not found");
  }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.KASE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.KASE_CHROMIUM_EXECUTABLE } : { channel: "chrome" }),
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});

async function encode(video) {
  const page = await browser.newPage({ viewport: { width: manifest.width, height: manifest.height } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const output = resolve(directory, video.output);
  await writeFile(output, Buffer.alloc(0));
  let chunkWrites = Promise.resolve();
  await page.exposeFunction("saveMediaChunk", encoded => {
    chunkWrites = chunkWrites.then(() => appendFile(output, Buffer.from(encoded, "base64")));
    return chunkWrites;
  });
  await page.goto(origin);
  const info = await page.evaluate(async ({ video, manifest }) => {
    const mimeType = "video/mp4;codecs=avc1.42001E,mp4a.40.2";
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("Installed Chrome cannot encode required MP4 codecs");
    const canvas = document.getElementById("video");
    canvas.width = manifest.width; canvas.height = manifest.height;
    const context = canvas.getContext("2d", { alpha: false });
    const frames = await Promise.all(video.entries.map(entry => new Promise((resolveImage, reject) => {
      const frame = new Image();
      frame.onload = () => resolveImage(frame); frame.onerror = reject; frame.src = `/${entry.frame}`;
    })));
    let footage;
    if (video.footage) {
      footage = document.createElement("video");
      footage.muted = true; footage.preload = "auto"; footage.src = `/${video.footage}`;
      await new Promise((resolveReady, reject) => { footage.onloadeddata = resolveReady; footage.onerror = reject; });
      footage.currentTime = video.footageOffset || 0;
      await new Promise(resolveSeek => footage.onseeked = resolveSeek);
    }
    const audioContext = new AudioContext({ sampleRate: 48000 });
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    const speechClips = [];
    let narration;
    if (video.narrationClips) {
      if (video.narrationClips.length !== video.entries.length) throw new Error("A narration clip is required for every caption");
      for (const [index, clip] of video.narrationClips.entries()) {
        const entry = video.entries[index];
        if (clip.start !== entry.start || clip.duration !== entry.duration || entry.duration <= 0.15) {
          throw new Error("Speech clip/caption timeline mismatch");
        }
        const element = new Audio(); element.preload = "auto";
        await new Promise((resolveReady, reject) => {
          element.oncanplaythrough = resolveReady; element.onerror = () => reject(new Error(`Speech clip could not load: ${clip.file}`));
          element.src = `/${clip.file}`;
        });
        if (!Number.isFinite(element.duration) || element.duration <= 0) throw new Error("Invalid speech duration");
        const rate = Math.max(1, element.duration / (entry.duration - 0.15));
        if (rate > 1.15) throw new Error(`Speech needs excessive acceleration: ${clip.file}`);
        // Media elements preserve the narrator's pitch while fitting each existing caption window.
        element.preservesPitch = true; element.playbackRate = rate;
        const node = audioContext.createMediaElementSource(element); node.connect(destination);
        speechClips.push({ element, node, start: clip.start, duration: element.duration, rate, file: clip.file });
      }
      // A silent buffer gives audio and video one deterministic completion clock.
      narration = audioContext.createBuffer(1, Math.round(video.duration * 48000), 48000);
    } else {
      narration = await audioContext.decodeAudioData(await (await fetch(`/${video.audio}`)).arrayBuffer());
      if (Math.abs(narration.duration - video.duration) > 0.03) throw new Error("Narration/timeline mismatch");
    }
    const source = audioContext.createBufferSource(); source.buffer = narration; source.connect(destination);
    const stream = canvas.captureStream(manifest.fps);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4500000, audioBitsPerSecond: 128000 });
    const writes = [];
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      writes.push((async () => {
        const bytes = new Uint8Array(await event.data.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
        await window.saveMediaChunk(btoa(binary));
      })());
    };
    const completion = new Promise(resolveStop => recorder.onstop = resolveStop);
    context.drawImage(frames[0], 0, 0);
    const start = audioContext.currentTime + 0.15;
    const speechErrors = [], speechStarts = [];
    let nextSpeech = 0, footageStarted = false;
    let last = -1;
    const paint = setInterval(() => {
      const seconds = Math.max(0, audioContext.currentTime - start);
      if (audioContext.currentTime >= start) {
        if (footage && !footageStarted) {
          footageStarted = true; footage.play().catch(error => speechErrors.push(`Footage playback: ${error.message}`));
        }
        // Wall-clock timers can drift from the audio render clock on busy desktops.
        while (nextSpeech < speechClips.length && seconds >= speechClips[nextSpeech].start) {
          const clip = speechClips[nextSpeech++];
          clip.element.play().then(() => speechStarts.push({ file: clip.file, planned: clip.start,
            actual: audioContext.currentTime - start, rawDuration: clip.duration, rate: clip.rate }))
            .catch(error => speechErrors.push(`${clip.file}: ${error.message}`));
        }
      }
      let index = video.entries.findLastIndex(entry => seconds >= entry.start);
      if (index < 0) index = 0;
      // Draw on every tick so the canvas stream includes continuous timestamps.
      context.drawImage(frames[index], 0, 0);
      if (footage && video.entries[index].footage) {
        const scale = Math.min(1792 / footage.videoWidth, 718 / footage.videoHeight);
        const width = footage.videoWidth * scale, height = footage.videoHeight * scale;
        context.drawImage(footage, (1920 - width) / 2, 157 + (718 - height) / 2, width, height);
      }
      last = index;
    }, 1000 / manifest.fps);
    recorder.start(1000); source.start(start);
    await new Promise(resolveEnd => source.onended = resolveEnd);
    speechClips.forEach(clip => { clip.element.pause(); clip.node.disconnect(); });
    clearInterval(paint);
    context.drawImage(frames.at(-1), 0, 0);
    recorder.stop(); await completion; await Promise.all(writes);
    for (const track of stream.getTracks()) track.stop();
    await audioContext.close();
    const maxSpeechStartError = Math.max(0, ...speechStarts.map(clip => Math.abs(clip.actual - clip.planned)));
    if (speechErrors.length || speechStarts.length !== speechClips.length || maxSpeechStartError > 0.15) {
      throw new Error(`Speech playback failed: ${speechErrors.join("; ")}; ${speechStarts.length}/${speechClips.length} clips started; maximum clock drift ${maxSpeechStartError.toFixed(3)}s`);
    }
    return { mimeType: recorder.mimeType, audioSeconds: narration.duration, lastCaption: last + 1,
      chunks: writes.length, ...(speechClips.length ? { narrationVoice: video.narrationVoice, maxSpeechStartError, speechStarts } : {}) };
  }, { video, manifest });
  await chunkWrites;
  if (errors.length) throw new Error(errors.join("; "));
  await page.close();
  const bytes = await readFile(output);
  const result = { output, bytes: (await stat(output)).size, sha256: createHash("sha256").update(bytes).digest("hex"), ...info };
  console.log(JSON.stringify(result));
  return result;
}

try {
  // Independent local recordings run together; each has its own page/audio stream.
  const results = await Promise.all(manifest.videos.map(encode));
  await writeFile(resolve(directory, "encode-results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
