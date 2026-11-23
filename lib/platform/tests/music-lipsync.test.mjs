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
