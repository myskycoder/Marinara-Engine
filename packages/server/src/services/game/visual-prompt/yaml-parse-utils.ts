import {
  VisualTokenBundleSchema,
  ShotGraphSchema,
  stripCodeFences,
  type VisualTokenBundle,
  type ShotGraph,
  type SceneAst,
} from "@marinara-engine/shared";

function stripYamlQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

/** Parse a YAML list section; supports optional key indent and 2/4-space list items. */
function extractYamlListItems(yaml: string, sectionKey: string): string[] {
  const lines = yaml.split("\n");
  let sectionLineIdx = -1;
  let sectionIndent = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(new RegExp(`^(\\s*)${sectionKey}:\\s*(.*)$`));
    if (!match) continue;
    sectionLineIdx = i;
    sectionIndent = match[1] ?? "";
    const inline = (match[2] ?? "").trim();
    if (inline === "[]") return [];
    break;
  }

  if (sectionLineIdx < 0) return [];

  const items: string[] = [];
  for (let i = sectionLineIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;

    const listMatch = line.match(/^(\s*)-\s+(.+)$/);
    if (listMatch) {
      items.push(stripYamlQuotes(listMatch[2] ?? ""));
      continue;
    }

    // Sibling YAML key (e.g. pose_tokens after subject_tokens) ends the list.
    if (/^\s*[\w_]+:\s*/.test(line)) break;
  }

  return items;
}

function extractYamlSubBlock(yaml: string, sectionKey: string): string {
  const lines = yaml.split("\n");
  let startIdx = -1;
  let sectionIndent = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(new RegExp(`^(\\s*)${sectionKey}:\\s*$`));
    if (!match) continue;
    startIdx = i;
    sectionIndent = match[1] ?? "";
    break;
  }

  if (startIdx < 0) return "";

  const blockLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      blockLines.push(line);
      continue;
    }
    const indentLen = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indentLen <= sectionIndent.length && /^\s*[\w_]+:\s*/.test(line)) break;
    blockLines.push(line);
  }

  return blockLines.join("\n");
}

function extractScalar(yaml: string, key: string, _indent = "  "): string | null {
  const match = yaml.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  return match?.[1] ? stripYamlQuotes(match[1]) : null;
}

function extractBool(yaml: string, key: string, indent = "  "): boolean | undefined {
  const val = extractScalar(yaml, key, indent);
  if (val === "true") return true;
  if (val === "false") return false;
  return undefined;
}

export { stripCodeFences };

export function parseVisualTokenBundleYaml(yaml: string): VisualTokenBundle {
  const bundle = {
    subject_tokens: extractYamlListItems(yaml, "subject_tokens"),
    pose_tokens: extractYamlListItems(yaml, "pose_tokens"),
    interaction_tokens: extractYamlListItems(yaml, "interaction_tokens"),
    composition_tokens: extractYamlListItems(yaml, "composition_tokens"),
    expression_tokens: extractYamlListItems(yaml, "expression_tokens"),
    material_tokens: extractYamlListItems(yaml, "material_tokens"),
    camera_tokens: extractYamlListItems(yaml, "camera_tokens"),
    environment_tokens: extractYamlListItems(yaml, "environment_tokens"),
    discarded_tokens: extractYamlListItems(yaml, "discarded_tokens"),
  };
  return VisualTokenBundleSchema.parse(bundle);
}

