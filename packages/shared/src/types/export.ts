// ──────────────────────────────────────────────
// Export/Import Envelope Types
// ──────────────────────────────────────────────

import type { ChatMode } from "./chat.js";

/** Supported export entity types. */
export type ExportType =
  | "marinara_character"
  | "marinara_persona"
  | "marinara_lorebook"
  | "marinara_preset"
  | "marinara_chat_preset"
  | "marinara_memory_recall"
  | "marinara_profile"
  | "marinara_game_session"
  | "marinara_game_campaign";

/** Wrapper envelope for exported data. */
export interface ExportEnvelope<T = unknown> {
  type: ExportType;
  version: 1;
  exportedAt: string;
  data: T;
}

export interface ChatMemoryRecallExportChunk {
  content: string;
  embedding: number[] | null;
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  createdAt: string;
}

export interface ChatMemoryRecallExportPayload {
  sourceChat: {
    id: string;
    name: string;
    mode: ChatMode;
    memoryCount: number;
  };
  chunks: ChatMemoryRecallExportChunk[];
}

export interface ChatMemoryRecallImportResult {
  imported: number;
  skipped: number;
  replaced: boolean;
}

/** File entry bundled into a game session/campaign export archive. */
export interface GameSessionExportFile {
  path: string;
  size: number;
  data?: string;
}

/** Resolved global references for a game session export. */
export interface GameSessionExportReferences {
  characterIds: string[];
  personaId: string | null;
  lorebookIds: string[];
  connectionIds: string[];
  resolved: {
    characters: Array<{ id: string; name: string }>;
    persona: { id: string; name: string } | null;
    lorebooks: Array<{ id: string; name: string }>;
    connections: Array<{ id: string; name: string }>;
  };
  missing: string[];
}

/** Payload for a single game session export envelope. */
export interface GameSessionExportPayload {
  chat: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  swipes: Array<Record<string, unknown>>;
  gameStateSnapshots: Array<Record<string, unknown>>;
  checkpoints: Array<Record<string, unknown>>;
  agentRuns: Array<Record<string, unknown>>;
  agentMemory: Array<Record<string, unknown>>;
  chatImages: Array<Record<string, unknown>>;
  files: GameSessionExportFile[];
  references: GameSessionExportReferences;
}

/** Payload for a full campaign export (all sessions under one gameId). */
export interface GameCampaignExportPayload {
  gameId: string;
  sessions: GameSessionExportPayload[];
}
