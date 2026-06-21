// ──────────────────────────────────────────────
// Hook: Game Session Admin (privileged)
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type { GameNpc, GameSessionExportReferences } from "@marinara-engine/shared";

export interface GameCampaignListItem {
  gameId: string;
  lineageRootGameId: string;
  name: string;
  sessionCount: number;
  forkBranchCount: number;
  lastUpdatedAt: string;
  lastSessionStatus: string | null;
  lastSessionNumber: number | null;
}

export interface GameSessionListItem {
  chatId: string;
  name: string;
  gameId: string | null;
  gameSessionNumber: number | null;
  gameSessionStatus: string | null;
  forkLabel: string | null;
  forkedFromChatId: string | null;
  forkedFromMessageId: string | null;
  messageCount: number;
  snapshotCount: number;
  checkpointCount: number;
  agentRunCount: number;
  assetFileCount: number;
  assetBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameSessionInspector {
  chat: Record<string, unknown>;
  overview: {
    gameId: string | null;
    gameSessionNumber: number | null;
    gameSessionStatus: string | null;
    gameGmMode: string | null;
    gameGmCharacterId: string | null;
    connectionId: string | null;
    personaId: string | null;
    partyCharacterIds: string[];
    forkLineageRootGameId: string | null;
    forkedFromGameId: string | null;
    forkedFromChatId: string | null;
    forkedFromMessageId: string | null;
    forkLabel: string | null;
    gameSetupConfig: Record<string, unknown> | null;
    counts: {
      messages: number;
      snapshots: number;
      checkpoints: number;
      agentRuns: number;
      assets: number;
    };
  };
  metadata: Record<string, unknown>;
  highlights: {
    gameWorldOverview: string | null;
    gameStoryArc: string | null;
    gamePlotTwists: string[];
    gameNpcs: GameNpc[];
    gameMap: unknown;
    gameMaps: unknown[];
    locationCatalog: Record<string, unknown>;
    gameJournal: unknown;
    gameInventory: unknown[];
    gamePlayerNotes: string | null;
    gameBlueprint: unknown;
    gameWidgetState: unknown[];
    gameMorale: number | null;
    gamePartyArcs: unknown[];
    gameCharacterCards: unknown[];
    activeLorebookIds: string[];
  };
}

export interface GameSessionMessagesResponse {
  rows: Array<Record<string, unknown>>;
  swipes: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

export interface GameSessionAssetsResponse {
  files: Array<{ path: string; size: number; scope: "disk" }>;
  chatImages: Array<Record<string, unknown>>;
  totalBytes: number;
  spriteIds: string[];
  backgroundDir: string;
  npcAvatarDir: string;
  galleryDir: string;
  gameAssetsRoot: string;
}

const adminGameKeys = {
  all: ["admin-game"] as const,
  campaigns: () => [...adminGameKeys.all, "campaigns"] as const,
  sessions: (gameId: string) => [...adminGameKeys.all, "sessions", gameId] as const,
  inspector: (chatId: string) => [...adminGameKeys.all, "inspector", chatId] as const,
  messages: (chatId: string, limit: number, offset: number) =>
    [...adminGameKeys.all, "messages", chatId, limit, offset] as const,
  snapshots: (chatId: string) => [...adminGameKeys.all, "snapshots", chatId] as const,
  checkpoints: (chatId: string) => [...adminGameKeys.all, "checkpoints", chatId] as const,
  agentRuns: (chatId: string) => [...adminGameKeys.all, "agent-runs", chatId] as const,
  assets: (chatId: string) => [...adminGameKeys.all, "assets", chatId] as const,
  references: (chatId: string) => [...adminGameKeys.all, "references", chatId] as const,
};

export function useGameAdminCampaigns() {
  return useQuery({
    queryKey: adminGameKeys.campaigns(),
    queryFn: () => api.get<{ campaigns: GameCampaignListItem[] }>("/admin/game/campaigns"),
  });
}

export function useGameAdminSessions(gameId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.sessions(gameId ?? ""),
    queryFn: () => api.get<{ gameId: string; sessions: GameSessionListItem[] }>(`/admin/game/campaigns/${gameId}/sessions`),
    enabled: !!gameId,
  });
}

export function useGameAdminInspector(chatId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.inspector(chatId ?? ""),
    queryFn: () => api.get<GameSessionInspector>(`/admin/game/sessions/${chatId}`),
    enabled: !!chatId,
  });
}

export function useGameAdminMessages(chatId: string | null, limit = 100, offset = 0) {
  return useQuery({
    queryKey: adminGameKeys.messages(chatId ?? "", limit, offset),
    queryFn: () =>
      api.get<GameSessionMessagesResponse>(
        `/admin/game/sessions/${chatId}/messages?limit=${limit}&offset=${offset}`,
      ),
    enabled: !!chatId,
  });
}

export function useGameAdminSnapshots(chatId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.snapshots(chatId ?? ""),
    queryFn: () => api.get<{ rows: Array<Record<string, unknown>>; total: number }>(`/admin/game/sessions/${chatId}/snapshots`),
    enabled: !!chatId,
  });
}

export function useGameAdminCheckpoints(chatId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.checkpoints(chatId ?? ""),
    queryFn: () =>
      api.get<{ rows: Array<Record<string, unknown>>; total: number }>(`/admin/game/sessions/${chatId}/checkpoints`),
    enabled: !!chatId,
  });
}

export function useGameAdminAgentRuns(chatId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.agentRuns(chatId ?? ""),
    queryFn: () =>
      api.get<{ runs: Array<Record<string, unknown>>; memory: Array<Record<string, unknown>> }>(
        `/admin/game/sessions/${chatId}/agent-runs`,
      ),
    enabled: !!chatId,
  });
}

export function useGameAdminAssets(chatId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.assets(chatId ?? ""),
    queryFn: () => api.get<GameSessionAssetsResponse>(`/admin/game/sessions/${chatId}/assets`),
    enabled: !!chatId,
  });
}

export function useGameAdminReferences(chatId: string | null) {
  return useQuery({
    queryKey: adminGameKeys.references(chatId ?? ""),
    queryFn: () => api.get<GameSessionExportReferences>(`/admin/game/sessions/${chatId}/references`),
    enabled: !!chatId,
  });
}

export function useExportGameSession() {
  return useMutation({
    mutationFn: async (chatId: string) => {
      await api.download(`/admin/game/sessions/${chatId}/export?inlineFileData=true`, `game-session-${chatId.slice(0, 8)}.zip`);
    },
  });
}

export function useExportGameCampaign() {
  return useMutation({
    mutationFn: async (gameId: string) => {
      await api.download(`/admin/game/campaigns/${gameId}/export?inlineFileData=true`, `game-campaign-${gameId.slice(0, 8)}.zip`);
    },
  });
}

export function usePatchGameSessionMetadata(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (metadata: Record<string, unknown>) =>
      api.patch<{ metadata: Record<string, unknown> }>(`/admin/game/sessions/${chatId}/metadata`, { metadata }),
    onSuccess: () => {
      if (!chatId) return;
      void qc.invalidateQueries({ queryKey: adminGameKeys.inspector(chatId) });
      void qc.invalidateQueries({ queryKey: adminGameKeys.checkpoints(chatId) });
    },
  });
}