/** Fallback: parse legacy saliency YAML (dominant_pose, important_visuals) into token bundle. */
export function parseLegacySaliencyToTokens(yaml: string): VisualTokenBundle {
  const dominant = extractYamlListItems(yaml, "dominant_pose");
  const important = extractYamlListItems(yaml, "important_visuals");
  const secondary = extractYamlListItems(yaml, "secondary_visuals");
  const discarded = extractYamlListItems(yaml, "discarded_details");
  const composition = extractYamlListItems(yaml, "composition_directives");

  return VisualTokenBundleSchema.parse({
    subject_tokens: important.filter((t) => /hair|dress|woman|appearance/i.test(t)).map((t) => slugifyToken(t)),
    pose_tokens: dominant.length ? dominant : important.filter((t) => /bent|arch|hand|head/i.test(t)).map(slugifyToken),
    interaction_tokens: important.filter((t) => /penetrat|rhythm|hip|contact|behind/i.test(t)).map(slugifyToken),
    composition_tokens: composition.map(slugifyToken),
    expression_tokens: important.filter((t) => /flush|tear|mouth|moan|gasp|blush/i.test(t)).map(slugifyToken),
    material_tokens: [...important, ...secondary].filter((t) => /marble|tile|skin|sheen|neon|gold/i.test(t)).map(slugifyToken),
    camera_tokens: ["first_person", "35mm", "shallow_dof"],
    environment_tokens: secondary.filter((t) => /marble|bathroom|mirror|tile|fixture/i.test(t)).map(slugifyToken),
    discarded_tokens: discarded.map(slugifyToken),
  });
}

function slugifyToken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 64);
}

export function parseShotGraphYaml(yaml: string): ShotGraph {
  const cameraBlock = extractYamlSubBlock(yaml, "camera");
  const blockingBlock = extractYamlSubBlock(yaml, "subject_blocking");
  const layoutBlock = extractYamlSubBlock(yaml, "frame_layout");
  const depthBlock = extractYamlSubBlock(yaml, "depth_layers");

  let foreground: string[] = [];
  let midground: string[] = [];
  let background: string[] = [];
  if (depthBlock) {
    foreground = extractYamlListItems(depthBlock, "foreground");
    midground = extractYamlListItems(depthBlock, "midground");
    background = extractYamlListItems(depthBlock, "background");
  }

  const subjectFillRaw = extractScalar(layoutBlock, "subject_fill");
  const subjectFill = subjectFillRaw ? Number.parseFloat(subjectFillRaw) : undefined;

  return ShotGraphSchema.parse({
    camera: {
      angle: extractScalar(cameraBlock, "angle") ?? undefined,
      distance: extractScalar(cameraBlock, "distance") ?? undefined,
      lens: extractScalar(cameraBlock, "lens") ?? undefined,
      framing: extractScalar(cameraBlock, "framing") ?? undefined,
      dof: extractScalar(cameraBlock, "dof") ?? undefined,
    },
    subject_blocking: {
      primary: extractScalar(blockingBlock, "primary") ?? undefined,
      body_orientation: extractScalar(blockingBlock, "body_orientation") ?? undefined,
      face_visibility: extractScalar(blockingBlock, "face_visibility") ?? undefined,
    },
    frame_layout: {
      mirror_centered: extractBool(layoutBlock, "mirror_centered"),
      hips_lower_center: extractBool(layoutBlock, "hips_lower_center"),
      hands_lower_frame: extractBool(layoutBlock, "hands_lower_frame"),
      subject_fill: Number.isFinite(subjectFill) ? subjectFill : undefined,
    },
    depth_layers: {
      foreground: foreground.length ? foreground : undefined,
      midground: midground.length ? midground : undefined,
      background: background.length ? background : undefined,
    },
    pov_constraints: extractYamlListItems(yaml, "pov_constraints"),
  });
}

function extractNestedList(block: string, key: string): string[] {
  return extractYamlListItems(block, key);
}

/** Heuristic expression slugs from compiler YAML when token parser yields none. */
export function inferExpressionTokensFromSceneYaml(yaml: string): string[] {
  const tokens = new Set<string>();
  const blob = yaml.toLowerCase();
  if (/flush|красн|blush|щёк/i.test(blob)) tokens.add("flushed_face");
  if (/tear|слёз|слез/i.test(blob)) tokens.add("tear_streaks");
  if (/open_mouth|mouth open|рот приоткрыт|open mouth/i.test(blob)) tokens.add("open_mouth");
  if (/head_thrown|запрокин/i.test(blob)) tokens.add("head_thrown_back");
  if (/gasp|задых|gasping/i.test(blob)) tokens.add("gasping");
  if (/bit(e|ing).*lip|кусает.*губ/i.test(blob)) tokens.add("biting_lip");
  return [...tokens];
}

