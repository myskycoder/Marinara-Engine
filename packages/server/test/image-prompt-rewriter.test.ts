import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveRewriterMode,
  resolveRewriterSystemPrompt,
  resolvePromptDirectorSystemPrompt,
  SALIENCY_REDUCER_SYSTEM_PROMPT,
  sanitizeCompiledSceneYaml,
  sanitizeSaliencyYaml,
  validateCompiledSceneYaml,
  buildStyleProfileBlock,
} from "@marinara-engine/shared";
import {
  buildStructuredSceneState,
  compressPoseAnchors,
  deterministicSaliencyReduce,
} from "../src/services/game/illustration-scene-state.js";
import { extractMentionedNpcNames } from "../src/services/game/illustration-character-focus.js";
import {
  buildImagePromptRewriterUserMessage,
  buildImagePromptDirectorUserMessage,
} from "../src/services/game/image-prompt-writer.js";
import { assembleFluxPrompt, buildFluxStaticStyleBlock } from "../src/services/game/flux-static-style.js";

test("SALIENCY_REDUCER_SYSTEM_PROMPT mandates English snake_case pose and NSFW contact", () => {
  assert.match(SALIENCY_REDUCER_SYSTEM_PROMPT, /English snake_case/i);
  assert.match(SALIENCY_REDUCER_SYSTEM_PROMPT, /penetration, deep rhythm/i);
  assert.match(SALIENCY_REDUCER_SYSTEM_PROMPT, /secondary_visuals only/i);
});

test("resolvePromptDirectorSystemPrompt includes EN mandate, no lighting in blocks, NSFW literal rule", () => {
  const prompt = resolvePromptDirectorSystemPrompt("premium");
  assert.match(prompt, /English only/i);
  assert.match(prompt, /Do NOT put lighting/i);
  assert.match(prompt, /never replace with 'intimacy'/i);
  assert.match(prompt, /EXACTLY 2 blocks/i);
});

test("resolveRewriterSystemPrompt(flux, premium) includes legacy v2 3-block fallback format", () => {
  const prompt = resolveRewriterSystemPrompt("flux", "premium");
  assert.match(prompt, /Block 1/);
  assert.match(prompt, /Block 3/);
  assert.match(prompt, /render stack/i);
  assert.match(prompt, /physicality/i);
});

test("resolveRewriterSystemPrompt includes style profile in system prompt", () => {
  const prompt = resolveRewriterSystemPrompt("flux", "fast", {
    artStyle: "Glossy anime neon",
    genre: "Romance",
    setting: "Nightclub",
  });
  assert.match(prompt, /Style profile/);
  assert.match(prompt, /Glossy anime neon/);
  assert.match(prompt, /Nightclub/);
});

test("buildStyleProfileBlock returns empty when no style fields", () => {
  assert.equal(buildStyleProfileBlock({}), "");
});

test("resolveRewriterMode auto picks premium for gallery reasons", () => {
  assert.equal(resolveRewriterMode("auto", "Player requested extra NSFW illustration (+1) from gallery"), "premium");
  assert.equal(resolveRewriterMode("auto", "Routine travel beat"), "fast");
});

test("buildStructuredSceneState emits composition, camera geometry, avoid, dominant_pose", () => {
  const yaml = buildStructuredSceneState({
    draftPrompt:
      "She bends over the marble sink, dress hiked, heels splayed. Mirror shows her face. Deep rhythm from behind.",
    locationId: "penthouse-bathroom",
    backgroundPrompt: "luxury marble bathroom with wall mirror",
    weather: "clear",
    timeOfDay: "night",
    characters: ["Лина"],
    characterDescriptions: ["Лина: red hair, black dress"],
    sceneNpcs: "- Лина: mood=blushing; appearance=red hair; outfit=black cocktail dress",
    artStyle: "purple neon, gold nightclub palette",
  });

  assert.match(yaml, /environment:/);
  assert.match(yaml, /dominant:/);
  assert.match(yaml, /composition:/);
  assert.match(yaml, /reflection_centered: true/);
  assert.match(yaml, /focal_subject: mirror_reflection/);
  assert.match(yaml, /avoid:/);
  assert.match(yaml, /third_person_angle/);
  assert.doesNotMatch(yaml, /art_direction/);
});

test("compressPoseAnchors limits to 3 highest-priority anchors", () => {
  const anchors = compressPoseAnchors([
    "deep_rhythm",
    "heels_splayed",
    "bent_over",
    "arched_back",
    "hands_on_hips",
    "legs_spread",
    "gripping_counter",
    "head_thrown_back",
    "dress_lifted",
  ]);
  assert.equal(anchors.length, 3);
  assert.deepEqual(anchors, ["bent_over", "arched_back", "hands_on_hips"]);
});

