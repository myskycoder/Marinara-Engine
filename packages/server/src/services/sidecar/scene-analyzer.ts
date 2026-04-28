// ──────────────────────────────────────────────
// Sidecar — Scene Analyzer Prompt
//
// System prompt for the local Gemma model to
// analyze a completed narration turn and produce
// structured scene updates (backgrounds, music,
// widgets, expressions, weather, etc.).
// ──────────────────────────────────────────────

import type { HudWidget, GameNpc, GameActiveState } from "@marinara-engine/shared";

export interface SceneAnalyzerContext {
  /** Current game state before this turn. */
  currentState: GameActiveState;
  /** Approximate turn number (1-based) — cinematic directions included after turn 1 */
  turnNumber?: number;
  /** Available background tags the model can select from. */
  availableBackgrounds: string[];
  /** Available SFX tags. */
  availableSfx: string[];
  /** Current active widgets with their latest values. */
  activeWidgets: HudWidget[];
  /** Tracked NPCs for reputation changes. */
  trackedNpcs: GameNpc[];
  /** Character names in the scene (for expression mapping). */
  characterNames: string[];
  /** Current background tag. */
  currentBackground: string | null;
  /** Current music tag. */
  currentMusic: string | null;
  /** Current ambient tag. */
  currentAmbient?: string | null;
  /** Current weather. */
  currentWeather: string | null;
  /** Current time of day. */
  currentTimeOfDay: string | null;
  /** Current season (winter/spring/summer/autumn) — keeps cache key stable across turns. */
  currentSeason?: string | null;
  /** The locationId the previous turn was rendered for, if any. */
  currentLocationId?: string | null;
  /**
   * Stable kebab-case ids of locations the party has already visited in this
   * chat. Provided so the LLM reuses the same id when characters return to a
   * known place instead of inventing a new one.
   */
  knownLocationIds?: string[];
}

/** Build the system prompt for scene analysis — kept minimal so all token
 *  budget goes to the user message where the actual choices live. */
export function buildSceneAnalyzerSystemPrompt(_ctx: SceneAnalyzerContext): string {
  return `You are a game state analyzer. Read the narration, then fill in the JSON template using ONLY the exact tags provided as options. Output valid JSON only.`;
}

/** Map a widget to its update syntax hint for the JSON template. */
function widgetUpdateHint(w: HudWidget): string {
  const hints = w.config.valueHints;
  switch (w.type) {
    case "progress_bar":
    case "gauge":
    case "relationship_meter":
      return `{"widgetId":"${w.id}","value":<number 0-${w.config.max ?? 100}>}`;
    case "counter":
      return `{"widgetId":"${w.id}","count":<number>}`;
    case "list":
    case "inventory_grid":
      return `{"widgetId":"${w.id}","add":"<item>"} or {"widgetId":"${w.id}","remove":"<item>"}`;
    case "timer":
      return `{"widgetId":"${w.id}","running":<bool>,"seconds":<number>}`;
    case "stat_block": {
      // For stat_blocks, show per-stat update format with hints if available
      const stats = w.config.stats ?? [];
      if (stats.length === 0) return `{"widgetId":"${w.id}","statName":"<name>","value":"<value>"}`;
      const examples = stats.slice(0, 3).map((s) => {
        const hintValues = hints?.[s.name];
        const valHint = hintValues ? `<${hintValues}>` : typeof s.value === "number" ? "<number>" : `"<string>"`;
        return `{"widgetId":"${w.id}","statName":"${s.name}","value":${valHint}}`;
      });
      return examples.join(" OR ");
    }
    default:
      return `{"widgetId":"${w.id}","value":<number>}`;
  }
}

/** Summarise a widget's current state for the model context. */
function widgetStateSummary(w: HudWidget): string {
  switch (w.type) {
    case "progress_bar":
    case "gauge":
    case "relationship_meter":
      return `${w.id} "${w.label}" (${w.type}): ${w.config.value ?? 0}/${w.config.max ?? 100}`;
    case "counter":
      return `${w.id} "${w.label}" (counter): ${w.config.count ?? 0}`;
    case "stat_block": {
      const stats = w.config.stats ?? [];
      const statStr = stats.map((s) => `${s.name}=${s.value}`).join(", ");
      return `${w.id} "${w.label}" (stat_block): [${statStr}]`;
    }
    case "list":
      return `${w.id} "${w.label}" (list): [${(w.config.items ?? []).join(", ")}]`;
    case "inventory_grid": {
      const items = (w.config.contents ?? []).map((c) => c.name).join(", ");
      return `${w.id} "${w.label}" (inventory): [${items}]`;
    }
    case "timer":
      return `${w.id} "${w.label}" (timer): ${w.config.running ? "running" : "stopped"} ${w.config.seconds ?? 0}s`;
    default:
      return `${w.id} "${w.label}" (${w.type})`;
  }
}

