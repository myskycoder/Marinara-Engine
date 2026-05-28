// ──────────────────────────────────────────────
// Game: structured scene state for image prompt rewriter
// ──────────────────────────────────────────────

export interface IllustrationSceneStateInput {
  draftPrompt: string;
  locationId?: string | null;
  backgroundPrompt?: string | null;
  weather?: string | null;
  timeOfDay?: string | null;
  season?: string | null;
  characters?: string[];
  characterDescriptions?: string[];
  sceneNpcs?: string | null;
  genre?: string | null;
  setting?: string | null;
  artStyle?: string | null;
}

interface ParsedNpcLine {
  name: string;
  mood?: string;
  appearance?: string;
  outfit?: string;
  thoughts?: string;
}

const POSE_ANCHOR_PRIORITY: Record<string, number> = {
  bent_over: 10,
  from_behind: 9,
  penetration: 9,
  arched_back: 8,
  hands_on_hips: 7,
  gripping_counter: 6,
  dress_lifted: 5,
  legs_spread: 4,
  heels_splayed: 3,
  head_thrown_back: 2,
  deep_rhythm: 1,
};

const LOW_SALIENCE_PATTERNS: RegExp[] = [
  /\bbite\s+mark/i,
  /след\s+от\s+укус/i,
  /укус.*кулак/i,
  /\brecent\s+orgasm\b/i,
  /\borgasm\b/i,
  /\becho(ing|ed)\s+sound/i,
  /звук.*эх/i,
  /\binner\s+monologue\b/i,
  /\bthoughts?\b/i,
];

const DEFAULT_STRUCTURAL_AVOID = [
  "third_person_angle",
  "full_body_player",
  "detached_camera",
  "extra_characters",
];

const BODY_GEOMETRY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bbent\s+over\b/i, label: "bent_over" },
  { pattern: /наклон|согнув/i, label: "bent_over" },
  { pattern: /\barched\s+back\b/i, label: "arched_back" },
  { pattern: /\bheels?\s+(splay|spread|scrape)/i, label: "heels_splayed" },
  { pattern: /каблук.*разъез/i, label: "heels_splayed" },
  { pattern: /\bhands?\s+on\s+(her\s+)?hips\b/i, label: "hands_on_hips" },
  { pattern: /\bdress\s+(hiked|lifted|rucked|pushed)\b/i, label: "dress_lifted" },
  { pattern: /платье.*(задир|подня|собран)/i, label: "dress_lifted" },
  { pattern: /\bgripp(ing|ed)\s+(the\s+)?(sink|counter|edge)/i, label: "gripping_counter" },
  { pattern: /хват.*(раковин|столешниц|край)/i, label: "gripping_counter" },
  { pattern: /\bhead\s+thrown\s+back\b/i, label: "head_thrown_back" },
  { pattern: /\blegs?\s+spread\b/i, label: "legs_spread" },
  { pattern: /\bpenetrat/i, label: "penetration" },
  { pattern: /\bdeep\s+rhythm\b/i, label: "deep_rhythm" },
  { pattern: /\bfrom\s+behind\b/i, label: "from_behind" },
];

const ENVIRONMENT_KEYWORDS = [
  "marble",
  "mirror",
  "tile",
  "vanity",
  "bathroom",
  "sink",
  "chrome",
  "gold fixture",
  "мрамор",
  "зеркал",
  "плитк",
  "раковин",
  "столешниц",
];

const MATERIAL_KEYWORDS = [
  { pattern: /marble|мрамор/i, label: "cold_polished_marble" },
  { pattern: /tile|плитк/i, label: "glossy_tile" },
  { pattern: /mirror|зеркал/i, label: "mirror_reflections" },
  { pattern: /wet|moist|mokra|влаж/i, label: "wet_skin_sheen" },
  { pattern: /sweat|пот/i, label: "skin_sheen" },
  { pattern: /chrome|gold|золот/i, label: "metal_fixtures" },
];

