import { REWRITER_SHARED_RULES, buildStyleProfileBlock, type RewriterStyleContext } from "./shared-rules.js";
import { FLUX_REWRITER_PROMPTS } from "./flux.js";
import { ILLUSTRIOUS_REWRITER_PROMPTS } from "./illustrious.js";
import { PONY_REWRITER_PROMPTS } from "./pony.js";
import { SDXL_BOORU_REWRITER_PROMPTS } from "./sdxl-booru.js";
import { NOVELAI_V3_REWRITER_PROMPTS, NOVELAI_V4_REWRITER_PROMPTS } from "./novelai.js";
import { NATURAL_LANGUAGE_REWRITER_PROMPTS } from "./natural-language.js";
import { SCENE_COMPILER_SYSTEM_PROMPT, sanitizeCompiledSceneYaml, validateCompiledSceneYaml } from "./scene-compiler.js";
import { SALIENCY_REDUCER_SYSTEM_PROMPT, sanitizeSaliencyYaml, VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT } from "./saliency-reducer.js";
import { resolvePromptDirectorSystemPrompt } from "./prompt-director.js";
import { SHOT_DIRECTOR_SYSTEM_PROMPT, sanitizeShotGraphYaml } from "./shot-director.js";
import {
  VISUAL_DIRECTOR_SYSTEM_PROMPT,
  sanitizeVisualDirectorYaml,
  splitVisualDirectorYaml,
} from "./visual-director.js";
import {
  mapImageFamilyToRewriterFamily,
  type RewriterMode,
  type RewriterPromptBundle,
  type RewriterPromptFamily,
  type RewriteModeSetting,
} from "./types.js";

const REWRITER_PROMPTS: Record<RewriterPromptFamily, RewriterPromptBundle> = {
  flux: FLUX_REWRITER_PROMPTS,
  illustrious: ILLUSTRIOUS_REWRITER_PROMPTS,
  pony: PONY_REWRITER_PROMPTS,
  sdxl_booru: SDXL_BOORU_REWRITER_PROMPTS,
  novelai_v3: NOVELAI_V3_REWRITER_PROMPTS,
  novelai_v4: NOVELAI_V4_REWRITER_PROMPTS,
  natural_language: NATURAL_LANGUAGE_REWRITER_PROMPTS,
};

const PREMIUM_REASON_PATTERNS = [
  /\bgallery\b/i,
  /\bplayer[\s-]?requested\b/i,
  /\bcover\s*art\b/i,
  /\bmarketing\b/i,
  /\bkey\s+cg\b/i,
  /\bunlock\b/i,
  /\bpremium\b/i,
  /\bspecial[\s-]?scene\b/i,
  /\bmajor\s+(beat|moment|turn)\b/i,
  /\bemotional\s+peak\b/i,
];

export type SceneCompileSetting = "premium" | "off";

/**
 * Resolve FAST vs PREMIUM rewrite mode from agent settings and illustration reason.
 */
export function resolveRewriterMode(
  setting: RewriteModeSetting | null | undefined,
  reason: string | null | undefined,
): RewriterMode {
  const normalized = setting === "fast" || setting === "premium" ? setting : "auto";
  if (normalized === "fast" || normalized === "premium") return normalized;

  const reasonText = (reason ?? "").trim();
  if (!reasonText) return "fast";

  for (const pattern of PREMIUM_REASON_PATTERNS) {
    if (pattern.test(reasonText)) return "premium";
  }
  return "fast";
}

export function isFluxRewriterFamily(imageFamily: string): boolean {
  return mapImageFamilyToRewriterFamily(imageFamily) === "flux";
}

/**
 * Build the family-specific system prompt for the image prompt rewriter.
 */
export function resolveRewriterSystemPrompt(
  imageFamily: string,
  mode: RewriterMode,
  styleCtx?: RewriterStyleContext | null,
): string {
  const rewriterFamily = mapImageFamilyToRewriterFamily(imageFamily);
  const bundle = REWRITER_PROMPTS[rewriterFamily];
  const familyPrompt = mode === "premium" ? bundle.premium : bundle.fast;
  const styleBlock = buildStyleProfileBlock(styleCtx);
  const parts = [REWRITER_SHARED_RULES, "", familyPrompt];
  if (styleBlock) parts.push("", styleBlock);
  return parts.join("\n");
}

export {
  mapImageFamilyToRewriterFamily,
  SCENE_COMPILER_SYSTEM_PROMPT,
  sanitizeCompiledSceneYaml,
  validateCompiledSceneYaml,
  SALIENCY_REDUCER_SYSTEM_PROMPT,
  VISUAL_TOKEN_EXTRACTOR_SYSTEM_PROMPT,
  sanitizeSaliencyYaml,
  resolvePromptDirectorSystemPrompt,
  SHOT_DIRECTOR_SYSTEM_PROMPT,
  sanitizeShotGraphYaml,
  VISUAL_DIRECTOR_SYSTEM_PROMPT,
  sanitizeVisualDirectorYaml,
  splitVisualDirectorYaml,
  buildStyleProfileBlock,
  type RewriterMode,
  type RewriterPromptFamily,
  type RewriteModeSetting,
  type RewriterStyleContext,
};
