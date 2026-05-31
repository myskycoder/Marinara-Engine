// ──────────────────────────────────────────────
// Image model family registry
// ──────────────────────────────────────────────
//
// Maps a configured image-generation connection (service/provider/model/baseUrl)
// to a coarse "model family" identifier and a short prose style guide that the
// image-prompt-writer agent paste verbatim into its meta-prompt. This lets the
// agent adapt prompt syntax to the target model without a per-model lookup
// table on every code path.
//
// The family is a best-effort coarse bucket — when nothing matches we return
// "generic" with neutral natural-language guidance.

import { inferImageSource } from "./model-lists.js";

export type ImageModelFamily =
  | "sdxl_booru"
  | "sdxl_natural"
  | "illustrious"
  | "pony"
  | "flux"
  | "dalle3"
  | "gpt_image"
  | "imagen"
  | "novelai_v3"
  | "novelai_v4"
  | "pollinations"
  | "comfyui"
  | "stability"
  | "horde"
  | "generic";

export interface ImageModelFamilyInfo {
  family: ImageModelFamily;
  /** Human-readable label, e.g. "Pony Diffusion (booru-tag SDXL)". */
  label: string;
  /**
   * Short prose guide describing how to phrase a prompt for this family.
   * Pasted verbatim into the image-prompt-writer agent's user message inside
   * the <target_image_model> block.
   */
  promptStyleGuide: string;
  /**
   * Optional companion guide describing typical negative-prompt conventions
   * for the family. The image-prompt-writer agent does NOT emit a separate
   * negative prompt today (the engine appends a fixed `GAME_ILLUSTRATION_NEGATIVE_PROMPT`),
   * but this string is exposed for future use and surfaced in tests.
   */
  negativeStyleGuide?: string;
}

export interface DetectImageModelFamilyInput {
  /** Resolved image service id (from `resolveImageGenerationService`). */
  service?: string | null;
  /** Optional provider id (chat-style, e.g. "openai_compatible"). */
  provider?: string | null;
  /** Image model identifier, e.g. "dall-e-3", "nai-diffusion-4-curated", "flux-schnell". */
  model?: string | null;
  /** Image connection base URL — used as a tiebreaker when service is generic. */
  baseUrl?: string | null;
}

const SDXL_BOORU_GUIDE = [
  "Target: vanilla SDXL anime / booru-style checkpoint (Animagine, Counterfeit, Anything-XL, etc.).",
  "Format: dense comma-separated Danbooru-style tags. Lowercase. Underscores allowed for compound tags (long_hair, blue_eyes). NO full sentences.",
  "Required ordering (every section comma-joined, sections separated by a single comma):",
  "  1. QUALITY PREFIX: `masterpiece, best quality, highly detailed, sharp focus, ultra-detailed`.",
  "  2. RATING: `rating_safe` for SFW; for NSFW use `rating_explicit, nsfw` (and explicit body-part / act tags later).",
  "  3. SUBJECT/CHARACTER: count + named character + appearance tags (1girl/1boy/2girls + species + age tag + hair/eye/skin tags + body type).",
  "  4. OUTFIT: every garment as a separate tag (school_uniform, white_shirt, plaid_skirt, thigh_highs, leather_gloves) plus clothing-state tags when relevant (clothes_lift, partially_undressed, torn_clothes).",
  "  5. POSE / ACTION: explicit pose / interaction tags (standing, sitting, leaning_forward, hand_on_hip, hugging, kissing, looking_at_viewer, looking_back, looking_down).",
  "  6. EXPRESSION: facial / emotion tags (smile, blush, half-closed_eyes, parted_lips, crying, angry).",
  "  7. COMPOSITION / FRAMING: shot tags (wide_shot, cowboy_shot, upper_body, close-up, portrait, full_body) + camera angle (from_above, from_below, from_side, from_behind, dutch_angle, dynamic_angle, pov).",
  "  8. ENVIRONMENT: location tags (forest, alleyway, victorian_bedroom, dimly_lit_room, rain, snow, indoors, outdoors).",
  "  9. LIGHTING / ATMOSPHERE: lighting tags (cinematic_lighting, rim_light, backlighting, volumetric_lighting, golden_hour, neon_lights, lens_flare).",
  "  10. STYLE / RENDER: art-style tags (anime_screencap, oil_painting_(medium), watercolor_(medium), official_art).",
  "Density rule: prefer 30–60 distinct tags over flowery prose. Token budget ~75 CLIP tokens for the bulk; the engine packs more.",
  "Weighting: you may use `(tag:1.2)` to boost a critical detail and `(tag:0.8)` to soften, but use sparingly (≤4 weighted tags).",
  "Avoid: full sentences, mood adjectives without grounding tags, narrative phrasing, English articles ('a', 'the').",
].join(" ");
const SDXL_NATURAL_GUIDE =
  "Use compact natural-language phrases separated by commas. Mix descriptive sentences with comma-joined modifier groups. Quality words like 'masterpiece, best quality, highly detailed' are still useful but optional. Avoid heavy booru tagging.";