/** Heuristic SceneAST from legacy compiler YAML (regex-based). */
export function parseSceneAstFromLegacyYaml(yaml: string): SceneAst {
  const interactionType = /penetrat|входиш|from_behind|rear|deep_rhythm/i.test(yaml)
    ? "rear_penetration"
    : undefined;

  return {
    scene: { pov: "first_person", explicitness: interactionType ? "explicit" : undefined },
    pose: {
      base: /bent_over|согнут|наклон/i.test(yaml) ? "bent_over_sink" : undefined,
      spine: /arched|выгнут/i.test(yaml) ? "arched" : undefined,
      head: /head_thrown|запрокин/i.test(yaml) ? "tilted_back" : undefined,
      hands: /gripp|раковин|counter/i.test(yaml) ? "gripping_sink" : undefined,
    },
    interaction: interactionType
      ? { type: interactionType, intensity: /deep|глубок/i.test(yaml) ? "deep" : undefined }
      : undefined,
    composition: {
      reflection_centered: /reflection_centered:\s*true/i.test(yaml),
      face_via_mirror_only: /face_visible_via_mirror_only:\s*true/i.test(yaml),
      focal: extractYamlListItems(yaml, "focal_priority"),
    },
    avoid: extractYamlListItems(yaml, "avoid").map(slugifyToken),
    environment: {
      room: /bathroom|ванн/i.test(yaml) ? "luxury_bathroom" : undefined,
      surfaces: extractYamlListItems(
        yaml.match(/^environment:[\s\S]*?(?=^\w|$)/m)?.[0] ?? yaml,
        "surfaces",
      ),
    },
  };
}

export function visualTokenBundleToYaml(bundle: VisualTokenBundle): string {
  const lines: string[] = [];
  const sections: Array<[keyof VisualTokenBundle, string[]]> = [
    ["subject_tokens", bundle.subject_tokens],
    ["pose_tokens", bundle.pose_tokens],
    ["interaction_tokens", bundle.interaction_tokens],
    ["composition_tokens", bundle.composition_tokens],
    ["expression_tokens", bundle.expression_tokens ?? []],
    ["material_tokens", bundle.material_tokens],
    ["camera_tokens", bundle.camera_tokens],
    ["environment_tokens", bundle.environment_tokens],
    ["discarded_tokens", bundle.discarded_tokens],
  ];
  for (const [key, items] of sections) {
    if (!items.length) continue;
    lines.push(`${key}:`);
    for (const item of items) lines.push(`  - ${item}`);
  }
  return lines.join("\n");
}

export function shotGraphToYaml(graph: ShotGraph): string {
  const lines: string[] = [];
  if (graph.camera) {
    lines.push("camera:");
    for (const [k, v] of Object.entries(graph.camera)) {
      if (v) lines.push(`  ${k}: ${v}`);
    }
  }
  if (graph.subject_blocking) {
    lines.push("subject_blocking:");
    for (const [k, v] of Object.entries(graph.subject_blocking)) {
      if (v) lines.push(`  ${k}: ${v}`);
    }
  }
  if (graph.frame_layout) {
    lines.push("frame_layout:");
    for (const [k, v] of Object.entries(graph.frame_layout)) {
      if (v !== undefined) lines.push(`  ${k}: ${v}`);
    }
  }
  if (graph.pov_constraints?.length) {
    lines.push("pov_constraints:");
    for (const c of graph.pov_constraints) lines.push(`  - ${c}`);
  }
  return lines.join("\n");
}
