#!/usr/bin/env node
/*
  Проверка автомонтажа: `npm run test:montage` (нужен нативный ffmpeg в PATH).

  1. Чистые функции из ../args.ts (Node исполняет .ts напрямую).
  2. Генерирует тестовые клипы, реплики, музыку и картинки (ffmpeg -f lavfi).
  3. Прогоняет сценарий монтажа ../pipeline.ts — тот же код, что в браузере, — через два
     бэкенда: нативный ffmpeg и то же ядро @ffmpeg/core (wasm, ffmpeg 5.1), что грузит браузер.
     Пути относительные, поэтому списки аргументов в обоих совпадают байт в байт (проверяется).
  4. Проверяет результат нативным ffprobe/ffmpeg: размеры, кадры, длительности, место реплики
     (0,3 с; у «говорящей головы» — 0 с), стоп-кадр, субтитр и метку на кадре, поля у горизонтального клипа, титр,
     громкость музыки (−10 dB) и приглушение под репликой (ещё −6 dB), faststart.
  5. Сверяет файлы ядра в public/ffmpeg с node_modules и закреплёнными sha256.

  Флаги: --native-only (без wasm), --keep (не удалять временный каталог).
*/
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Код приложения импортирует "./args" без расширения (так принято в Next.js) — подставляем .ts
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (/^\.\.?\//.test(specifier) && !path.extname(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const args = await import("../args.ts");
const { runPipeline } = await import("../pipeline.ts");
const { CORE_FILES } = await import("../core-files.ts");
const {
  FONTS_DIR,
  FONT_FILE,
  LIMITS,
  MUSIC_LEVEL_DB,
  OUTPUT,
  TIMING,
  alignDown,
  alignUp,
  assEscape,
  assTime,
  cleanText,
  dbToGain,
  duckExpression,
  parseProbeLog,
  planMontage,
  planScene,
  sceneAudioGraph,
} = args;

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const flags = new Set(process.argv.slice(2));

let failures = 0;
let passes = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}${detail && flags.has("--verbose") ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ---------- 1. чистые функции ----------

console.log("\n# Чистые функции");
check("alignUp 5.01 → 5.0833", near(alignUp(5.01), 61 / 12, 1e-9));
check("alignDown 5.04 → 5", alignDown(5.04) === 5);
check("alignUp keeps exact multiples", alignUp(2.5) === 2.5);
check("assTime", assTime(3725.456) === "1:02:05.46", assTime(3725.456));
check("cleanText strips emoji and newlines", cleanText("Привет 🔥\nмир  {x}", 100) === "Привет мир {x}", cleanText("Привет 🔥\nмир  {x}", 100));
check("cleanText keeps Romanian/quotes/ellipsis", cleanText("«Ура» — șansă…", 100) === "«Ура» — șansă…");
check("cleanText truncates with ellipsis", cleanText("а".repeat(200), 10) === `${"а".repeat(9)}…`);
check("assEscape kills tags", assEscape("{\\b1}x\\N") === "(/b1)x/N", assEscape("{\\b1}x\\N"));

{
  const nativeLog = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:05.04, start: 0.000000, bitrate: 1156 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 480x864 [SAR 1:1 DAR 5:9], 1152 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 69 kb/s (default)`;
  const p = parseProbeLog(nativeLog);
  check("parseProbeLog video+audio", p.duration === 5.04 && p.hasVideo && p.hasAudio && p.width === 480 && p.height === 864, JSON.stringify(p));
  const mp3 = parseProbeLog(`Input #0, mp3, from 'v.mp3':
  Duration: 00:00:02.51, start: 0.025057, bitrate: 64 kb/s
  Stream #0:0: Audio: mp3, 24000 Hz, mono, fltp, 64 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 300x300, 90k tbr, 90k tbn (attached pic)`);
  check("parseProbeLog ignores mp3 cover art", !mp3.hasVideo && mp3.hasAudio && mp3.duration === 2.51, JSON.stringify(mp3));
}

const SETTINGS = { label: true, subtitles: true, clipAudio: false, kenBurns: true, music: true, title: null };
{
  const video = (duration, extra = {}) => ({ kind: "video", duration, width: 480, height: 864, hasAudio: false, ...extra });
  const r = planMontage(
    [
      { source: video(5.04), line: { duration: 2.5 }, subtitle: "Раз" },
      { source: video(5.04), line: { duration: 6.2 }, subtitle: "Два" },
      { source: { kind: "image", duration: null, width: 1024, height: 1536, hasAudio: false }, line: null, subtitle: "Три" },
    ],
    { ...SETTINGS, title: { title: "Серия 1", authors: "lisa", position: "end" } },
  );
  check("plan ok", r.ok);
  const s = r.plan.segments;
  check("plan: 4 segments, title last", s.length === 4 && s[3].type === "title");
  check("plan: clip without long line keeps 5 s", s[0].duration === 5 && s[0].freeze === 0);
  check(
    "plan: long line extends clip by freeze",
    near(s[1].duration, alignUp(TIMING.lineOffset + 6.2 + TIMING.lineTail), 1e-9) && s[1].freeze > 1.5,
    `${s[1].duration} ${s[1].freeze}`,
  );
  check("plan: image is 5 s with Ken Burns", s[2].duration === TIMING.imageSeconds && s[2].kenBurns && s[2].fit === "cover");
  check("plan: starts are cumulative", near(s[2].start, s[0].duration + s[1].duration, 1e-9));
  check("plan: frames and samples are whole", s.every((x) => Number.isInteger(x.duration * 24) && Number.isInteger(x.duration * 44100)));
  check("plan: duck windows at line positions", r.plan.duckWindows.length === 2 && near(r.plan.duckWindows[1].start, s[1].start + 0.3, 1e-9));
  check("plan: subtitle without voice spans the scene", s[2].subtitle && s[2].subtitle.end > 4.5);
  check("plan: subtitles off → none", planMontage([{ source: video(5), line: null, subtitle: "x" }], { ...SETTINGS, subtitles: false }).plan.segments[0].subtitle === null);

  // «Говорящая голова» (lipsync): губы сделаны по реплике с 0 с — реплика и субтитр без задержки 0,3 с
  {
    const talking = planMontage(
      [
        { source: video(5.04), line: { duration: 2.5 }, subtitle: "Раз" },
        { source: video(3.04, { talking: true }), line: { duration: 2.9 }, subtitle: "Голова" },
        { source: video(5.04, { talking: true }), line: null, subtitle: "Без реплики" },
        { source: { kind: "image", duration: null, width: 1024, height: 1536, hasAudio: false, talking: true }, line: { duration: 2 }, subtitle: "Кадр" },
      ],
      SETTINGS,
    );
    const [normal, head, silent, image] = talking.plan.segments;
    check("talking: line starts at 0 s", head.line.start === 0 && near(head.line.end, 2.9, 1e-9), JSON.stringify(head.line));
    check("talking: subtitle starts at 0 s", head.subtitle.start === 0 && near(head.subtitle.end, 2.9 + 0.25, 1e-9), JSON.stringify(head.subtitle));
    check("talking: subtitle without a line also from 0 s", silent.subtitle.start === 0 && silent.line === null, JSON.stringify(silent.subtitle));
    check(
      "talking: scene needs line + tail only (no 0.3 s offset)",
      near(head.duration, alignUp(2.9 + TIMING.lineTail), 1e-9) && near(head.freeze, head.duration - 3, 1e-9),
      `${head.duration} ${head.freeze}`,
    );
    check("talking: audio delay 0 ms", /\[1:a\][^;]*adelay=0\|0,/.test(sceneAudioGraph(head, true)), sceneAudioGraph(head, true));
    check(
      "talking: duck window starts at the scene start",
      talking.plan.duckWindows.length === 3 && near(talking.plan.duckWindows[1].start, head.start, 1e-9) && near(talking.plan.duckWindows[1].end, head.start + 2.9, 1e-9),
      JSON.stringify(talking.plan.duckWindows),
    );
    check(
      "talking: normal clip in the same plan unchanged (0.3 s)",
      normal.line.start === TIMING.lineOffset && normal.subtitle.start === TIMING.lineOffset && near(talking.plan.duckWindows[0].start, TIMING.lineOffset, 1e-9),
      JSON.stringify(normal.line),
    );
    check("talking: ignored for images", image.line.start === TIMING.lineOffset && image.subtitle.start === TIMING.lineOffset, JSON.stringify(image.line));
    const plain = planScene({ source: video(5.04), line: { duration: 2.5 }, subtitle: "Раз" }, SETTINGS, 0, 0);
    const notTalking = planScene({ source: video(5.04, { talking: false }), line: { duration: 2.5 }, subtitle: "Раз" }, SETTINGS, 0, 0);
    check("normal clip: audio delay 300 ms", /\[1:a\][^;]*adelay=300\|300,/.test(sceneAudioGraph(plain, true)), sceneAudioGraph(plain, true));
    check("normal clip: talking:false plans exactly as before", JSON.stringify(plain) === JSON.stringify(notTalking) && plain.line.start === 0.3 && plain.subtitle.start === 0.3);
    check("normal clip: same plan as the first scene above", JSON.stringify({ ...plain, start: 0 }) === JSON.stringify({ ...normal, start: 0 }));
  }

  const many = planMontage(Array.from({ length: LIMITS.maxScenes + 1 }, () => ({ source: video(2), line: null, subtitle: null })), SETTINGS);
  check("plan: too many scenes", !many.ok && many.issue === "too_many_scenes");
  const long = planMontage(Array.from({ length: 7 }, () => ({ source: video(10), line: null, subtitle: null })), SETTINGS);
  check("plan: too long", !long.ok && long.issue === "too_long");
  check("plan: empty", planMontage([], SETTINGS).ok === false);

  const expr = duckExpression([{ start: 1, end: 3 }]);
  const evalExpr = new Function("t", "clip", "min", `return ${expr};`);
  const clip = (x, a, b) => Math.min(b, Math.max(a, x));
  const g = (t) => evalExpr(t, clip, Math.min);
  check("duck: −10 dB outside lines", near(g(0.2), dbToGain(-10), 1e-4) && near(g(5), dbToGain(-10), 1e-4));
  check("duck: −16 dB inside a line", near(g(2), dbToGain(-16), 1e-3), String(g(2)));
  check("duck: smooth ramp before the line", g(0.92) < g(0.86) && g(0.92) > g(1.0));
  check("duck: constant without lines", duckExpression([]) === String(Math.round(dbToGain(-10) * 10000) / 10000));
  check("duck: «Громче» shifts the music by +4 dB", duckExpression([], MUSIC_LEVEL_DB.loud) === String(Math.round(dbToGain(-6) * 10000) / 10000));
  check("duck: «Тише» shifts the music by −4 dB", duckExpression([], MUSIC_LEVEL_DB.quiet) === String(Math.round(dbToGain(-14) * 10000) / 10000));

  // оценка времени: до замера — осторожная скорость, после — реальная
  const { estimate } = await import("../engine.ts");
  const step = (framesDone, segmentDone, encodeSeconds, stage = "render") => ({
    stage, scene: 0, sceneCount: 3, framesDone, segmentFrames: 120, segmentDone, encodeSeconds,
  });
  const before = estimate(step(0, 0, 0), 360, null, 0, 8);
  const measuredEta = estimate(step(120, 0, 4), 360, null, 0, 8); // 30 кадров/с
  check("estimate: fallback speed before the first measurement", near(before.etaSeconds, Math.ceil(360 / 8 + 1 + (360 / 8) * 0.05), 1), JSON.stringify(before));
  check("estimate: measured speed after a segment", near(measuredEta.etaSeconds, Math.ceil(240 / 30 + 1 + (360 / 30) * 0.05), 1), JSON.stringify(measuredEta));
  check("estimate: ratio grows and stays below 1 until done", measuredEta.ratio > before.ratio && estimate(step(360, 0, 12, "final"), 360, null, 0, 8).ratio < 1);
}

// ---------- 2. файлы для теста ----------

const work = fs.mkdtempSync(path.join(os.tmpdir(), "montage-test-"));
const fixtures = path.join(work, "fixtures");
fs.mkdirSync(fixtures);
function ff(argv, opts = {}) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...argv], {
    cwd: opts.cwd ?? work,
    encoding: opts.encoding ?? "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`ffmpeg failed (${r.status}): ${argv.join(" ")}\n${String(r.stderr).slice(-2000)}`);
  return r;
}
const fx = (name) => path.join(fixtures, name);
ff(["-f", "lavfi", "-i", "testsrc2=s=480x864:r=24:d=5.04", "-c:v", "libx264", "-pix_fmt", "yuv420p", fx("clip-a.mp4")]);
ff([
  "-f", "lavfi", "-i", "testsrc=s=1280x720:r=30:d=4", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=4",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fx("clip-b.mp4"),
]);
ff(["-f", "lavfi", "-i", "color=c=0x334455:s=720x1280:r=25:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", fx("clip-c.mp4")]);
ff(["-f", "lavfi", "-i", "sine=f=1000:r=24000:d=2.5", "-c:a", "pcm_s16le", fx("voice-1.wav")]);
ff(["-f", "lavfi", "-i", "sine=f=1000:r=24000:d=6.2", "-c:a", "libmp3lame", "-b:a", "64k", fx("voice-2.mp3")]);
ff(["-f", "lavfi", "-i", "sine=f=220:r=44100:d=20", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", fx("music.mp3")]);
ff(["-f", "lavfi", "-i", "testsrc2=s=1024x1536", "-frames:v", "1", "-update", "1", fx("image-portrait.jpg")]);
ff(["-f", "lavfi", "-i", "mandelbrot=s=1536x1024", "-frames:v", "1", "-update", "1", fx("image-landscape.png")]);
const fontSource = path.join(repo, "public/fonts", FONT_FILE);

// ---------- 3. движок: один и тот же сценарий в двух бэкендах ----------

const media = (file) => ({ source: fx(file), ext: path.extname(file).slice(1) });
const JOB = {
  scenes: [
    { kind: "video", media: media("clip-a.mp4"), line: media("voice-1.wav"), subtitle: "Я хрустящий, мне можно" },
    { kind: "video", media: media("clip-b.mp4"), line: null, subtitle: "Горизонтальный клип с полями" },
    {
      kind: "video",
      media: media("clip-a.mp4"),
      line: media("voice-2.mp3"),
      subtitle: "Длинная реплика — последний кадр стоит, пока герой не договорит",
    },
    { kind: "image", media: media("image-portrait.jpg"), line: null, subtitle: "Картинка с наездом" },
    { kind: "image", media: media("image-landscape.png"), line: media("voice-1.wav"), subtitle: "Широкая картинка {без} наезда \\N 🎬" },
    { kind: "video", media: media("clip-c.mp4"), line: media("voice-1.wav"), subtitle: "Субтитр на ровном фоне" },
    // «Говорящая голова»: реплика и субтитр с 0 с
    { kind: "video", talking: true, media: media("clip-c.mp4"), line: media("voice-1.wav"), subtitle: "Говорящая голова с первого кадра" },
  ],
  music: media("music.mp3"),
  settings: {
    label: true,
    subtitles: true,
    clipAudio: true,
    kenBurns: true,
    title: { title: "На масле. Серия 1", authors: "lisa, mark", position: "end" },
  },
  encode: { preset: "veryfast", crf: 23 },
};
const loadFile = async (source) => new Uint8Array(fs.readFileSync(source));

function nativeBackend(dir) {
  fs.mkdirSync(path.join(dir, FONTS_DIR), { recursive: true });
  fs.copyFileSync(fontSource, path.join(dir, FONTS_DIR, FONT_FILE));
  const argLog = [];
  return {
    name: "native",
    dir,
    argLog,
    async write(name, data) {
      fs.writeFileSync(path.join(dir, name), data);
    },
    async read(name) {
      return new Uint8Array(fs.readFileSync(path.join(dir, name)));
    },
    async remove(name) {
      fs.rmSync(path.join(dir, name), { force: true });
    },
    async exec(argv) {
      argLog.push(argv);
      // как ffmpeg.wasm: ядро само добавляет -nostdin -y
      const r = spawnSync("ffmpeg", ["-nostdin", "-y", ...argv], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { code: r.status ?? 1, log: r.stderr };
    },
    file: (name) => path.join(dir, name),
  };
}

async function wasmBackend(dir) {
  const coreDir = path.join(repo, "node_modules/@ffmpeg/core/dist/esm");
  if (!fs.existsSync(path.join(coreDir, "ffmpeg-core.js"))) return null;
  // Ядро собрано для веб-воркера: в Node хватает self/location и готового wasmBinary
  globalThis.self ??= globalThis;
  globalThis.location ??= { href: `file://${coreDir}/` };
  const { default: createFFmpegCore } = await import(path.join(coreDir, "ffmpeg-core.js"));
  const core = await createFFmpegCore({ wasmBinary: fs.readFileSync(path.join(coreDir, "ffmpeg-core.wasm")) });
  let log = [];
  let onTime = null;
  core.setLogger(({ message }) => log.push(message));
  core.setProgress(({ time }) => onTime?.(time / 1e6));
  core.FS.mkdir("/w");
  core.FS.chdir("/w");
  core.FS.mkdir(FONTS_DIR);
  core.FS.writeFile(`${FONTS_DIR}/${FONT_FILE}`, fs.readFileSync(fontSource));
  fs.mkdirSync(dir, { recursive: true });
  const argLog = [];
  const progress = [];
  return {
    name: "wasm",
    dir,
    argLog,
    progress,
    async write(name, data) {
      core.FS.writeFile(name, data);
    },
    async read(name) {
      return core.FS.readFile(name);
    },
    async remove(name) {
      core.FS.unlink(name);
    },
    async exec(argv, cb) {
      argLog.push(argv);
      log = [];
      onTime = (s) => {
        progress.push(s);
        cb?.(s);
      };
      const code = core.exec(...argv);
      core.reset();
      onTime = null;
      return { code, log: log.join("\n") };
    },
    file(name) {
      const out = path.join(dir, name);
      fs.writeFileSync(out, core.FS.readFile(name));
      return out;
    },
  };
}

async function runMontage(backend) {
  const t0 = Date.now();
  const events = [];
  const result = await runPipeline(backend, loadFile, JOB, { keepFiles: true, onProgress: (p) => events.push(p) });
  const out = path.join(backend.dir, "result.mp4");
  fs.writeFileSync(out, result.data);
  return { ...result, out, ms: Date.now() - t0, events };
}

// ---------- 4. проверки результата ----------

function ffprobeJson(file) {
  return JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }),
  );
}
function pcm(file, { start = 0, end = null, filter = null } = {}) {
  const af = [`atrim=start=${start}${end !== null ? `:end=${end}` : ""}`, ...(filter ? [filter] : [])].join(",");
  const r = ff(["-v", "error", "-i", file, "-af", af, "-ac", "1", "-ar", "44100", "-f", "f32le", "-"], { encoding: "buffer" });
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}
function rmsDb(samples) {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return 10 * Math.log10(sum / samples.length + 1e-20);
}
function grayFrame(file, t) {
  const r = ff(["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    encoding: "buffer",
  });
  return r.stdout;
}
function region(frame, x0, y0, x1, y1) {
  let bright = 0;
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = frame[y * OUTPUT.width + x];
      sum += v;
      count++;
      if (v > 215) bright++;
    }
  }
  return { bright, mean: sum / count };
}
function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
function frameHashes(file) {
  const r = ff(["-v", "error", "-i", file, "-f", "framemd5", "-"]);
  return r.stdout
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(",").pop().trim());
}
function topLevelBoxes(file) {
  const buf = fs.readFileSync(file);
  const boxes = [];
  for (let off = 0; off + 8 <= buf.length && boxes.length < 10; ) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8));
    boxes.push(type);
    if (size < 8) break;
    off += size;
  }
  return boxes;
}