const ILLUSTRIOUS_GUIDE = [
  "Target: Illustrious-XL family checkpoint (Illustrious-XL v0.1+, NoobAI-XL, WAI-ANI-NSFW-PONYXL, Hassaku-XL-Illustrious, Obsession-Illustrious, etc.). Trained on Danbooru, expects native Danbooru tag vocabulary.",
  "Format: dense comma-separated Danbooru tags. Lowercase. Underscores REQUIRED for compound tags (`long_hair`, `blue_eyes`, `school_uniform`, `looking_at_viewer`). NEVER write full English sentences — they hurt quality.",
  "Required ordering (every section comma-joined, sections separated by a single comma):",
  "  1. QUALITY PREFIX (Illustrious-specific, MANDATORY first): `masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, year 2024`. Optionally add `highres, ultra-detailed, official_art`.",
  "  2. RATING: `rating_safe` / `rating_questionable` / `rating_explicit` matching the scene. For NSFW also include `nsfw` (and explicit body-part / act tags later).",
  "  3. SUBJECT/CHARACTER: count tag (`1girl`, `1boy`, `2girls`, `1girl, 1boy`) → named character if known (`hatsune_miku`) → species/age tag (`young_woman`, `mature_woman`, `loli` only if rating + scene allow it) → physical tags (hair length, hair color, eye color, skin tone, body type, breast size, height tags).",
  "  4. OUTFIT: every garment as its own tag (`school_uniform`, `white_shirt`, `pleated_skirt`, `black_thighhighs`, `leather_gloves`, `choker`). Use clothing-state tags when relevant (`clothes_lift`, `partially_undressed`, `bottomless`, `torn_clothes`, `wet_clothes`, `see-through`, `nude`).",
  "  5. POSE / ACTION: explicit pose tags (`standing`, `sitting`, `lying`, `kneeling`, `on_back`, `on_stomach`, `leaning_forward`, `hand_on_hip`, `hugging`, `kissing`). For NSFW use the canonical Danbooru act tags (`vaginal`, `oral`, `anal`, `paizuri`, `straddling`, `cowgirl_position`, `missionary`, `doggystyle`, `restrained`, `bondage`).",
  "  6. EXPRESSION: facial tags (`smile`, `blush`, `half-closed_eyes`, `parted_lips`, `tears`, `ahegao`, `embarrassed`, `seductive_smile`, `angry`, `crying`).",
  "  7. COMPOSITION / FRAMING: shot tag (`wide_shot`, `cowboy_shot`, `upper_body`, `close-up`, `portrait`, `full_body`) + camera angle (`from_above`, `from_below`, `from_side`, `from_behind`, `pov`, `dutch_angle`, `dynamic_angle`). For player-POV scenes ALWAYS include `pov` and `first-person_view`.",
  "  8. ENVIRONMENT: location tags (`forest`, `alleyway`, `victorian_bedroom`, `dimly_lit_room`, `cyberpunk_city`, `rain`, `snow`, `indoors`, `outdoors`).",
  "  9. LIGHTING / ATMOSPHERE: `cinematic_lighting`, `rim_lighting`, `backlighting`, `volumetric_lighting`, `god_rays`, `golden_hour`, `neon_lights`, `lens_flare`, `chromatic_aberration`, `depth_of_field`, `bokeh`.",
  "  10. STYLE / RENDER: `anime_screencap`, `official_art`, `oil_painting_(medium)`, `watercolor_(medium)`, `(artist_name)` references when matching existing Danbooru tags.",
  "Density rule: 40–80 distinct tags is the sweet spot. Illustrious thrives on density.",
  "Weighting: you may use `(tag:1.2)` to boost a critical detail and `(tag:0.8)` to soften. Use sparingly (≤6 weighted tags).",
  "Year tag: appending `year 2024` (or `year 2023`) significantly biases the model toward modern, polished anime art — keep it in the quality prefix unless the scene needs a deliberately retro look (`year 2005`, `year 1995`).",
  "Forbidden: English articles (`a`, `the`), narrative sentences, mood adjectives without anchoring tags ('beautiful' alone — use `aesthetic` or `very_aesthetic`), CamelCase, spaces inside compound tags.",
].join(" ");
const PONY_GUIDE =
  "Pony Diffusion expects booru-style comma-separated tags PLUS the Pony-specific quality prefix `score_9, score_8_up, score_7_up, source_anime` (or `source_furry` / `source_pony` if relevant). Then lead with rating (`rating_safe` or `rating_explicit`), subject tags, composition, environment, style. Use lowercase snake_case tags.";
