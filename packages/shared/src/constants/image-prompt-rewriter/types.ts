import type { ImageModelFamily } from "../image-model-families.js";

export type RewriterMode = "fast" | "premium";

export type RewriterPromptFamily =
  | "flux"
  | "illustrious"
  | "pony"
  | "sdxl_booru"
  | "novelai_v3"
  | "novelai_v4"
  | "natural_language";

export type RewriteModeSetting = "auto" | RewriterMode;

export interface RewriterPromptBundle {
  fast: string;
  premium: string;
}

/** Map image-model family ids to rewriter prompt bundles. */
export type RewriterFamilyMap = Record<RewriterPromptFamily, RewriterPromptBundle>;

export function mapImageFamilyToRewriterFamily(family: ImageModelFamily | string): RewriterPromptFamily {
  switch (family) {
    case "flux":
    case "comfyui":
      return "flux";
    case "illustrious":
      return "illustrious";
    case "pony":
      return "pony";
    case "sdxl_booru":
    case "horde":
    case "stability":
      return "sdxl_booru";
    case "novelai_v3":
      return "novelai_v3";
    case "novelai_v4":
      return "novelai_v4";
    case "dalle3":
    case "gpt_image":
    case "imagen":
    case "pollinations":
    case "sdxl_natural":
    case "generic":
    default:
      return "natural_language";
  }
}
