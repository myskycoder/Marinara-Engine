import assert from "node:assert/strict";
import test from "node:test";
import type { SceneFacts } from "../dist/services/game/scene-facts.js";
import {
  auditFluxPrompt,
  buildWowCinematographyHint,
  filterArtDirectionForFacts,
  getFluxPromptViolations,
  isFullSceneFacts,
  postProcessFacts,
  resolveSceneGeometry,
} from "../dist/services/game/flux-prompt-audit.js";

const linaFacts: SceneFacts = {
  pov: "first_person",
  protagonist_visible: false,
  visible_body_parts: [],
  characters: [
    {
      name: "Лина",
      hair: "copper, spread on white stone",
      outfit: "short black dress",
      garment_state: "dress hiked to waist",
      expression: "eyes closed, mouth slightly open, crying, blushing",
      pose: "head thrown back, body pushed against marble countertop, hands gripping sink edge",
    },
  ],
  action: "protagonist is penetrating Lina deeply from behind, pushing her against a marble countertop",
  location_id: "mark-stone-penthouse-vip-room",
  location_label: "Mark Stone Penthouse VIP room",
  props: ["marble countertop", "sink", "tile floor", "mirror", "door"],
  lighting: "ambient",
  time_weather: "Day 1, 21:00 (night), clear",
  offscreen: ["Igor behind the door", "footsteps fading"],
  mirror_shows:
    "protagonist's hands on Lina's spread thighs, Lina's face with closed eyes and open mouth, Lina's copper hair spread on white stone",
  nsfw: true,
};

const goodPrompt = [
  "From my first-person view behind her, Lina is bent over the marble countertop in the Mark Stone Penthouse VIP room, a red-haired woman in a short black dress hiked to her waist, her back and hips filling the foreground.",
  "My hips are pressed flush against her from behind, penetrating her deeply as she is pinned against the cold marble, her thighs spread and my hands resting on her outer thighs.",
  "The Mark Stone Penthouse VIP room has a gleaming marble countertop, a sink with polished fixtures, white tile floor, a large wall mirror ahead of her, and a heavy closed door to the side.",
  "In the mirror ahead I see her flushed face with closed eyes and a slightly open mouth, tear-streaked cheeks; her black dress is bunched at her waist, skin glistening with sweat.",
  "Soft purple, pink, and gold neon fills the VIP bathroom, rim light on wet marble and her bare hips, deep shadows by the closed door.",
  "Igor waits unseen behind the door, his footsteps just faded, a tense forbidden nightclub hush before someone walks in.",
  "Medium shot from behind at hip height, glossy anime hentai illustration, vibrant nightclub palette, semi-realistic architectural background only.",
].join("\n");

test("resolveSceneGeometry strips hair-on-stone when face is in mirror", () => {
  const resolved = resolveSceneGeometry(linaFacts);
  assert.doesNotMatch(resolved.characters[0].hair, /spread on white stone/i);
  assert.doesNotMatch(resolved.mirror_shows, /hair spread on white stone/i);
  assert.match(resolved.mirror_shows, /face with closed eyes/i);
  assert.ok(resolved.visible_body_parts.includes("hands"));
  assert.ok(resolved.visible_body_parts.includes("hips"));
  assert.doesNotMatch(resolved.characters[0].pose, /head thrown back/i);
});

test("filterArtDirectionForFacts removes expressive eyes when facts say closed eyes", () => {
  const filtered = filterArtDirectionForFacts(
    "Glossy anime hentai style, detailed character art with expressive eyes, semi-realistic backgrounds",
    linaFacts,
  );
  assert.doesNotMatch(filtered, /expressive eyes/i);
});

test("getFluxPromptViolations flags hair-on-stone plus mirror face", () => {
  const badPrompt = [
    "Lina is bent over the marble countertop in the Mark Stone Penthouse VIP room.",
    "My hips are pressed flush against her from behind, penetrating her deeply.",
    "The VIP room has marble counter, sink, tile floor, mirror, and door.",
    "Lina's copper hair spills across the white stone, her face in the mirror shows closed eyes and a slightly open mouth.",
    "Soft neon lighting in purple, pink, and gold.",
    "Igor lingers behind the door.",
    "Medium shot from behind, glossy anime hentai style.",
  ].join("\n");
  const violations = getFluxPromptViolations(badPrompt, linaFacts);
  assert.ok(violations.some((item) => item.includes("ONE FACE SOURCE")));
});

test("auditFluxPrompt accepts mirror-only face prompt with penetration", () => {
  const resolved = resolveSceneGeometry(linaFacts);
  assert.doesNotThrow(() => auditFluxPrompt(goodPrompt, resolved));
});