const FLUX_GUIDE = [
  "Target checkpoint: Flux 2 Klein (Black Forest Labs / ComfyUI).",
  "Write natural-language English using exactly seven sentences, one per line, in this order:",
  "1) Main subject (include first-person POV when applicable).",
  "2) What the subject is doing — one cinematic frozen moment with poses and actions clear enough for an illustrator to draw without guessing.",
  "3) Location and environment.",
  "4) Important visual details.",
  "5) Lighting description.",
  "6) Mood and atmosphere.",
  "7) Optional style/camera information.",
  'No booru tags. No "masterpiece" / "best quality". NSFW drafts: be maximally explicit and anatomically detailed — open poses, garment state, contact, and acts; never euphemize.',
].join(" ");
const DALLE3_GUIDE =
  "DALL·E 3 expects fluent natural-language sentences as if briefing an art director. Describe subject, composition, lighting, mood, camera angle, and art style in plain English. No tag dumps, no quality boilerplate, no negative-prompt syntax. Keep it under ~400 words.";
const GPT_IMAGE_GUIDE =
  "GPT-Image / Nano-Banana expect fluent natural-language descriptions, similar to DALL·E 3. Be concrete about subject, composition, lighting, and style. Avoid tag dumps and quality boilerplate.";
const IMAGEN_GUIDE =
  "Google Imagen expects rich natural-language descriptions. Mention subject, composition, lighting, lens/camera, and art style explicitly. No tag dumps, no quality boilerplate, no negative-prompt syntax.";
const NOVELAI_V3_GUIDE =
  "NovelAI v3 expects Danbooru-style comma-separated tags. Start with quality tags (`best quality, amazing quality, very aesthetic, absurdres`), then character tags, then composition, environment, lighting, style. Use lowercase, underscores allowed for compound tags. Wrap stress-emphasized terms in `{}` (boost) or `[]` (de-boost) when needed.";
const NOVELAI_V4_GUIDE =
  "NovelAI v4 supports natural-language phrases mixed with Danbooru-style tags. Prefer short comma-joined clauses; quality prefix `best quality, amazing quality, very aesthetic, absurdres` is still recommended. v4 understands character-region syntax (`Text 1.`, `Text 2.`) for multi-character framing — use it when more than one named character is visible.";
const POLLINATIONS_GUIDE =
  "Pollinations is a free, lightweight backend that accepts short descriptive prose (1–2 sentences). Avoid long booru-tag dumps; prefer concise English description of subject, mood, lighting, and style.";
const COMFYUI_GUIDE =
  "ComfyUI runs whatever workflow the user wired up — assume a vanilla SDXL/Pony/Illustrious checkpoint. Default to comma-separated booru-style tags with a short quality prefix (`masterpiece, best quality, highly detailed`) unless the model name suggests Flux (then switch to natural-language prose).";
