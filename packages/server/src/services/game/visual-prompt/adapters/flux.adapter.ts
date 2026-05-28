import type { FluxStyleContext } from "../../flux-static-style.js";
import { buildFluxStaticStyleBlock, FLUX_CRITICAL_STYLE_ANCHORS } from "../../flux-static-style.js";
import type { SceneAst, ShotGraph, VisualTokenBundle } from "@marinara-engine/shared";
import { fluxPhrasesForTokens, normalizeTokenSlug } from "@marinara-engine/shared";

export interface FluxAdapterInput {
  scene: SceneAst;
  tokens: VisualTokenBundle;
  shot: ShotGraph;
  style: FluxStyleContext;
}

export interface FluxAdapterResult {
  prompt: string;
  block3FilteredOut: string[];
  cameraDuplicatesRemoved: number;
}

function normalizeShotCameraSlugs(shot: ShotGraph): {
  lens: string;
  framing: string;
  dof: string;
  angle?: string;
  distance?: string;
} {
  return {
    lens: normalizeTokenSlug(shot.camera?.lens ?? "35mm"),
    framing: normalizeTokenSlug(shot.camera?.framing ?? "tight_medium"),
    dof: normalizeTokenSlug(shot.camera?.dof ?? "shallow_dof"),
    angle: shot.camera?.angle ? normalizeTokenSlug(shot.camera.angle) : undefined,
    distance: shot.camera?.distance ? normalizeTokenSlug(shot.camera.distance) : undefined,
  };
}

function dedupePhrases(parts: string[], seen: Set<string>): { parts: string[]; removed: number } {
  const out: string[] = [];
  let removed = 0;
  for (const part of parts) {
    const key = part.toLowerCase().trim();
    if (!key) continue;
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    out.push(part);
  }
  return { parts: out, removed };
}

function collapseCommaDuplicates(text: string): string {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }
  return unique.join(", ");
}

/** Deterministic Flux prompt: fixed section order, code-generated phrases. */
export function assembleFluxPromptFromGraph(input: FluxAdapterInput): FluxAdapterResult {
  const { tokens, shot, style } = input;
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  const cameraSlugs = normalizeShotCameraSlugs(shot);

  const povRaw = fluxPhrasesForTokens(
    tokens.camera_tokens.filter((t) => /first_person|pov/i.test(t)).length
      ? tokens.camera_tokens
      : ["first_person", ...tokens.camera_tokens],
  );
  const cameraRaw = fluxPhrasesForTokens([
    cameraSlugs.lens,
    cameraSlugs.framing,
    cameraSlugs.dof,
    ...(cameraSlugs.angle ? [cameraSlugs.angle] : []),
    ...(cameraSlugs.distance ? [cameraSlugs.distance] : []),
  ]);

  const povDeduped = dedupePhrases(povRaw, seen);
  duplicatesRemoved += povDeduped.removed;
  const povParts = povDeduped.parts;

  const cameraDeduped = dedupePhrases(cameraRaw, seen);
  duplicatesRemoved += cameraDeduped.removed;
  const cameraParts = cameraDeduped.parts;

  const compositionRaw = fluxPhrasesForTokens(tokens.composition_tokens);
  if (shot.frame_layout?.mirror_centered) compositionRaw.push("mirror reflection centered behind subject");
  if (shot.subject_blocking?.face_visibility === "mirror_only") {
    compositionRaw.push("face visible only through mirror reflection");
  }
  const compositionDeduped = dedupePhrases(compositionRaw, seen);
  duplicatesRemoved += compositionDeduped.removed;
  const compositionParts = compositionDeduped.parts;

  const subjectDeduped = dedupePhrases(fluxPhrasesForTokens(tokens.subject_tokens), seen);
  duplicatesRemoved += subjectDeduped.removed;

  const poseDeduped = dedupePhrases(fluxPhrasesForTokens(tokens.pose_tokens.slice(0, 3)), seen);
  duplicatesRemoved += poseDeduped.removed;

  const interactionDeduped = dedupePhrases(fluxPhrasesForTokens(tokens.interaction_tokens), seen);
  duplicatesRemoved += interactionDeduped.removed;

  const expressionDeduped = dedupePhrases(fluxPhrasesForTokens(tokens.expression_tokens ?? []), seen);
  duplicatesRemoved += expressionDeduped.removed;

  const envDeduped = dedupePhrases(
    fluxPhrasesForTokens([
      ...tokens.environment_tokens,
      ...(input.scene.environment?.room ? [input.scene.environment.room] : []),
    ]),
    seen,
  );
  duplicatesRemoved += envDeduped.removed;

  const materialDeduped = dedupePhrases(fluxPhrasesForTokens(tokens.material_tokens), seen);
  duplicatesRemoved += materialDeduped.removed;

  if (shot.pov_constraints?.includes("no_player_body")) {
    const extra = dedupePhrases(["no protagonist body visible"], seen);
    duplicatesRemoved += extra.removed;
    povParts.push(...extra.parts);
  }
  if (shot.pov_constraints?.includes("hands_at_frame_edge_only")) {
    const extra = dedupePhrases(["only player hands at bottom edge of frame"], seen);
    duplicatesRemoved += extra.removed;
    povParts.push(...extra.parts);
  }

  const block1 = collapseCommaDuplicates(
    [
      ...povParts,
      ...cameraParts.slice(0, 4),
      ...subjectDeduped.parts.slice(0, 2),
      ...poseDeduped.parts.slice(0, 3),
      ...expressionDeduped.parts.slice(0, 3),
      ...interactionDeduped.parts.slice(0, 3),
    ]
      .filter(Boolean)
      .join(", "),
  );

  const block2 = collapseCommaDuplicates(
    [
      ...compositionParts.slice(0, 4),
      ...envDeduped.parts.slice(0, 4),
      ...materialDeduped.parts.slice(0, 2),
    ]
      .filter(Boolean)
      .join(", "),
  );

  const environmentHints = [...tokens.environment_tokens, input.scene.environment?.room ?? ""].filter(Boolean);
  const styleResult = buildFluxStaticStyleBlock(style, environmentHints);
  const block3 = styleResult.block;

  const prompt = [block1, block2, block3].filter(Boolean).join("\n\n");

  return {
    prompt,
    block3FilteredOut: styleResult.filteredOut,
    cameraDuplicatesRemoved: duplicatesRemoved,
  };
}