test("getFluxPromptViolations flags duplicate protagonist hands in lines 2 and 4", () => {
  const lines = goodPrompt.split("\n");
  lines[3] =
    "In the mirror ahead I see her flushed face with closed eyes and my hands on her spread thighs.";
  const badPrompt = lines.join("\n");
  const resolved = resolveSceneGeometry(linaFacts);
  const violations = getFluxPromptViolations(badPrompt, resolved);
  assert.ok(violations.some((item) => item.includes("DUPLICATE HANDS")));
});

test("getFluxPromptViolations flags hair spill on line 1 when face is mirror-only", () => {
  const badPrompt = goodPrompt.replace(
    "From my first-person view behind her, Lina is bent over the marble countertop in the Mark Stone Penthouse VIP room, a red-haired woman in a short black dress hiked to her waist, her back and hips filling the foreground.",
    "From my first-person view behind her, Lina is bent over the marble countertop, her copper hair spilling down her back.",
  );
  const resolved = resolveSceneGeometry(linaFacts);
  const violations = getFluxPromptViolations(badPrompt, resolved);
  assert.ok(violations.some((item) => item.includes("hair spilling/cascading")));
});

test("getFluxPromptViolations flags missing penetration for nsfw facts", () => {
  const softPrompt = goodPrompt.replace(
    "My hips are pressed flush against her from behind, penetrating her deeply as she is pinned against the cold marble, her thighs spread and my hands resting on her outer thighs.",
    "She is pinned against the cold marble, her thighs spread and my hands resting on her outer thighs.",
  );
  const violations = getFluxPromptViolations(softPrompt, linaFacts);
  assert.ok(violations.some((item) => item.includes("NSFW")));
});

test("postProcessFacts sanitizes expression sequences and normalizes names", () => {
  const messyFacts: SceneFacts = {
    ...linaFacts,
    characters: [
      {
        ...linaFacts.characters[0],
        name: "Лина",
        expression: "eyes closed, mouth slightly open, then eyes open, then crying",
        pose: "head thrown back, hands gripping sink edge, knuckles white",
      },
    ],
    lighting: "ambient",
    offscreen: ["Igor behind the door"],
    props: ["marble countertop", "sink", "tile floor", "mirror"],
  };
  const processed = postProcessFacts(messyFacts);
  assert.equal(processed.characters[0].name, "Lina");
  assert.doesNotMatch(processed.characters[0].expression, /then eyes open/i);
  assert.doesNotMatch(processed.characters[0].pose, /head thrown back/i);
  assert.ok(processed.props.some((prop) => /door/i.test(prop)));
});

const fullSceneFacts: SceneFacts = {
  pov: "third_person",
  protagonist_visible: true,
  visible_body_parts: [],
  characters: [
    {
      name: "Lina",
      hair: "медные, разметавшиеся по белому камню",
      outfit: "короткое чёрное платье",
      garment_state: "dress hiked to waist, otherwise clothed",
      expression: "crying, eyes closed, mouth slightly open, blushing",
      pose: "head thrown back, fingers on sink edge, heels on tile, legs spread",
    },
    {
      name: "protagonist",
      hair: "",
      outfit: "",
      garment_state: "",
      expression: "",
      pose: "hands on her spread thighs, pushing Lina against marble countertop",
    },
  ],
  action:
    "The protagonist is penetrating Lina from behind, pushing her against a marble countertop, with Lina's dress hiked to her waist. The protagonist's hands are on Lina's spread thighs.",
  location_id: "mark-stone-penthouse-vip-room",
  location_label: "Mark Stone Penthouse VIP room",
  props: ["marble countertop", "sink", "tile floor", "mirror", "door"],
  lighting: "soft neon lighting, vibrant nightclub palette of purple, pink and gold",
  time_weather: "clear night",
  offscreen: ["Igor behind the door", "footsteps fading"],
  mirror_shows: "protagonist's hands on Lina's spread thighs, Lina's face with closed eyes and slightly open mouth",
  nsfw: true,
};

const fullSceneGoodPrompt = [
  "From a third-person perspective in the Mark Stone Penthouse VIP room, Lina is bent over the marble countertop in a short black dress hiked to her waist, copper hair cascading down her back, while the male protagonist stands behind her, both fully visible in frame.",
  "The protagonist presses his hips flush against her from behind, penetrating her deeply as she is pinned against the cold marble, his hands resting on her spread outer thighs, her fingers lightly touching the sink edge.",
  "The Mark Stone Penthouse VIP room features a gleaming marble countertop, sink, white tile floor, a wall mirror ahead of Lina, and a heavy closed door to the side.",
  "In the mirror ahead, Lina's flushed face shows closed eyes, a slightly open mouth, and tear-streaked cheeks; her dress is bunched at her waist, skin glistening with sweat.",
  "Soft purple, pink, and gold neon lights fill the VIP room, casting rim light on wet marble and bare hips, with deep shadows near the closed door.",
  "Igor waits unseen behind the door, his footsteps just faded, creating a tense forbidden nightclub hush.",
  "Wide shot third-person camera, glossy anime hentai illustration, vibrant nightclub palette, semi-realistic architectural background only.",
].join("\n");