const STABILITY_GUIDE =
  "Stability API (SD3 / SDXL hosted) accepts both natural-language sentences and comma-joined modifiers. Lead with a one-sentence subject description, then comma-joined style/lighting/composition modifiers. Quality words ('masterpiece, best quality') help on SDXL, less so on SD3.";
const HORDE_GUIDE =
  "AI Horde routes to community workers running mostly SDXL / SD1.5 checkpoints. Use comma-separated booru-style tags with a quality prefix (`masterpiece, best quality, highly detailed`). Keep prompts compact — Horde workers truncate aggressively.";
const GENERIC_GUIDE =
  "Use clear natural-language sentences describing subject, composition, lighting, mood, and style. Avoid backend-specific tag syntax. Keep the prompt under ~400 words.";

const SDXL_NEGATIVE = "lowres, bad anatomy, worst quality, low quality, jpeg artifacts, watermark, signature, blurry";
const PONY_NEGATIVE = `score_4, score_3, score_2, score_1, ${SDXL_NEGATIVE}`;
const NOVELAI_NEGATIVE =
  "lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark";
const NATURAL_NEGATIVE = "(natural-language families generally do not use a separate negative prompt)";

const FAMILY_INFO: Record<ImageModelFamily, ImageModelFamilyInfo> = {
  sdxl_booru: {
    family: "sdxl_booru",
    label: "SDXL anime / booru-tag (Animagine, Counterfeit, Anything-XL)",
    promptStyleGuide: SDXL_BOORU_GUIDE,
    negativeStyleGuide: SDXL_NEGATIVE,
  },
  sdxl_natural: {
    family: "sdxl_natural",
    label: "SDXL (natural-language)",
    promptStyleGuide: SDXL_NATURAL_GUIDE,
    negativeStyleGuide: SDXL_NEGATIVE,
  },
  illustrious: {
    family: "illustrious",
    label: "Illustrious-XL / NoobAI / WAI / Hassaku-IL (Danbooru-tag, anime)",
    promptStyleGuide: ILLUSTRIOUS_GUIDE,
    negativeStyleGuide:
      "worst quality, low quality, normal quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, jpeg artifacts, signature, watermark, username, text, blurry, lowres, ugly, deformed, mutated, censored, mosaic_censoring, bar_censor",
  },
  pony: {
    family: "pony",
    label: "Pony Diffusion (booru-tag SDXL)",
    promptStyleGuide: PONY_GUIDE,
    negativeStyleGuide: PONY_NEGATIVE,
  },
  flux: {
    family: "flux",
    label: "Flux 2 Klein (natural-language)",
    promptStyleGuide: FLUX_GUIDE,
    negativeStyleGuide: NATURAL_NEGATIVE,
  },
  dalle3: {
    family: "dalle3",
    label: "OpenAI DALL·E 3",
    promptStyleGuide: DALLE3_GUIDE,
    negativeStyleGuide: NATURAL_NEGATIVE,
  },
  gpt_image: {
    family: "gpt_image",
    label: "OpenAI gpt-image / Nano-Banana",
    promptStyleGuide: GPT_IMAGE_GUIDE,
    negativeStyleGuide: NATURAL_NEGATIVE,
  },
  imagen: {
    family: "imagen",
    label: "Google Imagen",
    promptStyleGuide: IMAGEN_GUIDE,
    negativeStyleGuide: NATURAL_NEGATIVE,
  },
  novelai_v3: {
    family: "novelai_v3",
    label: "NovelAI v3 (Danbooru-tag)",
    promptStyleGuide: NOVELAI_V3_GUIDE,
    negativeStyleGuide: NOVELAI_NEGATIVE,
  },
  novelai_v4: {
    family: "novelai_v4",
    label: "NovelAI v4 (mixed)",
    promptStyleGuide: NOVELAI_V4_GUIDE,
    negativeStyleGuide: NOVELAI_NEGATIVE,
  },
  pollinations: {
    family: "pollinations",
    label: "Pollinations",
    promptStyleGuide: POLLINATIONS_GUIDE,
    negativeStyleGuide: NATURAL_NEGATIVE,
  },
  comfyui: {
    family: "comfyui",
    label: "ComfyUI workflow",
    promptStyleGuide: COMFYUI_GUIDE,
    negativeStyleGuide: SDXL_NEGATIVE,
  },
  stability: {
    family: "stability",
    label: "Stability API (SD3 / SDXL)",
    promptStyleGuide: STABILITY_GUIDE,
    negativeStyleGuide: SDXL_NEGATIVE,
  },
  horde: {
    family: "horde",
    label: "AI Horde (community SDXL/SD1.5)",
    promptStyleGuide: HORDE_GUIDE,
    negativeStyleGuide: SDXL_NEGATIVE,
  },
  generic: {
    family: "generic",
    label: "Generic image model",
    promptStyleGuide: GENERIC_GUIDE,
    negativeStyleGuide: NATURAL_NEGATIVE,
  },
};

