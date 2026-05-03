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
  /** Recently played music tags, most recent first. */
  recentMusic?: string[];
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
  /** Whether image generation is configured and this turn is allowed to request a rare CG illustration. */
  canGenerateIllustrations?: boolean;
  /** Unified image style for generated game art. */
  artStylePrompt?: string | null;
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
  const canGenerateIllustrations = !!ctx?.canGenerateIllustrations;

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
    `1. SCENE SETTING — Pick the BEST overall background, weather, time of day, and season that fit the narration. The top-level "background" is what the player sees first when this message appears — it MUST match where the narration ENDS (the room/area the party occupies after the turn). If characters move house → office (or any room change), top-level "background" MUST be the office (tag or backgrounds:generated:...) and top-level "locationId" MUST match — do NOT leave "background": null just because the move happens mid-text; null is ONLY when the party stays in the exact same place with no plate change.`,
    `2. LOCATION ID — Output a stable kebab-case "locationId" for the place currently in frame (e.g. "chernorechye-village-edge", "aunt-zoya-izba-kitchen", "abandoned-bell-tower"). REUSE the same id whenever the narration returns to a previously-visited place — even if phrasing differs. Inventing a new id for an already-visited location creates a duplicate cadre and wastes generation.`,
    `3. BACKGROUND PROMPT — When you cannot find a STRONG match in the listed availableBackgrounds (locale, era, geography, language/cultural context — e.g. nothing matches a snowy Russian village or a 1990s post-Soviet bus stop), set "background" to "backgrounds:generated:<short-slug>" AND fill "backgroundPrompt" with a rich 1–2 sentence visual description: location type, materials, lighting, atmosphere, and key visual details from the narration. For generated backgrounds, describe a composition that works behind full-body character sprites: keep the lower foreground and bottom-center relatively clear; put focal interest, important props, doors, and readable text-like signage in mid-ground or upper frame or off-center so sprites are not parked on top of the scene's key beats. When you DO pick a tag from availableBackgrounds, set "backgroundPrompt": null.`,
    `4. REPUTATION — If an NPC relationship shifted, note it. Otherwise empty array.`,
    `5. PER-BEAT EFFECTS — Scan each narration beat [0]-[${lines.length - 1}]. For each beat you can optionally add:`,
    `   - "sfx": sound effects (door slam, explosion, footsteps, impact)`,
    `   - "directions": rare cinematic effects at the exact beat they should happen, usually paired with a meaningful sound or reveal. Available per-beat: fade_from_black, fade_to_black, flash, screen_shake, blur, vignette, letterbox, color_grade (presets: warm, cold_blue, horror, noir, vintage, neon, dreamy), focus, pulse, slow_zoom, impact_zoom, tilt, desaturate, chromatic_aberration, film_grain, rain_streaks, spotlight.`,
    `   - "background"+"locationId"+"backgroundPrompt": when the characters PHYSICALLY MOVE to a new location at that beat. Same rules as the top-level fields: use a stable locationId, set backgroundPrompt only when no listed tag fits. The background stays the same until the NEXT segment that changes it, so only set these on the beat where characters actually arrive at a new place. Do NOT repeat the current background.`,
    `   Only include segments that HAVE at least one effect — omit empty segments.`,
    ...((ctx?.turnNumber ?? 1) > 1
      ? [
          `6. CINEMATIC DIRECTIONS — If the narration warrants an opening/establishing or turn-wide visual effect, include it. Otherwise empty array. Available: fade_from_black, fade_to_black, flash, screen_shake, blur, vignette, letterbox, color_grade (presets: warm, cold_blue, horror, noir, vintage, neon, dreamy), focus, pulse, slow_zoom, impact_zoom, tilt, desaturate, chromatic_aberration, film_grain, rain_streaks, spotlight.`,
        ]
      : []),
    ...(canGenerateIllustrations
      ? [
          `${(ctx?.turnNumber ?? 1) > 1 ? "7" : "6"}. RARE ILLUSTRATION — You may request ONE generated VN CG background only for a major, story-defining moment: first kiss, duel climax, major revelation, sacrifice, council confrontation, boss entrance, or emotional peak. Do not request one for routine travel, normal dialogue, regular combat blows, room changes, shopping, exposition, or scenery.`,
          `   The image must be from the player protagonist's POV, in the game's established art style${ctx?.artStylePrompt ? ` (${ctx.artStylePrompt})` : ""}. The protagonist should not be visible except hands/arms when the narration explicitly requires it.`,
        ]
      : []),
    ``,
    `RULES:`,
    `- For "background" use ONE of: a tag from availableBackgrounds (exact spelling), or "backgrounds:generated:<short-slug>". Nothing else.`,
    `- Prefer "backgrounds:generated:..." when the listed tags don't capture the locale, era, or cultural setting of the scene. A bad fit from the list is worse than a fresh generation.`,
    `- "backgroundPrompt" MUST be set whenever "background" is "backgrounds:generated:..." and MUST be null otherwise. Cyrillic and other non-Latin descriptions are fine — image models read them.`,
    `- "locationId" should be ASCII kebab-case (a-z, 0-9, hyphens, max ~60 chars). Stable across turns for the same place.`,
    `- Use ONLY the exact tags listed in the template below for music, ambient, sfx, and other enumerated fields.`,
    `- Expressions and widget updates are handled by the GM model. Do NOT include them in your output.`,
    `- segmentEffects can be an EMPTY array [] when nothing changed.`,
    `- Cinematic directions are spice, not punctuation. Use at most 2 total directions per turn, and never more than 1 direction in any 3-beat span. Prefer none for routine dialogue.`,
    `- Use directions for real visual beats: a door slamming, a blade impact, thunder, a memory fracture, a kiss/reveal close-up, a panic spike, a scene transition, or a major emotional turn. Do not attach directions to every line.`,
    `- The background should stay the SAME as long as the characters remain in the same location. Only change it in a segment when characters physically move to a different place.`,
    ...(canGenerateIllustrations
      ? [
          `- Use "illustration" rarely. Most turns MUST keep it null. If you request it, the prompt must describe the exact illustrated moment, visible characters, player POV, mood, lighting, and composition.`,
          `- Set "illustration.segment" to the narration line index [N] where the CG beat STARTS (same numbering as segmentEffects). Keep top-level "background" as the room/area plate for the turn; the engine shows CG only when the player reaches that segment, then restores the room on the next segment.`,
          `- "illustration.characters" MUST name every visible on-screen character who appears in the CG (same names as in narration), so reference portraits attach correctly — never invent a different cast.`,
          `- The illustration prompt MUST stay in the SAME location as the current scene: reuse props, architecture, and weather/lighting from the narration and from top-level "background" / "backgroundPrompt" / "locationId" — do not relocate to a generic stock setting.`,
        ]
      : [`- Do not include image-generation or illustration requests.`]),
    ...(ctx?.currentBackground
      ? [
          `- Current background is "${ctx.currentBackground}" (locationId="${ctx.currentLocationId ?? "unknown"}"). If narration ends in a different place, change top-level "background" + "locationId" accordingly — do not rely only on segmentEffects for the final location; segmentEffects are for mid-line beats (sfx, flashes, earlier sub-locations), not for skipping the end-of-turn plate.`,
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
  segmentFields.push(
    `      "directions": [{"effect":"<flash|screen_shake|pulse|slow_zoom|impact_zoom|tilt|desaturate|chromatic_aberration|film_grain|rain_streaks|spotlight|focus|vignette|letterbox|color_grade>","duration":<0.4-3>,"intensity":<0-1>}]  // optional, rare`,
  );
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
          `,  "directions": [{"effect":"<fade_from_black|fade_to_black|flash|screen_shake|blur|vignette|letterbox|color_grade|focus|pulse|slow_zoom|impact_zoom|tilt|desaturate|chromatic_aberration|film_grain|rain_streaks|spotlight>","duration":<number>}]`,
        ]
      : []),
    ...(canGenerateIllustrations
      ? [
          `,  "illustration": null OR {"segment":<0-${lines.length - 1}>,"prompt":"<CG from player POV — same room/props as narration + backgroundPrompt; no new location>","characters":["<every visible named character>"],"reason":"<why this is CG-worthy>","slug":"<short-safe-slug>"}`,
        ]
      : []),
    `}`,
  );

  return parts.join("\n");
}
