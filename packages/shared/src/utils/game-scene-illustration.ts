import type { SceneSegmentEffect } from "../types/sidecar.js";

export function isIllustrationBgTag(tag: string | null | undefined): boolean {
  return typeof tag === "string" && tag.startsWith("backgrounds:illustrations:");
}

export function segmentHasUnresolvedIllustrationBg(
  segment: number,
  segmentEffects: SceneSegmentEffect[] | undefined,
  assetMap: Record<string, unknown> | null | undefined,
): boolean {
  const fx = segmentEffects?.find((e) => e.segment === segment);
  if (!fx?.background || !isIllustrationBgTag(fx.background)) return false;
  return !assetMap?.[fx.background];
}

export interface ShouldDeferIllustrationSegmentOptions {
  segmentEffects?: SceneSegmentEffect[];
  /** Scene analysis requested illustration at this segment but async gen has not finished. */
  pendingIllustrationSegment?: number | null;
  generatedIllustration?: { tag: string; segment?: number } | null;
  assetMap?: Record<string, unknown> | null;
}

export function shouldDeferIllustrationSegment(
  segment: number,
  options: ShouldDeferIllustrationSegmentOptions,
): boolean {
  const { segmentEffects, pendingIllustrationSegment, generatedIllustration, assetMap } = options;

  if (
    pendingIllustrationSegment !== null &&
    pendingIllustrationSegment !== undefined &&
    pendingIllustrationSegment === segment &&
    !generatedIllustration?.tag
  ) {
    return true;
  }

  return segmentHasUnresolvedIllustrationBg(segment, segmentEffects, assetMap);
}

export function shouldSkipUnresolvedIllustrationBackground(
  background: string | undefined,
  assetMap: Record<string, unknown> | null | undefined,
): boolean {
  if (!background || !isIllustrationBgTag(background)) return false;
  return !assetMap?.[background];
}
