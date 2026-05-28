/** Core directives shared across all rewriter families. */
export const REWRITER_SHARED_RULES = [
  "You compile a VN scene draft into a single image prompt for ONE target model family.",
  "",
  "Hard rules:",
  "1. PRESERVE FACTS from <draft_prompt> and <scene_state>. Do not invent locations, cast, or plot.",
  "2. PLAYER POV by default: first-person from the protagonist's eyes. Protagonist body NOT visible — only hands/forearms when the draft requires contact.",
  "3. Include every visible character's appearance from <scene_state>.",
  "4. Output ONLY the rewritten prompt. Plain text. No JSON, markdown, preamble, or commentary.",
].join("\n");

export const REWRITER_PRIORITY_STACK = [
  "Prompt priority (front-load the most important):",
  "  TOP: character, pose, framing, POV",
  "  MID: environment geometry, mirror/reflection, lighting",
  "  LOW: style modifiers (comma stack only — never literary mood garnish)",
].join("\n");

export const REWRITER_POV_CORRECTIONS = [
  "POV corrections (mandatory unless draft says otherwise):",
  "- Avoid third-person framing.",
  "- Protagonist body is not visible.",
  "- Only hands/forearms may appear at frame edge.",
  "- Do not place the camera outside the player's POV.",
].join("\n");

export const FLUX_PHYSICALITY_RULES = [
  "Flux physicality rules:",
  "- Prefer visual primitives over emotional abstraction.",
  "- Use physical cues (humid air haze, trembling thighs, uneven breathing, condensation on mirror edges) NOT literary garnish (sultry atmosphere, heat and urgency, every movement echoing).",
  "- Describe exact body geometry: hip contact, back arch, knee bend, heel placement, grip points.",
  "- Anchor environment with spatial layout: walls, floor material, fixtures, mirror placement.",
  "- Preserve explicit act intensity from the draft — no euphemism softening.",
].join("\n");

export const FLUX_DIRECTING_RULES = [
  "Directing language (mandatory for Prompt Director):",
  "- DIRECT the composition — do not merely describe that objects exist.",
  "- Mirror: 'mirror reflection centered behind subject, face visible only through reflection' NOT 'there is a mirror'.",
  "- Camera: state height, distance, angle, and focal subject explicitly.",
  "- Render structural_avoid as positive POV constraints: 'camera locked inside first-person POV, player body outside frame'.",
  "- Max 2–3 dominant pose anchors in Block 1 — never stack 9 limb geometry statements.",
  "- Drop discarded_details entirely — they must never appear in output.",
  "- No lighting, neon palette, gold fill, or material/style tokens in Block 1 or Block 2.",
  "- NSFW: preserve explicit acts from important_visuals literally — no euphemism softening.",
  "- Output English only.",
].join("\n");

export interface RewriterStyleContext {
  artStyle?: string | null;
  genre?: string | null;
  setting?: string | null;
}

export function buildStyleProfileBlock(ctx: RewriterStyleContext | null | undefined): string {
  if (!ctx) return "";
  const lines = [
    ctx.artStyle?.trim() ? `- art_style: ${ctx.artStyle.trim()}` : null,
    ctx.genre?.trim() ? `- genre: ${ctx.genre.trim()}` : null,
    ctx.setting?.trim() ? `- setting: ${ctx.setting.trim()}` : null,
  ].filter((line): line is string => !!line);
  if (!lines.length) return "";
  return ["Style profile (static for this game):", ...lines].join("\n");
}