async function verify(backend, result) {
  const { plan } = result;
  const segs = plan.segments;
  console.log(`\n# ${backend.name}: ${segs.length} сегментов, ${plan.duration.toFixed(3)} с, монтаж за ${(result.ms / 1000).toFixed(1)} с`);

  check("probe: clip sizes and audio detected", result.probes[0].width === 480 && result.probes[1].hasAudio && !result.probes[0].hasAudio);
  const files = segs.map((_, i) => ({ video: backend.file(`seg-${i}.mp4`), audio: backend.file(`seg-${i}.wav`) }));
  for (const [i, seg] of segs.entries()) {
    const v = ffprobeJson(files[i].video).streams[0];
    const a = ffprobeJson(files[i].audio).streams[0];
    check(
      `seg ${i}: h264 480×854 yuv420p 24 fps, ${seg.frames} кадров`,
      v.codec_name === "h264" &&
        v.width === 480 &&
        v.height === 854 &&
        v.pix_fmt === "yuv420p" &&
        v.r_frame_rate === "24/1" &&
        Number(v.nb_read_frames) === seg.frames,
      `${v.codec_name} ${v.width}x${v.height} ${v.pix_fmt} ${v.r_frame_rate} frames=${v.nb_read_frames}`,
    );
    check(
      `seg ${i}: wav 44,1 кГц стерео, ровно ${seg.samples} сэмплов`,
      a.codec_name === "pcm_s16le" && a.sample_rate === "44100" && a.channels === 2 && near(Number(a.duration), seg.duration, 1 / 44100 + 1e-6),
      `${a.codec_name} ${a.sample_rate} ${a.channels} ${a.duration}`,
    );
  }

  // реплика начинается через 0,3 с (обычный клип)
  {
    const wav = files[0].audio;
    const before = rmsDb(pcm(wav, { start: 0, end: 0.28 }));
    const during = rmsDb(pcm(wav, { start: 0.35, end: 2.7 }));
    const after = rmsDb(pcm(wav, { start: 2.9, end: 4.9 }));
    check(
      "line starts at 0.3 s (silence before, tone after)",
      before < -60 && during > -25 && after < -60,
      `${before.toFixed(1)} / ${during.toFixed(1)} / ${after.toFixed(1)} dB`,
    );
  }
  // «Говорящая голова» (сцена 6): реплика с 0 с, субтитр с первого кадра, приглушение музыки с начала сцены
  {
    const i = segs.findIndex((s) => s.type === "scene" && s.sceneIndex === 6);
    const seg = segs[i];
    const start = rmsDb(pcm(files[i].audio, { start: 0, end: 0.28 }));
    const after = rmsDb(pcm(files[i].audio, { start: 2.65, end: seg.duration - 0.02 }));
    check(
      "talking: line starts at 0 s (tone from the first sample)",
      seg.line?.start === 0 && start > -25 && after < -60,
      `${start.toFixed(1)} / ${after.toFixed(1)} dB`,
    );
    const head = rmsDb(pcm(files[i].audio, { start: 0, end: 0.01 }));
    check("talking: no 0.3 s silence at the very start", head > -25, `${head.toFixed(1)} dB in the first 10 ms`);
    const sub = region(grayFrame(files[i].video, 0.1), 0, 560, 480, 700);
    check("talking: subtitle burned in from 0 s", sub.bright > 400, `bright px at 0.1 s: ${sub.bright}`);
    check(
      "talking: duck window follows the real line start",
      plan.duckWindows.some((w) => near(w.start, seg.start, 1e-9) && near(w.end, seg.start + 2.5, 0.01)),
      JSON.stringify(plan.duckWindows),
    );
  }
  // свой звук клипа оставлен (clipAudio) и приглушён на 6 dB
  {
    const src = rmsDb(pcm(fx("clip-b.mp4"), { start: 0.5, end: 3.5 }));
    const out = rmsDb(pcm(files[1].audio, { start: 0.5, end: 3.5 }));
    check("clip audio kept at −6 dB", near(out - src, -6, 1), `${(out - src).toFixed(2)} dB`);
  }
  // стоп-кадр: длинная реплика продлевает сцену 2. После конца клипа (5 с) кадр стоит:
  // соседние кадры почти не отличаются (x264 лишь уточняет детали), а в самом клипе — заметно.
  {
    const seg = segs[2];
    const moving = meanAbsDiff(grayFrame(files[2].video, 3.0), grayFrame(files[2].video, 4.0));
    const frozen = meanAbsDiff(grayFrame(files[2].video, 5.3), grayFrame(files[2].video, 6.6));
    check(
      `freeze: сцена ${seg.duration.toFixed(3)} с, после 5 с кадр стоит`,
      seg.duration > 6.5 && seg.freeze > 1.5 && moving > 2 && frozen < moving / 5,
      `разница кадров: в клипе ${moving.toFixed(2)}, в стоп-кадре ${frozen.toFixed(2)}`,
    );
    const lineEnd = rmsDb(pcm(files[2].audio, { start: 6.3, end: 6.45 }));
    check("freeze: long line is not cut", lineEnd > -25, `${lineEnd.toFixed(1)} dB at 6.3–6.45 s`);
  }
  // субтитр и метка видны на ровном фоне (сцена 5), до 0,3 с субтитра нет
  {
    const i = segs.findIndex((s) => s.type === "scene" && s.sceneIndex === 5);
    const early = grayFrame(files[i].video, 0.1);
    const mid = grayFrame(files[i].video, 1.2);
    const subEarly = region(early, 0, 560, 480, 700);
    const subMid = region(mid, 0, 560, 480, 700);
    const label = region(mid, 330, 0, 480, 70);
    check("subtitle burned in after 0.3 s", subEarly.bright < 20 && subMid.bright > 400, `bright px: ${subEarly.bright} → ${subMid.bright}`);
    check("«Сделано с ИИ» label in the top-right corner", label.bright > 80, `bright px: ${label.bright}`);
  }
  // горизонтальный клип — целиком, с чёрными полями сверху и снизу
  {
    const frame = grayFrame(files[1].video, 1.0);
    const top = region(frame, 0, 80, 300, 250);
    const middle = region(frame, 0, 380, 480, 470);
    check("landscape clip is letterboxed", top.mean < 20 && middle.mean > 40, `top ${top.mean.toFixed(1)}, middle ${middle.mean.toFixed(1)}`);
  }
  // наезд на картинку: кадры меняются; широкая картинка без наезда — стоит
  {
    const kb = segs.findIndex((s) => s.type === "scene" && s.sceneIndex === 3);
    const kbHashes = frameHashes(files[kb].video);
    check("Ken Burns: image frames change", new Set(kbHashes).size > kbHashes.length / 2, `${new Set(kbHashes).size}/${kbHashes.length}`);
    const st = segs.findIndex((s) => s.type === "scene" && s.sceneIndex === 4);
    const diff = meanAbsDiff(grayFrame(files[st].video, 0.1), grayFrame(files[st].video, 4.8));
    check("landscape image stays still (contain, no zoom)", segs[st].fit === "contain" && !segs[st].kenBurns && diff < 3, diff.toFixed(2));
  }
  // титр
  {
    const i = segs.findIndex((s) => s.type === "title");
    const frame = grayFrame(files[i].video, 0.7);
    const center = region(frame, 0, 300, 480, 560);
    check("title card: text in the center", i === segs.length - 1 && center.bright > 300, `bright px: ${center.bright}`);
  }

  // итоговый файл
  const out = result.out;
  const info = ffprobeJson(out);
  const v = info.streams.find((s) => s.codec_type === "video");
  const a = info.streams.find((s) => s.codec_type === "audio");
  check(
    `final: ${plan.frames} кадров h264 + aac 44,1 кГц стерео`,
    v && a && v.codec_name === "h264" && Number(v.nb_read_frames) === plan.frames && a.codec_name === "aac" && a.sample_rate === "44100" && a.channels === 2,
    `${v?.codec_name} frames=${v?.nb_read_frames} ${a?.codec_name} ${a?.sample_rate} ${a?.channels}`,
  );
  check("final: duration matches plan", near(Number(info.format.duration), plan.duration, 0.06), `${info.format.duration} vs ${plan.duration}`);
  check("final: audio and video end together", near(Number(a.duration), Number(v.duration), 0.05), `a ${a.duration} v ${v.duration}`);
  const decode = ff(["-v", "error", "-i", out, "-f", "null", "-"], { allowFail: true });
  check("final: decodes without errors", decode.status === 0 && decode.stderr.trim() === "", decode.stderr.slice(0, 300));
  const boxes = topLevelBoxes(out);
  check("final: faststart (moov before mdat)", boxes.indexOf("moov") > -1 && boxes.indexOf("moov") < boxes.indexOf("mdat"), boxes.join(","));
  const mb = fs.statSync(out).size / 1024 / 1024;
  check("final: size is reasonable", mb < 15, `${mb.toFixed(2)} MB`);

  // музыка: −10 dB от исходной вне реплик и ещё −6 dB под репликой (220 Гц — музыка, 1000 Гц — голос)
  {
    const musicBand = "bandpass=f=220:width_type=q:w=4,bandpass=f=220:width_type=q:w=4";
    const source = rmsDb(pcm(fx("music.mp3"), { start: 1, end: 3, filter: musicBand }));
    const sceneStart = (k) => segs.find((s) => s.type === "scene" && s.sceneIndex === k).start;
    const quiet = rmsDb(pcm(out, { start: sceneStart(1) + 1, end: sceneStart(1) + 3, filter: musicBand }));
    const ducked = rmsDb(pcm(out, { start: sceneStart(0) + 0.8, end: sceneStart(0) + 2.4, filter: musicBand }));
    const voice = rmsDb(pcm(out, { start: sceneStart(0) + 0.8, end: sceneStart(0) + 2.4, filter: "bandpass=f=1000:width_type=q:w=4" }));
    check("music at −10 dB outside lines", near(quiet - source, -10, 1.5), `${(quiet - source).toFixed(2)} dB`);
    check("music ducked a further −6 dB under a line", near(ducked - quiet, -6, 1.5), `${(ducked - quiet).toFixed(2)} dB`);
    check("voice is louder than ducked music", voice - ducked > 14, `voice ${voice.toFixed(1)} dB, music ${ducked.toFixed(1)} dB`);
    // музыка короче ролика (20 с) — зацикливается, а в конце затухает
    const looped = rmsDb(pcm(out, { start: 21, end: 23, filter: musicBand }));
    const tail = rmsDb(pcm(out, { start: plan.duration - 0.2, end: plan.duration, filter: musicBand }));
    check("music loops when shorter than the video", looped > quiet - 12, `${looped.toFixed(1)} dB at 21–23 s`);
    check("music fades out at the end", tail < quiet - 12, `${tail.toFixed(1)} dB in the last 0.2 s`);
  }

  // прогресс: стадии по порядку, кадры сходятся
  {
    const stages = [...new Set(result.events.map((e) => e.stage))];
    const last = result.events.at(-1);
    check("progress: stages download → render → title → final", stages.join(",") === "download,render,title,final", stages.join(","));
    check("progress: frames add up", last.framesDone === plan.frames, `${last.framesDone} vs ${plan.frames}`);
  }
}

