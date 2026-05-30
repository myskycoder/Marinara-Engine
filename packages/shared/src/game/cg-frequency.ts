// ──────────────────────────────────────────────
// Game Mode — auto VN CG illustration frequency presets
// ──────────────────────────────────────────────

export const GAME_CG_FREQUENCY_PRESETS = ["off", "rare", "balanced", "frequent", "cinematic"] as const;

/** Max narration excerpt chars for illustration continuity (server-side). */
export const GAME_ILLUSTRATION_NARRATION_EXCERPT_MAX = 1400;

/** Max draft prompt chars for manual / generate-assets illustration requests (client + Zod). */
export const GAME_ILLUSTRATION_DRAFT_MAX = 1800;

export type GameCgFrequencyPreset = (typeof GAME_CG_FREQUENCY_PRESETS)[number];

export interface GameCgFrequencyOption {
  id: GameCgFrequencyPreset;
  /** UI label (Russian). */
  label: string;
  /** Short help text for settings UI. */
  description: string;
  /** Minimum user-turn gap between automatic CG requests; 0 = no gap. Ignored for `off`. */
  cooldownTurns: number;
}

export const GAME_CG_FREQUENCY_OPTIONS: readonly GameCgFrequencyOption[] = [
  {
    id: "off",
    label: "Выкл (только вручную)",
    description: "Авто-CG отключены. Кнопки «+1» в галерее по-прежнему работают.",
    cooldownTurns: 0,
  },
  {
    id: "rare",
    label: "Редко",
    description: "Только ключевые моменты сюжета; не чаще чем раз в 2 хода.",
    cooldownTurns: 2,
  },
  {
    id: "balanced",
    label: "Умеренно",
    description: "Сильные визуальные сцены; не чаще чем раз в ход.",
    cooldownTurns: 1,
  },
  {
    id: "frequent",
    label: "Часто",
    description: "Примерно каждые 1–2 хода при запоминающемся кадре; не чаще раз в ход.",
    cooldownTurns: 1,
  },
  {
    id: "cinematic",
    label: "Кино",
    description: "Максимум выразительности: CG почти каждый ход с яркой сценой.",
    cooldownTurns: 0,
  },
] as const;

const PRESET_BY_ID = new Map<GameCgFrequencyPreset, GameCgFrequencyOption>(
  GAME_CG_FREQUENCY_OPTIONS.map((o) => [o.id, o]),
);

export function normalizeGameCgFrequency(value: unknown): GameCgFrequencyPreset {
  if (typeof value === "string" && (GAME_CG_FREQUENCY_PRESETS as readonly string[]).includes(value)) {
    return value as GameCgFrequencyPreset;
  }
  return "rare";
}

export function getIllustrationCooldownTurns(preset: GameCgFrequencyPreset): number {
  return PRESET_BY_ID.get(preset)?.cooldownTurns ?? 2;
}

export function isGameCgAutoEnabled(preset: GameCgFrequencyPreset): boolean {
  return preset !== "off";
}

export interface IllustrationCooldownInput {
  preset: GameCgFrequencyPreset;
  turnNumber: number;
  lastIllustrationTurn: number;
  sessionNumber?: number | null;
  lastIllustrationSession?: number | null;
}

/**
 * Whether enough turns have passed since the last auto CG for this preset.
 * Mirrors legacy `isIllustrationAllowed` session/turn bookkeeping.
 */
export function isIllustrationCooldownSatisfied(input: IllustrationCooldownInput): boolean {
  const { preset, turnNumber } = input;
  if (!isGameCgAutoEnabled(preset)) return false;

  const minGap = getIllustrationCooldownTurns(preset);
  if (minGap <= 0) return true;

  const lastTurn = input.lastIllustrationTurn;
  const lastSession =
    typeof input.lastIllustrationSession === "number" && Number.isFinite(input.lastIllustrationSession)
      ? input.lastIllustrationSession
      : null;
  const sessionNumber = input.sessionNumber ?? null;

  if (lastSession !== null && sessionNumber !== null && lastSession !== sessionNumber) {
    return true;
  }
  if (lastSession === null && sessionNumber !== null && sessionNumber > 1) {
    return true;
  }
  if (lastSession === null && lastTurn > turnNumber) {
    return true;
  }
  return lastTurn <= 0 || turnNumber - lastTurn >= minGap;
}

export interface CanRequestAutoCgIllustrationInput extends IllustrationCooldownInput {
  imageGenEnabled: boolean;
  hasImageConnection: boolean;
}

/** Gate for scene analysis + /generate-assets automatic illustration requests. */
export function canRequestAutoCgIllustration(input: CanRequestAutoCgIllustrationInput): boolean {
  if (!input.imageGenEnabled || !input.hasImageConnection) return false;
  if (!isGameCgAutoEnabled(input.preset)) return false;
  return isIllustrationCooldownSatisfied(input);
}