/** Look up family info by id. Falls back to "generic" for unknown ids. */
export function getImageModelFamilyInfo(family: ImageModelFamily | string | null | undefined): ImageModelFamilyInfo {
  if (typeof family === "string" && family in FAMILY_INFO) {
    return FAMILY_INFO[family as ImageModelFamily];
  }
  return FAMILY_INFO.generic;
}

function normalizeService(service: string | null | undefined): string {
  return (service ?? "").trim().toLowerCase();
}

function normalizeModel(model: string | null | undefined): string {
  return (model ?? "").trim().toLowerCase();
}

function normalizeBaseUrl(baseUrl: string | null | undefined): string {
  return (baseUrl ?? "").trim().toLowerCase();
}

/**
 * Detect the image-model family from the resolved service id, the model
 * identifier, the provider id, and the base URL. Returns the registry entry —
 * always a defined value (falls back to "generic").
 *
 * Resolution priority:
 *   1. Service-first for backends that DICTATE prompt syntax regardless of
 *      the model alias (Pollinations, NovelAI, Horde — they have a single
 *      house style and the model name is just a worker selector).
 *   2. Model-name overrides for backends where the *model* identifies the
 *      style (a Pony checkpoint loaded into ComfyUI is still Pony, etc.).
 *   3. Service fallback for remaining cases (openai → dalle3, comfyui → comfyui,
 *      automatic1111 → sdxl_booru, openrouter → flux, etc.).
 */