/** Build the user prompt with all choices inline in a JSON template. */
export function buildSceneAnalyzerUserPrompt(
  narration: string,
  playerAction?: string,
  ctx?: SceneAnalyzerContext,
): string {
  const parts: string[] = [];

  // ── 1. Narration (longest — furthest from generation) ──

  if (playerAction) {
    parts.push(`<player_action>`, playerAction, `</player_action>`);
  }

  const lines = narration.split(/\r?\n/).filter((l) => l.trim());
  parts.push(`<narration>`);
  for (let i = 0; i < lines.length; i++) {
    parts.push(`[${i}] ${lines[i]}`);
  }
  parts.push(`</narration>`);

  // ── 2. Current state ──

  if (ctx) {
    parts.push(
      ``,
      `Current: state=${ctx.currentState}, bg=${ctx.currentBackground ?? "none"}, locationId=${ctx.currentLocationId ?? "none"}, weather=${ctx.currentWeather ?? "unset"}, time=${ctx.currentTimeOfDay ?? "unset"}, season=${ctx.currentSeason ?? "unset"}`,
    );
    if (ctx.knownLocationIds?.length) {
      parts.push(
        `Known locationIds (REUSE these when narration returns to one of these places): ${ctx.knownLocationIds.join(", ")}`,
      );
    }
  }

  // ── 3. Task description + JSON template ──

  parts.push(
    ``,
    `TASK: You are the scene director for a visual novel game. Read the narration above and decide:`,
    // music and ambient are scored deterministically on the server — not requested from the model
    `1. SCENE SETTING — Pick the BEST overall background, weather, time of day, and season that fit the narration. The top-level "background" is the DEFAULT background for this turn. Change it from the current state only if the scene warrants it (new location, mood shift). Use null on "background" to keep unchanged.`,
    `2. LOCATION ID — Output a stable kebab-case "locationId" for the place currently in frame (e.g. "chernorechye-village-edge", "aunt-zoya-izba-kitchen", "abandoned-bell-tower"). REUSE the same id whenever the narration returns to a previously-visited place — even if phrasing differs. Inventing a new id for an already-visited location creates a duplicate cadre and wastes generation.`,
    `3. BACKGROUND PROMPT — When you cannot find a STRONG match in the listed availableBackgrounds (locale, era, geography, language/cultural context — e.g. nothing matches a snowy Russian village or a 1990s post-Soviet bus stop), set "background" to "backgrounds:generated:<short-slug>" AND fill "backgroundPrompt" with a rich 1–2 sentence visual description: location type, materials, lighting, atmosphere, and key visual details from the narration. When you DO pick a tag from availableBackgrounds, set "backgroundPrompt": null.`,
    `4. REPUTATION — If an NPC relationship shifted, note it. Otherwise empty array.`,
    `5. PER-BEAT EFFECTS — Scan each narration beat [0]-[${lines.length - 1}]. For each beat you can optionally add:`,
    `   - "sfx": sound effects (door slam, explosion, footsteps, impact)`,
    `   - "background"+"locationId"+"backgroundPrompt": when the characters PHYSICALLY MOVE to a new location at that beat. Same rules as the top-level fields: use a stable locationId, set backgroundPrompt only when no listed tag fits. The background stays the same until the NEXT segment that changes it, so only set these on the beat where characters actually arrive at a new place. Do NOT repeat the current background.`,
    `   Only include segments that HAVE at least one effect — omit empty segments.`,
    ...((ctx?.turnNumber ?? 1) > 1
      ? [
          `6. CINEMATIC DIRECTIONS — If the narration warrants a visual effect (fade, screen shake, flash, blur, vignette, letterbox, color grade, focus), include it. Otherwise empty array. Available: fade_from_black, fade_to_black, flash, screen_shake, blur, vignette, letterbox, color_grade (presets: warm, cold_blue, horror, noir, vintage, neon, dreamy), focus.`,
        ]
      : []),
    ``,
    `RULES:`,
    `- For "background" use ONE of: a tag from availableBackgrounds (exact spelling), or "backgrounds:generated:<short-slug>". Nothing else.`,
    `- Prefer "backgrounds:generated:..." when the listed tags don't capture the locale, era, or cultural setting of the scene. A bad fit from the list is worse than a fresh generation.`,
    `- "backgroundPrompt" MUST be set whenever "background" is "backgrounds:generated:..." and MUST be null otherwise. Cyrillic and other non-Latin descriptions are fine — image models read them.`,
    `- "locationId" should be ASCII kebab-case (a-z, 0-9, hyphens, max ~60 chars). Stable across turns for the same place.`,
    `- widgetUpdates are handled by the GM model. Do NOT include widgetUpdates in your output.`,
    `- segmentEffects can be an EMPTY array [] when nothing changed.`,
    `- The background should stay the SAME as long as the characters remain in the same location. Only change it in a segment when characters physically move to a different place.`,
    ...(ctx?.currentBackground
      ? [
          `- Current background is "${ctx.currentBackground}" (locationId="${ctx.currentLocationId ?? "unknown"}"). Keep it unless the characters move to a new location.`,
        ]
      : [
          `- There is no background yet (game just started). You MUST set a "background", a "locationId", and (if "background" is "backgrounds:generated:...") a "backgroundPrompt".`,
        ]),
    `- Output ONLY valid JSON, nothing else.`,
    ``,
  );

  // Build background options
  const bgOptions = ctx?.availableBackgrounds?.length
    ? ctx.availableBackgrounds.join(" | ") + ` | backgrounds:generated:<slug>`
    : `backgrounds:generated:<slug>`;

  // Ambient — handled automatically by scoreAmbient(), excluded from prompt

  // NPC names for reputation
  const npcNames = ctx?.trackedNpcs?.length ? ctx.trackedNpcs.map((n) => n.name) : [];
  const reputationHint =
    npcNames.length > 0 ? `[{"npcName":"<${npcNames.join(" | ")}>","action":"<what changed>"}] or []` : `[]`;

  // SFX options for segment effects
  const sfxLine = ctx?.availableSfx?.length ? `      "sfx": ["<${ctx.availableSfx.join(" | ")}>"]` : null;

  // Background options for segment effects (optional per-segment override)
  const bgLine = `      "background": "<${bgOptions}>"`;
  const locIdLine = `      "locationId": "<kebab-case stable id, or null>"`;
  const bgPromptLine = `      "backgroundPrompt": "<1-2 sentence visual brief when background is generated:..., else null>"`;

  // Build ONE segment example showing the range
  const segmentFields: string[] = [];
  segmentFields.push(`      "segment": <0-${lines.length - 1}>`);
  if (sfxLine) segmentFields.push(sfxLine);
  segmentFields.push(`${bgLine}  // optional — only when characters move to a new location`);
  segmentFields.push(`${locIdLine}  // optional — required when "background" is set on this segment`);
  segmentFields.push(`${bgPromptLine}  // optional — required when "background" is "backgrounds:generated:..."`);
  const segmentBody = segmentFields.join(",\n");

  parts.push(
    `{`,
    `  "background": "<${bgOptions}>",`,
    `  "locationId": "<kebab-case stable id, or null>",`,
    `  "backgroundPrompt": "<1-2 sentence visual brief when background is generated:..., else null>",`,
    `  "weather": "<clear | cloudy | foggy | rainy | stormy | snowy | windy | frost | null>",`,
    `  "timeOfDay": "<dawn | morning | noon | afternoon | evening | night | midnight | null>",`,
    `  "season": "<spring | summer | autumn | winter | null>",`,
    `  "reputationChanges": ${reputationHint},`,
    `  "segmentEffects": [`,
    `    {`,
    segmentBody,
    `    },`,
    `    ...`,
    `  ]`,
    ...((ctx?.turnNumber ?? 1) > 1
      ? [
          `,  "directions": [{"effect":"<fade_from_black|fade_to_black|flash|screen_shake|blur|vignette|letterbox|color_grade|focus>","duration":<number>}]`,
        ]
      : []),
    `}`,
  );

  return parts.join("\n");
}
