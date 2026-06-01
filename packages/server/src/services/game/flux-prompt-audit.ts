// ──────────────────────────────────────────────
// Flux 2 Klein geometry resolution + prompt audit
// ──────────────────────────────────────────────

import type { SceneFacts } from "./scene-facts.js";

const FACE_IN_TEXT_RE = /\b(face|eyes|mouth|cheek|lips)\b/i;
const HAIR_ON_SURFACE_RE =
  /\b(hair|copper|red|auburn).{0,40}\b(spread|spill|cascade|splay).{0,25}\b(stone|marble|counter)/i;
const HAIR_ON_SURFACE_SHORT_RE = /\b(spread|spill).{0,20}\b(stone|marble|counter)/i;
const PROTAGONIST_HANDS_RE =
  /(?:protagonist'?s?|my|your)\s+hands|\bhands on (?:her|his|their|lina)/i;
const PENETRATION_RE =
  /\b(penetrat(?:e|ed|ing)?|inside (?:her|him|them)|entered|thrust into|hips pressed flush|cock inside|deep into|vaginal|anal sex)\b/i;
const MOTION_VERBS_RE =
  /\b(rhythm(?:ic)?|thrusting|thrusts|each thrust|scraping|scrape|driving into|pounding|pump(?:ing)?|clench(?:ing)?|clutching around)\b/i;
const HAIR_ON_STONE_PROMPT_RE =
  /\b(hair|copper).{0,40}\b(spill|spread|cascade|splay).{0,25}\b(stone|marble|counter)/i;
const FACE_IN_MIRROR_PROMPT_RE =
  /\b(?:in the mirror|mirror.{0,50}\bface|\bface.{0,40}\bmirror|\beyes.{0,30}\bmirror)\b/i;
const LINE1_ACTION_RE =
  /\b(penetrat(?:e|ed|ing)?|drive into|thrust|inside (?:her|him)|as I press against (?:her|him))\b/i;
const LINE1_CONTACT_RE =
  /\b(?:hips pressed|pressed flush|pressed against (?:me|her|him)|against me\b|penetrat)/i;
const PROTAG_HANDS_FP_RE = /\b(?:my|your)\s+hands\b/i;
const PROTAG_HANDS_TP_RE =
  /\b(?:my|your|his|their|the protagonist'?s?)\s+hands\b|\bprotagonist'?s?\s+hands\b/i;
const HAND_GRIP_INTENSIFIER_RE =
  /\b(?:grip(?:ping)?(?: firmly)?|clutch(?:ing)?|white knuckles|knuckles white)\b/i;
const PARTNER_SINK_HANDS_RE =
  /\b(?:sink edge|counter edge|edge of the sink).{0,40}\b(?:knuckles|clutch|grip)|\b(?:knuckles|clutch|grip).{0,40}\b(?:sink edge|counter edge|edge of the sink)\b/i;
const LOW_ANGLE_RE = /\blow angle\b/i;
const HAIR_SPILL_BACK_RE =
  /\b(?:hair|copper).{0,20}\b(?:spill(?:ing)?|cascad(?:e|ing)|splay(?:ing)?).{0,15}\b(?:back|down)\b/i;

/** Third-person gallery Full SFW/NSFW — both protagonist and cast visible in wide shot. */
export function isFullSceneFacts(facts: SceneFacts): boolean {
  return facts.pov === "third_person" && facts.protagonist_visible === true;
}

function protagHandsInLine(line: string, facts: SceneFacts): boolean {
  if (isFullSceneFacts(facts)) {
    return PROTAG_HANDS_TP_RE.test(line);
  }
  return PROTAG_HANDS_FP_RE.test(line);
}

function needsProtagonistHandsInLine2(facts: SceneFacts): boolean {
  if (facts.visible_body_parts.some((part) => part.toLowerCase() === "hands")) {
    return true;
  }
  return isFullSceneFacts(facts) && PROTAGONIST_HANDS_RE.test(facts.action);
}

function cloneFacts(facts: SceneFacts): SceneFacts {
  return {
    ...facts,
    visible_body_parts: [...facts.visible_body_parts],
    characters: facts.characters.map((character) => ({ ...character })),
    props: [...facts.props],
    offscreen: [...facts.offscreen],
  };
}

function stripHairOnSurface(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/,?\s*(?:copper |red |auburn )?hair[^,.;]*(?:stone|marble|counter)[^,.;]*/gi, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/^,\s*/, "").trim();
  return cleaned;
}

function normalizeHairField(hair: string): string {
  let value = hair.trim();
  if (!value) return value;
  if (/[а-яё]/i.test(value)) {
    if (/(?:медн|copper)/i.test(value)) return "copper hair";
    if (/(?:рыж|red|ginger|auburn)/i.test(value)) return "red hair";
    if (/\b(?:blond|блонд)\b/i.test(value)) return "blonde hair";
    if (/\b(?:black|чёрн|черн)\b/i.test(value)) return "black hair";
    return "red hair";
  }
  if (HAIR_ON_SURFACE_RE.test(value) || HAIR_ON_SURFACE_SHORT_RE.test(value)) {
    value = value.replace(/,?\s*spread[^,]*/gi, "");
    value = value.replace(/,?\s*spill[^,]*/gi, "");
    value = value.replace(/,?\s*on (?:white )?(?:stone|marble)[^,]*/gi, "");
    value = value.replace(/\s{2,}/g, " ").trim();
  }
  if (!value || HAIR_ON_SURFACE_SHORT_RE.test(value)) {
    const colorMatch = hair.match(/\b(copper|red|auburn|ginger|strawberry)\b/i);
    return colorMatch?.[1] ? `${colorMatch[1].toLowerCase()} hair` : "red hair";
  }
  return value;
}

function freezeActionText(action: string): string {
  return String(action)
    .replace(/\bthrusting in a hard, deep rhythm\b/gi, "penetrating deeply from behind in a frozen mid-thrust pose")
    .replace(/\bthrusting\b/gi, "penetrating")
    .replace(/\b(?:hard, deep )?rhythm\b/gi, "deep penetration")
    .replace(/\bscraping and splaying\b/gi, "splayed")
    .replace(/\bscraping\b/gi, "")
    .replace(/\bpounding\b/gi, "deep penetration")
    .replace(/\bdeep and hard\b/gi, "deeply from behind")
    .replace(/\bdeep deep penetration\b/gi, "deep penetration")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanMirrorShows(mirror: string, expression: string): string {
  let cleaned = String(mirror ?? "").trim();
  cleaned = cleaned.replace(/,\s*Lina's,?\s*/gi, ", ");
  cleaned = cleaned.replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
  const hasClosedEyes = /\b(?:closed eyes|eyes closed)\b/i.test(expression);
  if (hasClosedEyes) {
    cleaned = cleaned.replace(/\b(?:reflection )?catching her own eyes\b/gi, "tear-streaked cheeks");
    cleaned = cleaned.replace(/\beyes meeting (?:her |their )?(?:own )?reflection\b/gi, "closed eyes");
  }
  return cleaned.replace(/,\s*$/, "").trim();
}

function sanitizeExpression(expression: string): string {
  let value = String(expression ?? "").trim();
  if (/\b(?:closed eyes|eyes closed)\b/i.test(value)) {
    value = value.replace(/,?\s*then eyes open[^,]*/gi, "");
    value = value.replace(/,?\s*then (?:biting|moaning|crying)[^,]*/gi, "");
    value = value.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
  }
  return value;
}

function sanitizePose(pose: string, mirrorShowsFace: boolean, fullScene: boolean): string {
  let value = String(pose ?? "").trim();
  value = value.replace(/,?\s*then eyes open looking at reflection\b/gi, "");
  if (!fullScene) {
    value = value.replace(/\bhead thrown back,?\s*/gi, "head lowered toward the counter, ");
  }
  value = value.replace(/\b(?:knuckles white|white knuckles)\b/gi, "");
  value = value.replace(/\b(?:hands gripping|gripping) sink edge\b/gi, "fingers on sink edge");
  if (mirrorShowsFace) {
    value = value.replace(/\b(?:copper |red )?hair[^,]*(?:stone|marble)[^,]*/gi, "");
  }
  return value.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
}

function enrichLighting(lighting: string, wowArt = false): string {
  const value = String(lighting ?? "").trim();
  if (wowArt) {
    return value || "ambient";
  }
  if (!value || /^ambient$/i.test(value)) {
    return "soft purple, pink, and gold neon nightclub ambient light";
  }
  return value;
}

function ensureLocationProps(facts: SceneFacts): void {
  if (!facts.props.some((prop) => /door/i.test(prop)) && facts.offscreen.some((item) => /door/i.test(item))) {
    facts.props.push("door");
  }
}

/** Resolve mirror/hair/POV conflicts before compose. Mutates a clone — safe for callers. */
export function resolveSceneGeometry(facts: SceneFacts, fullScene = false): SceneFacts {
  const resolved = cloneFacts(facts);
  const mirror = String(resolved.mirror_shows ?? "").trim();
  const mirrorShowsFace = mirror.length > 0 && FACE_IN_TEXT_RE.test(mirror);
  const fullSceneMode = fullScene || isFullSceneFacts(resolved);

  if (mirrorShowsFace) {
    for (const character of resolved.characters) {
      character.hair = normalizeHairField(character.hair);
      if (!fullSceneMode && /\bhead thrown back\b/i.test(character.pose)) {
        character.pose = character.pose
          .replace(/\bhead thrown back,?\s*/i, "head lowered toward the counter, ")
          .trim();
      }
    }
    if (HAIR_ON_SURFACE_RE.test(mirror)) {
      resolved.mirror_shows = stripHairOnSurface(mirror);
    }
  }

  const visibleParts = new Set(
    resolved.visible_body_parts.map((part) => part.trim().toLowerCase()).filter(Boolean),
  );
  if (!fullSceneMode && PROTAGONIST_HANDS_RE.test(mirror)) {
    visibleParts.add("hands");
  }
  if (
    resolved.pov === "first_person" &&
    /\b(from behind|penetrat|inside (?:her|him|them))\b/i.test(resolved.action)
  ) {
    visibleParts.add("hips");
  }
  resolved.visible_body_parts = [...visibleParts];

  return resolved;
}

export interface PostProcessFactsOptions {
  /** Gallery Full SFW/NSFW — third-person wide shot with visible protagonist. */
  fullScene?: boolean;
  /** Wow CG — do not inject generic VIP/neon into facts.lighting; compose derives cinematic light from art_direction. */
  wowArt?: boolean;
}

/** Normalize extracted facts before compose. */
export function postProcessFacts(facts: SceneFacts, opts: PostProcessFactsOptions = {}): SceneFacts {
  const processed = cloneFacts(facts);
  const fullScene = opts.fullScene === true;
  if (fullScene) {
    processed.pov = "third_person";
    processed.protagonist_visible = true;
  }
  processed.action = freezeActionText(processed.action);
  processed.lighting = enrichLighting(processed.lighting, opts.wowArt === true);
  ensureLocationProps(processed);
  const mirror = String(processed.mirror_shows ?? "").trim();
  const mirrorShowsFace = mirror.length > 0 && FACE_IN_TEXT_RE.test(mirror);
  for (const character of processed.characters) {
    character.name = character.name.replace(/Лина/g, "Lina");
    character.pose = sanitizePose(freezeActionText(character.pose), mirrorShowsFace, fullScene);
    character.expression = sanitizeExpression(character.expression);
    character.hair = normalizeHairField(character.hair);
    if (character.outfit && /[а-яё]/i.test(character.outfit)) {
      if (/чёрн|черн|black/i.test(character.outfit)) {
        character.outfit = "short black dress";
      }
    }
  }
  if (processed.mirror_shows) {
    const expression = processed.characters.map((character) => character.expression).join("; ");
    processed.mirror_shows = cleanMirrorShows(processed.mirror_shows, expression);
  }
  return resolveSceneGeometry(processed, fullScene);
}

/** Drop art-direction cues that fight resolved facial expression facts. */
export function filterArtDirectionForFacts(artStyle: string, facts: SceneFacts): string {
  const hasClosedEyes = facts.characters.some((character) =>
    /\b(?:closed eyes|eyes closed)\b/i.test(character.expression),
  );
  if (!hasClosedEyes) return artStyle;
  return artStyle
    .replace(/,?\s*detailed character art with expressive eyes/gi, ", detailed character art")
    .replace(/,?\s*with expressive eyes/gi, "")
    .replace(/,?\s*expressive eyes/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Optional hint block appended to compose user messages for flux family. */
export function buildGeometryHint(facts: SceneFacts): string | null {
  const mirror = String(facts.mirror_shows ?? "").trim();
  const fullScene = isFullSceneFacts(facts);

  if (fullScene) {
    const lines = [
      "<geometry_resolution>",
      "shot_mode: third-person wide shot — both protagonist and partner visible in frame; use third-person phrasing (the protagonist, his hands), never first-person (my view, my hands).",
      "line1_rule: sentence 1 names both visible characters and the location — no penetration, no hips pressed, no contact.",
      "line2_rule: frozen action with one penetration clause; protagonist hands on partner outer thighs (his/the protagonist's hands); partner fingers on sink edge briefly without white knuckles or gripping firmly.",
    ];
    if (mirror && FACE_IN_TEXT_RE.test(mirror)) {
      lines.push(
        "face_source: mirror — show her face in the mirror reflection (sentence 4). Hair may cascade down her back in sentence 1; never hair spread or spilled on marble/stone.",
      );
      lines.push(
        "line4_rule: mirror shows face, flush, and tears ONLY — do not repeat protagonist hands or penetration in line 4.",
      );
    }
    lines.push(
      "line7_rule: wide shot or medium-wide third-person camera showing both bodies and room props — not first-person from behind at hip height, not low angle.",
    );
    lines.push("</geometry_resolution>");
    return lines.join("\n");
  }

  if (!mirror || !FACE_IN_TEXT_RE.test(mirror)) return null;

  const lines = [
    "<geometry_resolution>",
    'face_source: mirror — show her face ONLY in the mirror reflection (sentence 4). Do NOT describe hair spread or spilled on marble/stone in any sentence.',
  ];
  if (facts.visible_body_parts.length > 0) {
    lines.push(
      `visible_body_parts: ${facts.visible_body_parts.join(", ")} — describe hips and penetration in sentence 2; protagonist hands resting on outer thighs in sentence 2 only.`,
    );
  }
  lines.push(
    "hand_rule: protagonist hands resting on outer thighs ONLY in line 2; partner fingers on sink edge briefly without grip intensifiers; line 4 mirror shows face/flush/tears ONLY — never repeat my/your hands in line 4.",
  );
  lines.push(
    "line1_rule: sentence 1 is POV + subject only — no hips pressed, no penetration, no contact.",
  );
  lines.push("</geometry_resolution>");
  return lines.join("\n");
}

export interface WowCinematographyContext {
  genre?: string | null;
  setting?: string | null;
  artStyle?: string | null;
}

function resolveWowLightingBase(facts: SceneFacts, ctx: WowCinematographyContext): string {
  const raw = String(facts.lighting ?? "").trim();
  if (raw && !/^ambient$/i.test(raw)) return raw;
  const artStyle = ctx.artStyle?.trim();
  if (artStyle) {
    return `art_direction palette (${artStyle.slice(0, 180)})`;
  }
  return "facts.lighting, time_weather, and art_direction";
}

/**
 * Optional Wow CG compose hints — cinematic camera + lighting only.
 * Palette and mood must follow facts/art_direction, not a fixed template.
 */
export function buildWowCinematographyHint(
  facts: SceneFacts,
  ctx: WowCinematographyContext = {},
): string | null {
  const fullScene = isFullSceneFacts(facts);
  const lightingBase = resolveWowLightingBase(facts, ctx);
  const location = String(facts.location_label ?? "").trim() || "location_label";
  const moodParts = [ctx.genre?.trim(), ctx.setting?.trim(), ctx.artStyle?.trim()].filter(Boolean);
  const moodRef = moodParts.length > 0 ? moodParts.join("; ") : "art_direction";

  const line5Checklist =
    "line5_checklist: name key-light SOURCE + DIRECTION, rim on primary subjects, fill/bounce from a visible surface (floor/window/water/sky), optional vignette — palette from art_direction only; never generic 'soft ambient' alone.";
  const line7Checklist = fullScene
    ? "line7_checklist: wide cinematic third-person, lens feel (24–35mm interior / 35–50mm exterior), subjects slightly off-center, premium VN key visual, explicit color grade from art_direction."
    : "line7_checklist: cinematic POV, hip-height or eye-level per geometry, shallow depth of field on the subject, premium VN still, explicit color grade from art_direction — never plain 'medium shot from behind at hip height' without cinematic/lens language.";

  return [
    "<wow_cinematography>",
    "Wow CG mode — rewrite ONLY sentence 5 (lighting) and sentence 7 (camera/style) to premium cinematic quality. Do not alter facts, geometry, action, or lines 1–4.",
    `line5_rule: cinematic lighting faithful to ${location} — start from ${lightingBase} and ${facts.time_weather || "time_weather"}; palette must match ${moodRef} — never import an unrelated mood (no nightclub neon in a forest, no golden hour in a basement unless facts say so).`,
    line5Checklist,
    fullScene
      ? "line7_rule: wide cinematic third-person gallery shot, both subjects readable and slightly off-center, lens suited to the space, premium VN key-visual framing."
      : "line7_rule: cinematic POV matched to facts.pov and geometry hints, readable subject framing, premium VN still.",
    line7Checklist,
    "</wow_cinematography>",
  ].join("\n");
}

/** Appended to flux compose system prompt when wowArt is active. */
export const FLUX_WOW_COMPOSE_SYSTEM_ADDENDUM = `# Wow CG mode (active)
When <wow_cinematography> is present, it OVERRIDES reference-shape lighting/camera for sentences 5 and 7.
- Sentence 5 MUST name: key-light direction, rim on subjects, fill/bounce from a visible surface, and a color grade tied to <art_direction> — not bare "ambient light" or reference-shape nightclub neon unless the scene supports it.
- Sentence 7 MUST name: cinematic framing, lens feel (e.g. 28mm / 35mm) OR depth of field, and premium VN key-visual language — upgrade plain hip-height POV to cinematic POV.
- Do NOT change sentences 1–4, facts, geometry hints, or character art style from <art_direction>.
- Wow output is rejected by audit if line 5 or line 7 lacks cinematic lighting/camera language.`;

export const FLUX_WOW_STYLE_GUIDE_SUFFIX =
  "Wow CG mode: sentences 5 and 7 are mandatory premium cinematic passes — follow <wow_cinematography> checklists exactly. Ignore reference-shape lines 5/7 if they are weaker or conflict with this scene.";

export const FLUX_WOW_COMPOSE_RETRY_SUFFIX =
  " Wow CG retry: line 5 needs key-light direction + rim + surface bounce + art_direction color grade; line 7 needs cinematic/lens/DOF/key-visual language — do not change lines 1–4.";

const WOW_LINE5_CINEMATIC_RE =
  /\b(?:key[- ]?light|rim light|backlight|fill light|bounce light|volumetric|color grade|golden hour|moonlight|cinematic lighting|vignette)\b/i;
const WOW_LINE7_CINEMATIC_RE =
  /\b(?:cinematic|(?:\d{2,3})\s*mm|lens feel|depth of field|bokeh|key visual|color grade|off-center|gallery shot|wide shot|wide cinematic)\b/i;

export interface FluxAuditOptions {
  wowArt?: boolean;
}

function getWowCinematographyViolations(lines: string[]): string[] {
  const violations: string[] = [];
  const line5 = lines[4] ?? "";
  const line7 = lines[6] ?? "";

  if (line5 && !WOW_LINE5_CINEMATIC_RE.test(line5)) {
    violations.push(
      "WOW CG: line 5 needs cinematic key/rim/fill lighting with direction, surface bounce, or color grade",
    );
  }
  if (line7 && !WOW_LINE7_CINEMATIC_RE.test(line7)) {
    violations.push("WOW CG: line 7 needs premium cinematic camera/lens/framing language");
  }
  if (
    line7 &&
    /\bmedium shot from behind at hip height\b/i.test(line7) &&
    !/\bcinematic\b/i.test(line7) &&
    !WOW_LINE7_CINEMATIC_RE.test(line7)
  ) {
    violations.push("WOW CG: line 7 must upgrade plain hip-height POV to cinematic framing");
  }
  return violations;
}

export function fluxComposeAuditRetryHintWithWow(facts: SceneFacts, wowArt = false): string {
  const base = fluxComposeAuditRetryHint(facts);
  return wowArt ? `${base}${FLUX_WOW_COMPOSE_RETRY_SUFFIX}` : base;
}

export function normalizePromptNames(prompt: string): string {
  return prompt.replace(/Лина/g, "Lina");
}

export function getFluxPromptViolations(
  prompt: string,
  facts: SceneFacts,
  opts: FluxAuditOptions = {},
): string[] {
  const violations: string[] = [];
  const lines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length !== 7) {
    violations.push(`expected 7 lines, got ${lines.length}`);
  }

  if (opts.wowArt === true && lines.length === 7) {
    violations.push(...getWowCinematographyViolations(lines));
  }

  if (HAIR_ON_STONE_PROMPT_RE.test(prompt) && FACE_IN_MIRROR_PROMPT_RE.test(prompt)) {
    violations.push("ONE FACE SOURCE: hair on stone combined with face in mirror");
  }

  if (facts.nsfw && !PENETRATION_RE.test(prompt)) {
    violations.push("NSFW: missing explicit penetration/contact clause");
  }

  if (MOTION_VERBS_RE.test(prompt)) {
    violations.push("FROZEN MOMENT: motion verbs detected");
  }

  if (lines[0] && LINE1_ACTION_RE.test(lines[0])) {
    violations.push("SUBJECT vs ACTION: line 1 contains explicit action");
  }

  if (lines[0] && LINE1_CONTACT_RE.test(lines[0])) {
    violations.push("SUBJECT vs ACTION: line 1 contains body contact");
  }

  if (lines[1] && protagHandsInLine(lines[1], facts) && PARTNER_SINK_HANDS_RE.test(lines[1])) {
    violations.push("HAND RESTRAINT: line 2 emphasizes both protagonist hands and partner sink-edge grip");
  }

  if (lines[1] && protagHandsInLine(lines[1], facts) && HAND_GRIP_INTENSIFIER_RE.test(lines[1])) {
    const gripCount = (lines[1].match(HAND_GRIP_INTENSIFIER_RE) ?? []).length;
    if (gripCount > 1 || PARTNER_SINK_HANDS_RE.test(lines[1])) {
      violations.push("HAND RESTRAINT: line 2 stacks multiple grip intensifiers");
    }
  }

  if (
    lines[1] &&
    lines[3] &&
    protagHandsInLine(lines[1], facts) &&
    protagHandsInLine(lines[3], facts)
  ) {
    violations.push(
      "DUPLICATE HANDS: protagonist hands in both lines 2 and 4 — keep hands on thighs in line 2 only; line 4 mirror shows face and flush only",
    );
  }

  if (needsProtagonistHandsInLine2(facts) && lines[1] && !protagHandsInLine(lines[1], facts)) {
    violations.push("POV: line 2 must describe protagonist hands on partner thighs");
  }

  if (facts.props.some((prop) => /door/i.test(prop)) && lines[2] && !/\bdoor\b/i.test(lines[2])) {
    violations.push("PROPS: line 3 must name the door");
  }

  if (facts.pov === "first_person" && LOW_ANGLE_RE.test(lines[6] ?? prompt)) {
    violations.push("POV CAMERA: low angle conflicts with first-person-from-behind; use hip height");
  }

  if (isFullSceneFacts(facts) && LOW_ANGLE_RE.test(lines[6] ?? prompt)) {
    violations.push("FULL SCENE: low angle conflicts with third-person wide shot");
  }

  if (
    isFullSceneFacts(facts) &&
    lines[6] &&
    /\bfrom behind at hip height\b/i.test(lines[6]) &&
    !/\bwide\b/i.test(lines[6])
  ) {
    violations.push("FULL SCENE: use wide or medium-wide third-person camera, not first-person hip height");
  }

  if (isFullSceneFacts(facts) && lines[0] && /\b(?:From my first-person view|my first-person)\b/i.test(lines[0])) {
    violations.push("FULL SCENE: line 1 must use third-person framing, not first-person POV");
  }

  if (
    facts.visible_body_parts.some((part) => part.toLowerCase() === "hips") &&
    !isFullSceneFacts(facts) &&
    !/\bhips\b/i.test(prompt)
  ) {
    violations.push("POV: missing hips from visible_body_parts");
  }

  if (
    !isFullSceneFacts(facts) &&
    facts.mirror_shows &&
    FACE_IN_TEXT_RE.test(facts.mirror_shows) &&
    lines[0] &&
    HAIR_SPILL_BACK_RE.test(lines[0])
  ) {
    violations.push("ONE FACE SOURCE: line 1 describes hair spilling/cascading when face is mirror-only");
  }

  if (/\bexpressive eyes\b/i.test(prompt)) {
    const hasClosedEyes = facts.characters.some((character) =>
      /\b(?:closed eyes|eyes closed)\b/i.test(character.expression),
    );
    if (hasClosedEyes) {
      violations.push("CONSISTENT EYES: expressive eyes conflicts with closed eyes in facts");
    }
  }

  return violations;
}

export function auditFluxPrompt(prompt: string, facts: SceneFacts, opts: FluxAuditOptions = {}): void {
  const violations = getFluxPromptViolations(prompt, facts, opts);
  if (violations.length > 0) {
    throw new Error(`flux prompt audit failed: ${violations.join("; ")}`);
  }
}

export interface FluxPromptQualityScore {
  score: number;
  violations: string[];
  warnings: string[];
}

export function scoreFluxPrompt(
  prompt: string,
  facts: SceneFacts,
  opts: FluxAuditOptions = {},
): FluxPromptQualityScore {
  const violations = getFluxPromptViolations(prompt, facts, opts);
  let score = 100 - violations.length * 25;
  const lines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines[1] && /\bgrip(?:ping)? firmly\b/i.test(lines[1])) score -= 10;
  if (lines[3] && protagHandsInLine(lines[3], facts) && HAND_GRIP_INTENSIFIER_RE.test(lines[3])) {
    score -= 10;
  }
  if (lines[2] && /\bsurrounded by\b/i.test(lines[2])) score -= 5;
  if (opts.wowArt !== true && !/\b(?:gold|purple|pink)\b/i.test(prompt)) score -= 5;
  if (facts.nsfw && !/\b(?:glistening|sweat|wet|flush(?:ed)?)\b/i.test(prompt)) score -= 5;
  if (lines[0] && /\bFrom my first-person view\b/i.test(lines[0])) score += 5;
  if (isFullSceneFacts(facts) && lines[0] && /\bthird-person\b/i.test(lines[0])) score += 5;
  if (isFullSceneFacts(facts) && lines[6] && /\bwide shot\b/i.test(lines[6])) score += 5;
  if (opts.wowArt === true && lines[4] && WOW_LINE5_CINEMATIC_RE.test(lines[4])) score += 8;
  if (opts.wowArt === true && lines[6] && WOW_LINE7_CINEMATIC_RE.test(lines[6])) score += 8;

  const warnings: string[] = [];
  if (lines[0] && HAIR_SPILL_BACK_RE.test(lines[0])) warnings.push("line1: hair spill/cascade phrasing");
  if (lines[2] && /\bsurrounded by\b/i.test(lines[2])) warnings.push("line3: inventory list phrasing");
  if (lines[2] && !/\bheavy closed door\b/i.test(lines[2]) && /\bdoor\b/i.test(lines[2])) {
    warnings.push("line3: door present but not 'heavy closed door'");
  }

  return { score: Math.max(0, score), violations, warnings };
}

export const FLUX_COMPOSE_AUDIT_RETRY_HINT =
  "Fix every issue. Line 1 must have zero contact. Line 2: one penetration clause + protagonist hands resting on thighs only. Line 4: mirror face only, no repeat of hands from line 2.";

export const FLUX_COMPOSE_AUDIT_RETRY_HINT_FULL =
  "Fix every issue. Line 1: third-person framing, both characters named, zero contact. Line 2: one penetration clause + his/the protagonist's hands on outer thighs. Line 4: mirror face only. Line 7: wide shot third-person camera, not first-person hip height or low angle.";

export function fluxComposeAuditRetryHint(facts: SceneFacts): string {
  return isFullSceneFacts(facts) ? FLUX_COMPOSE_AUDIT_RETRY_HINT_FULL : FLUX_COMPOSE_AUDIT_RETRY_HINT;
}
