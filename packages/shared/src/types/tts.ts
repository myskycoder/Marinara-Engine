// ──────────────────────────────────────────────
// TTS Types
// ──────────────────────────────────────────────
import { z } from "zod";

export const ttsSourceSchema = z.enum(["openai", "elevenlabs"]);
export type TTSSource = z.infer<typeof ttsSourceSchema>;

export const ttsDialogueScopeSchema = z.enum(["all", "character"]);
export type TTSDialogueScope = z.infer<typeof ttsDialogueScopeSchema>;

export const ttsVoiceModeSchema = z.enum(["single", "per-character"]);
export type TTSVoiceMode = z.infer<typeof ttsVoiceModeSchema>;

export const ttsVoiceAssignmentSchema = z.object({
  characterId: z.string().default(""),
  characterName: z.string().default(""),
  voice: z.string().default(""),
});
export type TTSVoiceAssignment = z.infer<typeof ttsVoiceAssignmentSchema>;

export const ttsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  source: ttsSourceSchema.default("openai"),
  baseUrl: z.string().default("https://api.openai.com/v1"),
  /** Plain text on write; masked "••••••" on read when a key is saved */
  apiKey: z.string().default(""),
  voice: z.string().default("alloy"),
  model: z.string().default("tts-1"),
  /** 0.25 – 4.0 */
  speed: z.number().min(0.25).max(4.0).default(1.0),
  /** ElevenLabs only: 0.0 = more expressive/creative, 1.0 = more stable/robust */
  elevenLabsStability: z.number().min(0).max(1).default(0.5),
  voiceMode: ttsVoiceModeSchema.default("single"),
  voiceAssignments: z.array(ttsVoiceAssignmentSchema).default([]),
  npcDefaultVoicesEnabled: z.boolean().default(false),
  npcDefaultMaleVoices: z.array(z.string()).default([]),
  npcDefaultFemaleVoices: z.array(z.string()).default([]),
  autoplayRP: z.boolean().default(false),
  autoplayConvo: z.boolean().default(false),
  autoplayGame: z.boolean().default(false),
  dialogueOnly: z.boolean().default(false),
  dialogueScope: ttsDialogueScopeSchema.default("all"),
  dialogueCharacterName: z.string().default(""),
});

export type TTSConfig = z.infer<typeof ttsConfigSchema>;

export const TTS_SETTINGS_KEY = "tts";
export const TTS_API_KEY_MASK = "••••••";

/** Returned by GET /api/tts/voices */
export interface TTSVoicesResponse {
  voices: string[];
  voiceOptions?: Array<{
    id: string;
    name: string;
    description?: string | null;
    previewUrl?: string | null;
    category?: string | null;
    labels?: Record<string, string | number | boolean | null> | null;
  }>;
  /** True when the list came from the provider; false = local fallback or no provider voices */
  fromProvider: boolean;
  source: TTSSource;
}
