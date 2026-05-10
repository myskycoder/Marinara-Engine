import test from "node:test";
import assert from "node:assert/strict";
import {
  buildElevenLabsTextInput,
  isAllowedTTSAudioContentType,
  resolveTTSRequestVoice,
} from "../src/routes/tts.routes.js";

test("ElevenLabs TTS prefixes expression tone tags", () => {
  assert.equal(buildElevenLabsTextInput("Stay behind me.", "scared"), "[scared] Stay behind me.");
  assert.equal(buildElevenLabsTextInput("Good morning.", "smiling, neutral"), "[smiling] [neutral] Good morning.");
});

test("ElevenLabs TTS keeps expression tags and drops structural dialogue tags", () => {
  assert.equal(
    buildElevenLabsTextInput("I can barely keep my eyes open.", "sleepy, side, whisper:Dottore"),
    "[sleepy] I can barely keep my eyes open.",
  );
});

test("ElevenLabs TTS does not duplicate an existing expression prefix", () => {
  assert.equal(buildElevenLabsTextInput("[angry] Absolutely not.", "angry"), "[angry] Absolutely not.");
});

test("ElevenLabs TTS leaves plain lines unchanged without tone", () => {
  assert.equal(buildElevenLabsTextInput("Nothing to mark."), "Nothing to mark.");
});

test("TTS requests can override the configured voice", () => {
  assert.equal(resolveTTSRequestVoice("alloy", "nova"), "nova");
});

test("TTS request voice falls back to the configured voice when blank", () => {
  assert.equal(resolveTTSRequestVoice("alloy", "   "), "alloy");
});

test("TTS audio content-type guard accepts audio responses", () => {
  assert.equal(isAllowedTTSAudioContentType("audio/mpeg"), true);
  assert.equal(isAllowedTTSAudioContentType("audio/wav; charset=binary"), true);
  assert.equal(isAllowedTTSAudioContentType("application/octet-stream"), true);
});

test("TTS audio content-type guard rejects provider JSON errors", () => {
  assert.equal(isAllowedTTSAudioContentType("application/json; charset=utf-8"), false);
  assert.equal(isAllowedTTSAudioContentType(null), false);
});