export function detectImageModelFamily(input: DetectImageModelFamilyInput): ImageModelFamilyInfo {
  const model = normalizeModel(input.model);
  let service = normalizeService(input.service);
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  // If the caller didn't pre-resolve the service, reuse the same heuristics
  // the image-generation pipeline uses so detection stays consistent.
  if (!service) {
    service = inferImageSource(input.model ?? "", input.baseUrl ?? "");
  }

  // ── Step 1: service-first branches (backend dictates prompt syntax) ──
  switch (service) {
    case "pollinations":
      return FAMILY_INFO.pollinations;
    case "novelai":
      if (model.includes("nai-diffusion-4") || model.includes("nai_diffusion_4")) {
        return FAMILY_INFO.novelai_v4;
      }
      return FAMILY_INFO.novelai_v3;
    case "horde":
    case "blockentropy":
      // Community SDXL/SD1.5 worker pool — tags are king regardless of the
      // specific checkpoint the worker is running.
      return FAMILY_INFO.horde;
    case "stability":
      if (model.startsWith("sd3") || model.includes("stable-diffusion-3") || model.includes("sd3-")) {
        return FAMILY_INFO.sdxl_natural;
      }
      return FAMILY_INFO.stability;
    default:
      break;
  }

  // ── Step 2: model-name overrides (for services where the model picks the family) ──
  if (model.includes("pony") || model.includes("pony-diffusion") || model.includes("pony_diffusion")) {
    return FAMILY_INFO.pony;
  }
  if (model.includes("flux") || model.includes("black-forest")) {
    return FAMILY_INFO.flux;
  }
  if (model.startsWith("dall-e") || model.includes("dalle3")) {
    // dall-e-2 / dall-e-3 — both bucketed under dalle3 for prompt-style purposes.
    return FAMILY_INFO.dalle3;
  }
  if (model.startsWith("gpt-image") || model.includes("nano-banana") || model.includes("nano_banana")) {
    return FAMILY_INFO.gpt_image;
  }
  if (model.includes("imagen") || model.includes("gemini-2.5-flash-image") || model.includes("gemini-image")) {
    return FAMILY_INFO.imagen;
  }
  if (model.includes("nai-diffusion-4") || model.includes("nai_diffusion_4")) {
    return FAMILY_INFO.novelai_v4;
  }
  if (model.includes("nai-diffusion") || model.includes("nai_diffusion")) {
    return FAMILY_INFO.novelai_v3;
  }
  // Illustrious-XL family (Illustrious / NoobAI / Hassaku-IL / Obsession-IL /
  // WAI-* Illustrious variants). These share Illustrious's Danbooru-tag
  // training so they need the Illustrious-specific quality prefix and
  // vocabulary (year tags, aesthetic tags), NOT the generic SDXL booru guide.
  //
  // IMPORTANT: this branch must run BEFORE the Pony branch below, because
  // some Illustrious-derived checkpoints (e.g. `wai-ani-illustrious-v14`)
  // include the substring "wai-ani" but NOT "pony". Conversely, true Pony
  // forks (e.g. `wai-ani-nsfw-ponyxl-v11`) correctly contain "pony" and
  // should fall through to the Pony branch below. To avoid mis-routing
  // those, we explicitly require Illustrious markers without "pony".
  //
  // We use plain `.includes()` instead of `\b` word boundaries because
  // checkpoint filenames are routinely glued together without separators
  // (`illustriousXL_v01.safetensors`, `noobaiXLNAIXL_vPred10.safetensors`,
  // `obsessionillustriousxl_v15`) — `\b` would miss those entirely.
  const looksIllustrious =
    !model.includes("pony") &&
    (model.includes("illustrious") ||
      model.includes("noobai") ||
      model.includes("noob_ai") ||
      model.includes("noob-ai") ||
      model.includes("hassakuil") ||
      model.includes("hassaku-il") ||
      model.includes("hassaku_il") ||
      model.includes("obsessionillustrious") ||
      model.includes("obsession-il") ||
      model.includes("obsession_il") ||
      // Common Illustrious community shorthands
      model.includes("ilxl") ||
      model.includes("il-xl") ||
      model.includes("il_xl") ||
      // WAI-* family: WAI-Illustrious vs WAI-Pony already disambiguated by
      // the !model.includes("pony") guard above.
      (model.includes("wai") && model.includes("ani")));
  if (looksIllustrious) {
    return FAMILY_INFO.illustrious;
  }
  // Animagine is a vanilla SDXL anime checkpoint, not Illustrious — keep
  // it on the general SDXL booru guide which has its own (different)
  // quality prefix.
  if (model.includes("animagine")) {
    return FAMILY_INFO.sdxl_booru;
  }
  if (model.startsWith("sd3") || model.includes("stable-diffusion-3") || model.includes("sd3-")) {
    return FAMILY_INFO.sdxl_natural;
  }
  if (model.includes("sdxl") || model.includes("sd_xl") || model.includes("juggernaut")) {
    return FAMILY_INFO.sdxl_booru;
  }

  // ── Step 3: service fallback ──
  switch (service) {
    case "openai":
      // OpenAI service usually means dall-e-* / gpt-image. Default to dalle3
      // when we couldn't tell from the model name.
      return FAMILY_INFO.dalle3;
    case "nanogpt":
      return FAMILY_INFO.gpt_image;
    case "gemini_image":
      return FAMILY_INFO.imagen;
    case "comfyui":
      return FAMILY_INFO.comfyui;
    case "automatic1111":
      // A1111 / DrawThings — assume an SDXL booru-tag checkpoint.
      return FAMILY_INFO.sdxl_booru;
    case "togetherai":
      // Together.ai mostly hosts FLUX / Black Forest models for image gen.
      return FAMILY_INFO.flux;
    case "openrouter":
      // OpenRouter routes mostly to FLUX / Gemini image / DALL·E.
      if (baseUrl.includes("openrouter.ai")) {
        return FAMILY_INFO.flux;
      }
      return FAMILY_INFO.generic;
    default:
      return FAMILY_INFO.generic;
  }
}
