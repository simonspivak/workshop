import assert from "node:assert/strict";
import { importTs, test } from "../../server/bot/tests/harness.mjs";

/*
  Браузерная часть: черновик формы помнит длину трека и голос (lib/platform/form-draft.ts),
  текст отказа «говорящей головы» с длиной озвучки (generation-messages.ts), плитки озвучки
  (lipsyncAudioVerdict) и custom-режим Suno (musicCustomMode).
*/

const { sanitizeFormDraft, defaultFormDraft } = importTs("@/lib/platform/form-draft");
const { platformErrorMessage } = importTs("@/lib/platform/generation-messages");
const { lipsyncAudioVerdict, musicCustomMode, MUSIC_DEFAULT_DURATION } = importTs("@/lib/platform/generation-types");

const CTX = {
  models: ["ai-music-api/generate"],
  defaultModel: "ai-music-api/generate",
  longVideo: false,
  imagePaths: [],
  videoPaths: [],
  audioPaths: [],
  maxImages: () => 1,
};

test("черновик формы: длина трека и голос запоминаются, чужие значения — умолчания", () => {
  assert.equal(defaultFormDraft("m").musicDuration, MUSIC_DEFAULT_DURATION);
  assert.equal(MUSIC_DEFAULT_DURATION, 60);
  assert.equal(defaultFormDraft("m").vocal, "any");
  const kept = sanitizeFormDraft({ musicDuration: 120, vocal: "f" }, CTX);
  assert.equal(kept.musicDuration, 120);
  assert.equal(kept.vocal, "f");
  const bad = sanitizeFormDraft({ musicDuration: 300, vocal: "x" }, CTX);
  assert.equal(bad.musicDuration, 60);
  assert.equal(bad.vocal, "any");
});

test("отказ говорящей головы: с длиной — сколько длится и что делать; без длины — общий текст", () => {
  assert.equal(
    platformErrorMessage("lipsync_audio", { seconds: 22.3 }),
    "Озвучка длится 22 с — для говорящей головы нужно не больше 20 с. Сократи реплику на пару слов или раздели её на две.",
  );
  assert.equal(platformErrorMessage("lipsync_audio", { seconds: 20.6 }).startsWith("Озвучка длится 21 с"), true);
  assert.match(platformErrorMessage("lipsync_audio"), /не длиннее 20 секунд/);
  assert.match(platformErrorMessage("lipsync_audio", { seconds: null }), /не длиннее 20 секунд/);
});

test("плитка озвучки: длиннее 20,5 с у ученика погашена; неизвестная длина и ведущий — можно", () => {
  assert.equal(lipsyncAudioVerdict(20.4, false), "ok");
  assert.equal(lipsyncAudioVerdict(20.6, false), "too_long");
  assert.equal(lipsyncAudioVerdict(null, false), "ok");
  assert.equal(lipsyncAudioVerdict(undefined, false), "ok");
  assert.equal(lipsyncAudioVerdict(90, true), "ok");
});

test("custom-режим Suno: без вокала или свой текст; пустой текст — простой режим", () => {
  assert.equal(musicCustomMode({ instrumental: true }), true);
  assert.equal(musicCustomMode({ lyrics: "Свечи горят" }), true);
  assert.equal(musicCustomMode({ lyrics: "   " }), false);
  assert.equal(musicCustomMode({}), false);
});

// ---------- вторая модель озвучки: ElevenLabs V3 ----------

test("озвучка: у каждой модели свой список голосов, чужой голос заменяется первым из списка", () => {
  const { ELEVEN_VOICE_MODEL, ELEVEN_VOICE_OPTIONS, VOICE_OPTIONS, VOICE_IDS, voiceForModel, voiceOptionsFor, voiceTakesStyle, ELEVEN_TAGS } =
    importTs("@/lib/platform/generation-types");
  const GEMINI = "google/gemini-3-8-flash-tts";
  assert.equal(ELEVEN_VOICE_OPTIONS.length, 20);
  assert.equal(new Set(VOICE_IDS).size, VOICE_OPTIONS.length + ELEVEN_VOICE_OPTIONS.length, "имена голосов двух моделей не пересекаются");
  assert.equal(voiceOptionsFor(ELEVEN_VOICE_MODEL), ELEVEN_VOICE_OPTIONS);
  assert.equal(voiceOptionsFor(GEMINI), VOICE_OPTIONS);
  assert.equal(voiceForModel(ELEVEN_VOICE_MODEL, "Liam"), "Liam");
  assert.equal(voiceForModel(ELEVEN_VOICE_MODEL, "Kore"), "Sarah");
  assert.equal(voiceForModel(ELEVEN_VOICE_MODEL, undefined), "Sarah");
  assert.equal(voiceForModel(GEMINI, "Liam"), "Kore");
  assert.equal(voiceForModel(GEMINI, "Puck"), "Puck");
  assert.equal(voiceTakesStyle(GEMINI), true);
  assert.equal(voiceTakesStyle(ELEVEN_VOICE_MODEL), false);
  // шлюз принимает имя голоса вида /^[A-Z][a-z]{2,15}$/ и меняет его на ID
  for (const v of ELEVEN_VOICE_OPTIONS) assert.match(v.id, /^[A-Z][a-z]{2,15}$/);
  for (const t of ELEVEN_TAGS) assert.match(t.tag, /^\[[a-z ]{3,20}\]$/);
});