const FLUX_EXPRESSION_PART_RE =
  /flushed face|tear streak|open mouth|head thrown back|gasping|biting lip|half-lidded|eyes rolled|blushing|drooling/i;

const FLUX_CONSTRAINT_PART_RE =
  /single shot|no panels|single character|anatomically correct|protagonist body|bottom edge of frame|mirror reflection unobstructed|full hands visible/i;

function splitCommaParts(block: string): string[] {
  return block.split(",").map((p) => p.trim()).filter(Boolean);
}

function joinFluxBlocks(block1Parts: string[], block2Parts: string[], anchors: string[]): string {
  const segments: string[] = [];
  if (block1Parts.length) segments.push(block1Parts.join(", "));
  if (block2Parts.length) segments.push(block2Parts.join(", "));
  if (anchors.length) segments.push(anchors.join(", "));
  return segments.join("\n\n");
}

function isExpressionPart(part: string): boolean {
  return FLUX_EXPRESSION_PART_RE.test(part);
}

function isConstraintPart(part: string): boolean {
  return FLUX_CONSTRAINT_PART_RE.test(part);
}

function dropLowestPriorityFluxPart(block1Parts: string[], block2Parts: string[]): boolean {
  if (block2Parts.length > 1) {
    block2Parts.pop();
    return true;
  }

  for (let i = block1Parts.length - 1; i >= 0; i--) {
    const part = block1Parts[i]!;
    if (isExpressionPart(part) || isConstraintPart(part)) continue;
    block1Parts.splice(i, 1);
    return true;
  }

  for (let i = block1Parts.length - 1; i >= 0; i--) {
    const part = block1Parts[i]!;
    if (isExpressionPart(part)) continue;
    block1Parts.splice(i, 1);
    return true;
  }

  if (block1Parts.length > 1) {
    block1Parts.pop();
    return true;
  }

  return false;
}

/** Priority-based Flux prompt clamp preserving expressions and critical style anchors. */
export function clampFluxPromptByPriority(prompt: string, maxChars = 850): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const blocks = trimmed.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const block1Parts = splitCommaParts(blocks[0] ?? "");
  const block2Parts = splitCommaParts(blocks[1] ?? "");
  const block3Raw = blocks.slice(2).join(", ");

  const styleTokens = splitCommaParts(block3Raw);
  const anchorSet = new Set(FLUX_CRITICAL_STYLE_ANCHORS.map((a) => a.toLowerCase()));
  const anchors = styleTokens.filter((t) => anchorSet.has(t.toLowerCase()));

  let assembled = joinFluxBlocks(block1Parts, block2Parts, anchors);
  if (assembled.length <= maxChars) return assembled;

  while (assembled.length > maxChars && dropLowestPriorityFluxPart(block1Parts, block2Parts)) {
    assembled = joinFluxBlocks(block1Parts, block2Parts, anchors);
  }

  if (assembled.length <= maxChars) return assembled;

  return assembled.slice(0, maxChars).replace(/,\s*[^,]*$/, "").trim();
}
