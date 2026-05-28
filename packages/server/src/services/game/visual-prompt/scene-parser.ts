// ──────────────────────────────────────────────
// Deterministic pre-parse hints from VN draft prose
// ──────────────────────────────────────────────

export interface SceneParserHints {
  explicitKeywords: string[];
  hasMirror: boolean;
  hasPenetration: boolean;
  characterNames: string[];
}

const PENETRATION_PATTERNS = [
  /\bpenetrat/i,
  /входишь/i,
  /вошёл/i,
  /deep\s+rhythm/i,
  /глубок/i,
  /жёстк.*ритм/i,
  /from\s+behind/i,
  /сзади/i,
];

export function parseSceneHints(draft: string, characterNames: string[] = []): SceneParserHints {
  const explicitKeywords: string[] = [];
  let hasPenetration = false;
  for (const pattern of PENETRATION_PATTERNS) {
    if (pattern.test(draft)) {
      hasPenetration = true;
      explicitKeywords.push(pattern.source.slice(0, 30));
    }
  }
  const hasMirror = /\b(mirror|reflection|зеркал|отражен)/i.test(draft);
  return {
    explicitKeywords,
    hasMirror,
    hasPenetration,
    characterNames,
  };
}

export function buildSceneParserHintBlock(hints: SceneParserHints): string {
  const lines: string[] = ["<parser_hints>"];
  if (hints.hasPenetration) lines.push("explicit: penetration_or_deep_rhythm_detected");
  if (hints.hasMirror) lines.push("composition: mirror_reflection_required");
  if (hints.characterNames.length) lines.push(`characters: ${hints.characterNames.join(", ")}`);
  lines.push("</parser_hints>");
  return lines.join("\n");
}