test("deterministicSaliencyReduce drops low-salience bite mark details", () => {
  const sceneYaml = [
    "pose:",
    "  body_geometry:",
    "    - bent_over",
    "    - bite mark on fist",
    "    - arched_back",
    "composition:",
    "  focal_priority:",
    "    - face in mirror",
    "avoid:",
    "  - third_person_angle",
    "materials:",
    "  - wet_skin_sheen",
  ].join("\n");

  const saliency = deterministicSaliencyReduce(sceneYaml);
  assert.match(saliency, /dominant_pose:/);
  assert.match(saliency, /discarded_details:[\s\S]*bite mark on fist/);
  const importantSection = saliency.match(/important_visuals:\n([\s\S]*?)(?:\n[a-z_]+:|$)/)?.[1] ?? "";
  assert.doesNotMatch(importantSection, /bite mark/i);
  assert.doesNotMatch(saliency.match(/dominant_pose:\n([\s\S]*?)(?:\n[a-z_]+:|$)/)?.[1] ?? "", /bite mark/i);
});

test("assembleFluxPrompt appends static style as Block 3 and dedupes", () => {
  const blocks12 = [
    "First-person POV, tight medium shot — woman bent over marble vanity.",
    "Mirror reflection centered behind subject, hip contact at frame edge.",
  ].join("\n\n");
  const staticStyle = "glossy anime realism, nightclub neon palette, glossy anime realism";
  const assembled = assembleFluxPrompt(blocks12, staticStyle);
  const parts = assembled.split("\n\n");
  assert.equal(parts.length, 3);
  assert.match(parts[2], /nightclub neon palette/);
  // deduped: glossy anime realism appears once in block 3
  assert.equal((parts[2].match(/glossy anime realism/g) ?? []).length, 1);
});

test("buildFluxStaticStyleBlock skips Cyrillic and maps RU genre hints to English", () => {
  const { block: style } = buildFluxStaticStyleBlock({
    artStyle: "Glossy anime hentai style, soft neon lighting",
    genre: "Хентай, разврат, Гарем, Романтика",
    setting: "Бармен на вечеринке соблазняет пьяных девушек",
  });
  assert.doesNotMatch(style, /[\u0400-\u04FF]/);
  assert.match(style, /hentai/i);
  assert.match(style, /harem/i);
  assert.match(style, /nightclub neon palette/i);
});

test("buildImagePromptDirectorUserMessage uses saliency_state", () => {
  const msg = buildImagePromptDirectorUserMessage(
    { draftPrompt: "test draft", reason: "gallery", imagePromptInstructions: null },
    "dominant_pose:\n  - bent_over_counter",
    { useBuiltInPrompt: true },
  );
  assert.match(msg, /<saliency_state>/);
  assert.doesNotMatch(msg, /<scene_state>/);
  assert.match(msg, /2-block English Flux format/);
});

test("buildImagePromptRewriterUserMessage keeps scene_state for legacy v2 path", () => {
  const msg = buildImagePromptRewriterUserMessage(
    { draftPrompt: "test draft", reason: "gallery", imagePromptInstructions: null },
    "scene:\n  location_id: test",
    "flux",
    { useBuiltInPrompt: true },
  );
  assert.doesNotMatch(msg, /<target_image_model>/);
  assert.match(msg, /3-block Flux format/);
  assert.match(msg, /<scene_state>/);
});

test("sanitizeCompiledSceneYaml strips code fences", () => {
  const yaml = sanitizeCompiledSceneYaml("```yaml\nsubject:\n  name: Lina\n```");
  assert.match(yaml, /^subject:/);
  assert.doesNotMatch(yaml, /```/);
});

test("sanitizeSaliencyYaml strips code fences", () => {
  const yaml = sanitizeSaliencyYaml("```yaml\ndominant_pose:\n  - bent_over\n```");
  assert.match(yaml, /^dominant_pose:/);
});

test("validateCompiledSceneYaml detects missing keys and truncation", () => {
  assert.deepEqual(validateCompiledSceneYaml("subject:\n  name: Lina"), ["pose", "camera", "environment"]);
  assert.deepEqual(
    validateCompiledSceneYaml("subject:\n  name: Lina\npose:\n  dominant: []\ncamera:\n  pov: first\nenvironment:\n  layout: bath\nlighting:"),
    ["truncated"],
  );
});

test("extractMentionedNpcNames ignores mood bracket tags", () => {
  const known = ["Лина", "Player"];
  const text = '[Лина] [main] [crying]: "..." [Лина] [thought] [blushing]: inner monologue';
  const names = extractMentionedNpcNames(text, known);
  assert.deepEqual(names, ["Лина"]);
});