function parseSceneNpcLine(line: string): ParsedNpcLine | null {
  const trimmed = line.trim().replace(/^-\s*/, "");
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return null;

  const name = trimmed.slice(0, colonIdx).trim();
  const rest = trimmed.slice(colonIdx + 1).trim();
  if (!name) return null;

  const parsed: ParsedNpcLine = { name };
  for (const segment of rest.split(";")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = segment.slice(0, eqIdx).trim().toLowerCase();
    const value = segment.slice(eqIdx + 1).trim();
    if (!value) continue;
    if (key === "mood") parsed.mood = value;
    else if (key === "appearance") parsed.appearance = value;
    else if (key === "outfit") parsed.outfit = value;
    else if (key === "thoughts") parsed.thoughts = value;
  }
  return parsed;
}

function parseCharacterDescriptionLine(line: string): { name: string; appearance: string } | null {
  const trimmed = line.trim().replace(/^-\s*/, "");
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return null;
  const name = trimmed.slice(0, colonIdx).trim();
  const appearance = trimmed.slice(colonIdx + 1).trim();
  if (!name || !appearance) return null;
  return { name, appearance };
}

function detectMirrorVisible(text: string): boolean {
  return /\b(mirror|reflection|зеркал|отражен)/i.test(text);
}

function extractBodyGeometry(text: string): string[] {
  const found = new Set<string>();
  for (const { pattern, label } of BODY_GEOMETRY_PATTERNS) {
    if (pattern.test(text)) found.add(label);
  }
  return [...found];
}

function extractEnvironmentGeometry(...sources: Array<string | null | undefined>): string[] {
  const blob = sources.filter(Boolean).join(" ").toLowerCase();
  const found = new Set<string>();
  for (const keyword of ENVIRONMENT_KEYWORDS) {
    if (blob.includes(keyword.toLowerCase())) found.add(keyword);
  }
  return [...found];
}

function extractMaterialHints(text: string): string[] {
  const found = new Set<string>();
  for (const { pattern, label } of MATERIAL_KEYWORDS) {
    if (pattern.test(text)) found.add(label);
  }
  return [...found];
}

function extractLightingHints(artStyle: string | null | undefined): string[] {
  const hints: string[] = [];
  const style = (artStyle ?? "").toLowerCase();
  if (/neon|purple|pink|gold|nightclub/.test(style)) hints.push("neon_nightclub_palette");
  if (/purple/.test(style)) hints.push("purple_rim_light");
  if (/gold/.test(style)) hints.push("warm_gold_fill");
  if (/soft neon|neon lighting/.test(style)) hints.push("soft_neon_ambient");
  return hints;
}

function buildAtmosphereBlock(input: IllustrationSceneStateInput): Record<string, string> | null {
  const atmosphere: Record<string, string> = {};
  if (input.weather?.trim()) atmosphere.weather = input.weather.trim();
  if (input.timeOfDay?.trim()) atmosphere.time = input.timeOfDay.trim();
  if (input.season?.trim()) atmosphere.season = input.season.trim();
  return Object.keys(atmosphere).length > 0 ? atmosphere : null;
}