test("isFullSceneFacts detects third-person visible protagonist", () => {
  assert.equal(isFullSceneFacts(fullSceneFacts), true);
  assert.equal(isFullSceneFacts(linaFacts), false);
});

test("postProcessFacts fullScene preserves head thrown back and normalizes Russian hair", () => {
  const processed = postProcessFacts(fullSceneFacts, { fullScene: true });
  assert.equal(processed.pov, "third_person");
  assert.equal(processed.protagonist_visible, true);
  assert.equal(processed.characters[0].hair, "copper hair");
  assert.equal(processed.characters[0].outfit, "short black dress");
  assert.match(processed.characters[0].pose, /head thrown back/i);
});

test("auditFluxPrompt accepts third-person full-scene prompt with his hands and hair on back", () => {
  const processed = postProcessFacts(fullSceneFacts, { fullScene: true });
  assert.doesNotThrow(() => auditFluxPrompt(fullSceneGoodPrompt, processed));
});

test("getFluxPromptViolations skips hair cascade on line 1 for full scene", () => {
  const processed = postProcessFacts(fullSceneFacts, { fullScene: true });
  const violations = getFluxPromptViolations(fullSceneGoodPrompt, processed);
  assert.ok(!violations.some((item) => item.includes("hair spilling/cascading")));
});

test("getFluxPromptViolations flags first-person hip height camera in full scene", () => {
  const processed = postProcessFacts(fullSceneFacts, { fullScene: true });
  const badPrompt = fullSceneGoodPrompt.replace(
    "Wide shot third-person camera, glossy anime hentai illustration, vibrant nightclub palette, semi-realistic architectural background only.",
    "Medium shot from behind at hip height, glossy anime hentai illustration, vibrant nightclub palette, semi-realistic architectural background only.",
  );
  const violations = getFluxPromptViolations(badPrompt, processed);
  assert.ok(violations.some((item) => item.includes("hip height")));
});

test("buildWowCinematographyHint derives lighting from facts not a fixed neon template", () => {
  const hint = buildWowCinematographyHint(linaFacts, {
    genre: "Romance",
    setting: "party",
    artStyle: "glossy anime hentai, soft neon lighting, vibrant nightclub palette",
  });
  assert.ok(hint);
  assert.match(hint!, /<wow_cinematography>/);
  assert.match(hint!, /art_direction palette/);
  assert.match(hint!, /Mark Stone Penthouse VIP room/);
  assert.doesNotMatch(hint!, /purple-magenta/);
  assert.match(hint!, /never import an unrelated mood/);
  assert.match(hint!, /cinematic POV/);
});

test("buildWowCinematographyHint full scene uses wide third-person camera rule", () => {
  const hint = buildWowCinematographyHint(fullSceneFacts, {});
  assert.ok(hint);
  assert.match(hint!, /wide cinematic third-person/);
  assert.match(hint!, /line5_checklist/);
  assert.doesNotMatch(hint!, /purple-magenta/);
});

test("postProcessFacts wowArt keeps ambient lighting instead of VIP neon injection", () => {
  const processed = postProcessFacts({ ...linaFacts, lighting: "ambient" }, { wowArt: true });
  assert.equal(processed.lighting, "ambient");
});

test("getFluxPromptViolations wowArt flags weak cinematic lines 5 and 7", () => {
  const weakWowPrompt = goodPrompt
    .replace(
      "Soft purple, pink, and gold neon fills the VIP bathroom, rim light on wet marble and her bare hips, deep shadows by the closed door.",
      "Soft ambient light fills the room evenly.",
    )
    .replace(
      "Medium shot from behind at hip height, glossy anime hentai illustration, vibrant nightclub palette, semi-realistic architectural background only.",
      "Medium shot from behind at hip height, glossy anime hentai illustration, semi-realistic architectural background only.",
    );
  const violations = getFluxPromptViolations(weakWowPrompt, linaFacts, { wowArt: true });
  assert.ok(violations.some((item) => item.includes("WOW CG: line 5")));
  assert.ok(violations.some((item) => item.includes("WOW CG: line 7")));
});

test("getFluxPromptViolations wowArt accepts strong cinematic lines 5 and 7", () => {
  const strongWowPrompt = goodPrompt
    .replace(
      "Medium shot from behind at hip height, glossy anime hentai illustration, vibrant nightclub palette, semi-realistic architectural background only.",
      "Cinematic POV at hip height with 35mm lens feel, shallow depth of field on her back, premium VN key visual, vibrant nightclub color grade, semi-realistic architectural background only.",
    );
  const violations = getFluxPromptViolations(strongWowPrompt, linaFacts, { wowArt: true });
  assert.ok(!violations.some((item) => item.startsWith("WOW CG:")));
});