// ---------- 5. файлы ядра в public/ffmpeg ----------

function verifyPublicCore() {
  console.log("\n# public/ffmpeg и public/fonts");
  const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  for (const entry of CORE_FILES) {
    const published = path.join(repo, "public", entry.path);
    const source = path.join(repo, "node_modules", entry.from);
    if (!fs.existsSync(published)) {
      check(`${entry.path} exists`, false);
      continue;
    }
    const hash = sha(published);
    check(`${entry.path} matches pinned sha256 and size`, hash === entry.sha256 && fs.statSync(published).size === entry.bytes, hash);
    if (fs.existsSync(source)) check(`${entry.path} matches node_modules/${entry.from}`, sha(source) === hash);
  }
  check(`public/fonts/${FONT_FILE} exists`, fs.existsSync(fontSource));
  check("public/fonts/OFL.txt exists", fs.existsSync(path.join(repo, "public/fonts/OFL.txt")));
}

// ---------- запуск ----------

try {
  verifyPublicCore();
  const native = nativeBackend(path.join(work, "native"));
  const nativeResult = await runMontage(native);
  await verify(native, nativeResult);

  if (!flags.has("--native-only")) {
    const wasm = await wasmBackend(path.join(work, "wasm"));
    if (!wasm) {
      console.log("\n# wasm: @ffmpeg/core не установлен — пропуск");
    } else {
      const wasmResult = await runMontage(wasm);
      await verify(wasm, wasmResult);
      console.log("\n# Одинаковые аргументы и прогресс wasm");
      check(
        "native and wasm ran the identical argument lists",
        JSON.stringify(native.argLog) === JSON.stringify(wasm.argLog),
        `${native.argLog.length} vs ${wasm.argLog.length} вызовов`,
      );
      check("wasm reports encode progress", wasm.progress.length > 10, String(wasm.progress.length));
      const fps = wasmResult.plan.frames / wasmResult.events.at(-1).encodeSeconds;
      console.log(
        `  info wasm в Node: ${wasmResult.plan.frames} кадров за ${wasmResult.events.at(-1).encodeSeconds.toFixed(1)} с кодирования ` +
          `(${fps.toFixed(0)} кадров/с; телефон — примерно в 3–6 раз медленнее)`,
      );
    }
  }
} catch (error) {
  failures++;
  console.error("\nFAIL", error instanceof Error ? error.stack : error);
} finally {
  if (flags.has("--keep")) console.log(`\nфайлы: ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passes} ok, ${failures} fail`);
process.exit(failures ? 1 : 0);