function yamlQuote(value: string): string {
  if (/[:#\n"'{}[\],&*?|>-]/.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function yamlLine(key: string, value: string, indent = 0): string {
  const pad = "  ".repeat(indent);
  return `${pad}${key}: ${yamlQuote(value)}`;
}

/**
 * Build a compact YAML scene graph for the image prompt rewriter.
 * Art direction lives in the system style profile — not here.
 */
export function buildStructuredSceneState(input: IllustrationSceneStateInput): string {
  const draft = input.draftPrompt.trim();
  const lines: string[] = ["scene:"];

  if (input.locationId?.trim()) {
    lines.push(yamlLine("location_id", input.locationId.trim(), 1));
  }

  const envGeometry = extractEnvironmentGeometry(draft, input.backgroundPrompt, input.locationId);
  if (input.backgroundPrompt?.trim() || envGeometry.length) {
    lines.push("  environment:");
    if (input.backgroundPrompt?.trim()) {
      lines.push(yamlLine("brief", input.backgroundPrompt.trim().slice(0, 400), 2));
    }
    if (envGeometry.length) {
      lines.push("    geometry:");
      for (const item of envGeometry.slice(0, 8)) {
        lines.push(`      - ${yamlQuote(item)}`);
      }
    }
  }

  const atmosphere = buildAtmosphereBlock(input);
  if (atmosphere) {
    lines.push("  atmosphere:");
    for (const [key, value] of Object.entries(atmosphere)) {
      lines.push(yamlLine(key, value, 2));
    }
  }

  const npcByName = new Map<string, ParsedNpcLine>();
  if (input.sceneNpcs?.trim()) {
    for (const rawLine of input.sceneNpcs.split("\n")) {
      const parsed = parseSceneNpcLine(rawLine);
      if (parsed) npcByName.set(parsed.name.toLowerCase(), parsed);
    }
  }

  const appearanceByName = new Map<string, string>();
  for (const descLine of input.characterDescriptions ?? []) {
    const parsed = parseCharacterDescriptionLine(descLine);
    if (parsed) appearanceByName.set(parsed.name.toLowerCase(), parsed.appearance);
  }

  const characterNames = input.characters?.length ? input.characters : [...npcByName.values()].map((n) => n.name);
  if (characterNames.length) {
    lines.push("subject:");
    for (const name of characterNames) {
      const key = name.toLowerCase();
      const npc = npcByName.get(key);
      const appearance = npc?.appearance ?? appearanceByName.get(key);
      lines.push(`  - name: ${yamlQuote(name)}`);
      if (appearance) lines.push(yamlLine("appearance", appearance.slice(0, 300), 2));
      if (npc?.outfit) lines.push(yamlLine("outfit", npc.outfit.slice(0, 200), 2));
    }
  }

  const bodyGeometry = extractBodyGeometry(draft);
  const dominantPose = compressPoseAnchors(bodyGeometry);
  if (dominantPose.length || bodyGeometry.length) {
    lines.push("pose:");
    if (dominantPose.length) {
      lines.push("  dominant:");
      for (const item of dominantPose) {
        lines.push(`    - ${yamlQuote(item)}`);
      }
    }
    if (bodyGeometry.length) {
      lines.push("  body_geometry:");
      for (const item of bodyGeometry) {
        lines.push(`    - ${yamlQuote(item)}`);
      }
    }
  }

  const mirrorVisible = detectMirrorVisible(draft);
  const characterNamesForComposition = characterNames;
  if (mirrorVisible || characterNamesForComposition.length) {
    lines.push("composition:");
    if (mirrorVisible) {
      lines.push("  reflection_centered: true");
      lines.push("  face_visible_via_mirror_only: true");
      lines.push("  focal_priority:");
      const focalName = characterNamesForComposition[0] ?? "subject";
      lines.push(`    - ${yamlQuote(`${focalName} face in mirror`)}`);
      lines.push(`    - ${yamlQuote("hips and hand contact")}`);
    }
  }

  const expressions: string[] = [];
  for (const npc of npcByName.values()) {
    if (npc.mood?.trim()) expressions.push(npc.mood.trim());
  }
  if (expressions.length) {
    lines.push("expressions:");
    for (const expr of expressions.slice(0, 4)) {
      lines.push(`  - ${yamlQuote(expr.slice(0, 120))}`);
    }
  }

  const materialHints = extractMaterialHints(draft);
  const lightingHints = extractLightingHints(input.artStyle);
  if (materialHints.length) {
    lines.push("materials:");
    for (const item of materialHints) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }
  if (lightingHints.length) {
    lines.push("lighting:");
    for (const item of lightingHints) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }

  lines.push("camera:");
  lines.push("  pov: first_person");
  lines.push("  height: standing_eye_level");
  lines.push("  distance: intimate_close");
  lines.push("  angle: slightly_downward");
  if (mirrorVisible) {
    lines.push("  focal_subject: mirror_reflection");
  }
  lines.push("  framing: tight_medium");
  lines.push("  lens: 35mm");
  lines.push("  depth_of_field: shallow");

  lines.push("avoid:");
  for (const item of DEFAULT_STRUCTURAL_AVOID) {
    lines.push(`  - ${yamlQuote(item)}`);
  }

  lines.push("continuity:");
  if (mirrorVisible) {
    lines.push("  mirror_visible: true");
  }
  lines.push("  pov_constraints:");
  lines.push("    - no_protagonist_body");

  const joined = lines.join("\n");
  return joined.length > 2400 ? `${joined.slice(0, 2397)}…` : joined;
}

/** Slim meta block for Stage 1 scene compiler user message. */
export function buildSceneCompilerUserMessage(input: IllustrationSceneStateInput): string {
  const parts: string[] = [];
  parts.push("<draft_prompt>", input.draftPrompt.trim(), "</draft_prompt>");

  const meta: string[] = [];
  if (input.locationId?.trim()) meta.push(`location_id: ${input.locationId.trim()}`);
  if (input.weather?.trim()) meta.push(`weather: ${input.weather.trim()}`);
  if (input.timeOfDay?.trim()) meta.push(`time: ${input.timeOfDay.trim()}`);
  if (input.characters?.length) meta.push(`characters: ${input.characters.join(", ")}`);
  if (meta.length) {
    parts.push("", "<scene_meta>", meta.join("\n"), "</scene_meta>");
  }

  parts.push("", "Extract visual state as YAML only. Use the schema from your system instructions.");
  return parts.join("\n");
}

function isLowSalience(text: string): boolean {
  return LOW_SALIENCE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Compress body geometry labels to max 3 dominant pose anchors by priority. */
export function compressPoseAnchors(bodyGeometry: string[]): string[] {
  const ranked = [...new Set(bodyGeometry)]
    .sort((a, b) => (POSE_ANCHOR_PRIORITY[b] ?? 0) - (POSE_ANCHOR_PRIORITY[a] ?? 0));
  return ranked.slice(0, 3);
}

function extractYamlListItems(yaml: string, sectionKey: string): string[] {
  const sectionMatch = yaml.match(new RegExp(`^${sectionKey}:\\s*\\n((?:  - .+\\n?)*)`, "m"));
  if (!sectionMatch?.[1]) return [];
  const items: string[] = [];
  for (const line of sectionMatch[1].split("\n")) {
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch?.[1]) items.push(itemMatch[1].replace(/^["']|["']$/g, "").trim());
  }
  return items;
}

function extractNestedYamlListItems(yaml: string, parentKey: string, childKey: string): string[] {
  const parentMatch = yaml.match(new RegExp(`^${parentKey}:\\s*\\n((?:  .+\\n?)*)`, "m"));
  if (!parentMatch?.[1]) return [];
  const block = parentMatch[1];
  const childMatch = block.match(new RegExp(`^  ${childKey}:\\s*\\n((?:    - .+\\n?)*)`, "m"));
  if (!childMatch?.[1]) return [];
  const items: string[] = [];
  for (const line of childMatch[1].split("\n")) {
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch?.[1]) items.push(itemMatch[1].replace(/^["']|["']$/g, "").trim());
  }
  return items;
}

function extractScalarValue(yaml: string, key: string): string | null {
  const match = yaml.match(new RegExp(`^  ${key}:\\s*(.+)$`, "m"));
  return match?.[1] ? match[1].replace(/^["']|["']$/g, "").trim() : null;
}

/** Deterministic saliency compression when LLM saliency stage fails or in Fast path. */
export function deterministicSaliencyReduce(sceneYaml: string): string {
  const bodyGeometryRaw = [
    ...extractNestedYamlListItems(sceneYaml, "pose", "body_geometry"),
    ...extractNestedYamlListItems(sceneYaml, "pose", "dominant"),
    ...extractYamlListItems(sceneYaml, "body_geometry"),
  ];
  const important: string[] = [];
  const secondary: string[] = [];
  const discarded: string[] = [];

  for (const item of bodyGeometryRaw) {
    if (isLowSalience(item)) discarded.push(item);
  }
  const bodyGeometry = bodyGeometryRaw.filter((item) => !isLowSalience(item));
  const dominantFromPose = extractNestedYamlListItems(sceneYaml, "pose", "dominant").filter(
    (item) => !isLowSalience(item),
  );
  const dominantPose = dominantFromPose.length
    ? dominantFromPose.slice(0, 3)
    : compressPoseAnchors(bodyGeometry);

  // Subject appearance
  const subjectMatch = sceneYaml.match(/subject:[\s\S]*?appearance:\s*(.+)/);
  if (subjectMatch?.[1]) important.push(subjectMatch[1].replace(/^["']|["']$/g, "").trim());

  // Materials and lighting → important vs secondary
  for (const item of extractYamlListItems(sceneYaml, "materials")) {
    if (isLowSalience(item)) discarded.push(item);
    else if (/wet|sheen|skin/i.test(item)) important.push(item);
    else secondary.push(item);
  }
  for (const item of extractYamlListItems(sceneYaml, "lighting")) {
    secondary.push(item);
  }

  const nsfwContactLabels = ["penetration", "from_behind", "deep_rhythm"];
  for (const label of bodyGeometry) {
    if (nsfwContactLabels.includes(label)) {
      important.push(label.replace(/_/g, " "));
    }
  }


  // Expressions → important if visual
  for (const item of extractYamlListItems(sceneYaml, "expressions")) {
    if (isLowSalience(item)) discarded.push(item);
    else important.push(item);
  }

  // Composition directives
  const compositionDirectives: string[] = [];
  const focalPriority = extractNestedYamlListItems(sceneYaml, "composition", "focal_priority");
  for (const item of focalPriority) compositionDirectives.push(item);
  if (extractScalarValue(sceneYaml, "reflection_centered") === "true") {
    compositionDirectives.push("mirror reflection centered behind subject");
  }
  if (extractScalarValue(sceneYaml, "face_visible_via_mirror_only") === "true") {
    compositionDirectives.push("face visible only through mirror reflection");
  }
  if (/mirror/i.test(sceneYaml)) {
    compositionDirectives.push("mirror drives composition");
  }

  const structuralAvoid = [
    ...extractYamlListItems(sceneYaml, "avoid"),
    ...DEFAULT_STRUCTURAL_AVOID,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const lines: string[] = [];
  lines.push("dominant_pose:");
  for (const item of dominantPose.slice(0, 3)) {
    lines.push(`  - ${yamlQuote(item)}`);
  }
  if (important.length) {
    lines.push("important_visuals:");
    for (const item of [...new Set(important)].slice(0, 8)) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }
  if (secondary.length) {
    lines.push("secondary_visuals:");
    for (const item of [...new Set(secondary)].slice(0, 6)) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }
  if (discarded.length) {
    lines.push("discarded_details:");
    for (const item of [...new Set(discarded)].slice(0, 6)) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }
  if (compositionDirectives.length) {
    lines.push("composition_directives:");
    for (const item of [...new Set(compositionDirectives)].slice(0, 6)) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }
  if (structuralAvoid.length) {
    lines.push("structural_avoid:");
    for (const item of structuralAvoid.slice(0, 8)) {
      lines.push(`  - ${yamlQuote(item)}`);
    }
  }

  const joined = lines.join("\n");
  return joined.length > 1800 ? `${joined.slice(0, 1797)}…` : joined;
}

/** User message for saliency reducer LLM stage. */
export function buildSaliencyReducerUserMessage(sceneYaml: string): string {
  return ["<scene_state>", sceneYaml, "</scene_state>", "", "Reduce to saliency YAML only. Use the schema from your system instructions."].join(
    "\n",
  );
}
