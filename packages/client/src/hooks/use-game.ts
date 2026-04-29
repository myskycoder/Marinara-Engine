// ──────────────────────────────────────────────
// Hook: Game Mode API
// ──────────────────────────────────────────────
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import { chatKeys } from "./use-chats";
import { useGameModeStore } from "../stores/game-mode.store";
import { useGameStateStore } from "../stores/game-state.store";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import type {
  GameActiveState,
  GameMap,
  GameSetupConfig,
  DiceRollResult,
  SessionSummary,
  Combatant,
  CombatRoundResult,
  CombatPlayerAction,
  HudWidget,
  GameNpc,
} from "@marinara-engine/shared";
import type { Chat } from "@marinara-engine/shared";
import { spriteKeys } from "./use-characters";

// ── Query Keys ──

export const gameKeys = {
  all: ["game"] as const,
  sessions: (gameId: string) => [...gameKeys.all, "sessions", gameId] as const,
  relatedTimelines: (gameId: string) => [...gameKeys.all, "related-timelines", gameId] as const,
};

// ── Types ──

interface CreateGameResponse {
  sessionChat: Chat;
  gameId: string;
}

interface SetupResponse {
  setup: Record<string, unknown>;
  worldOverview: string | null;
}

interface StartGameResponse {
  status: string;
}

interface StartSessionResponse {
  sessionChat: Chat;
  sessionNumber: number;
  recap: string;
}

interface ConcludeSessionResponse {
  summary: SessionSummary;
}

interface RegenerateSessionConclusionResponse {
  summary: SessionSummary;
}

interface UpdateCampaignProgressionResponse {
  sessionChat: Chat;
  gameId: string;
  campaignProgression: {
    storyArc: string | null;
    plotTwists: string[];
    partyArcs: unknown[];
  };
}

interface RecruitPartyMemberResponse {
  sessionChat: Chat;
  added: boolean;
  characterName: string;
  cardCreated: boolean;
}

interface RemovePartyMemberResponse {
  sessionChat: Chat;
  removed: boolean;
  characterName: string;
}

interface DiceRollResponse {
  result: DiceRollResult;
}

interface StateTransitionResponse {
  previousState: GameActiveState;
  newState: GameActiveState;
}

interface MapGenerateResponse {
  map: GameMap;
  maps?: GameMap[];
  activeGameMapId?: string | null;
}

interface MapMoveResponse {
  map: GameMap;
  maps?: GameMap[];
  activeGameMapId?: string | null;
}

interface UpdateGameWidgetsResponse {
  ok: boolean;
}

// ── Mutations ──

export function useCreateGame() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: {
      name: string;
      setupConfig: GameSetupConfig;
      connectionId?: string;
      characterConnectionId?: string;
      promptPresetId?: string;
      chatId?: string;
    }) => api.post<CreateGameResponse>("/game/create", data),
    onSuccess: (res) => {
      store.getState().setActiveGame(res.gameId, res.sessionChat.id, null);
      store.getState().setSetupActive(true);
      // Collapse sidebar when starting a new game to maximize game area
      useUIStore.getState().setSidebarOpen(false);
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
    onError: (err) => {
      console.error("[createGame] Error:", err);
    },
  });
}

export function useGameSetup() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; connectionId?: string; preferences: string }) =>
      api.post<SetupResponse>("/game/setup", { ...data, streaming: useUIStore.getState().enableStreaming }),
    onSuccess: () => {
      store.getState().setSetupActive(false);
      const sessionChatId = store.getState().activeSessionChatId;
      if (sessionChatId) {
        qc.invalidateQueries({ queryKey: chatKeys.detail(sessionChatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sessionChatId) });
      }
    },
    onError: (err) => {
      console.error("[gameSetup] Error:", err);
      toast.error(err.message || "Game setup failed. Try again or use a different model.", { duration: 10000 });
    },
  });
}

export function useStartGame() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string }) => api.post<StartGameResponse>("/game/start", data),
    onSuccess: () => {
      const sessionChatId = store.getState().activeSessionChatId;
      if (sessionChatId) {
        qc.invalidateQueries({ queryKey: chatKeys.detail(sessionChatId) });
      }
    },
    onError: (err) => {
      console.error("[startGame] Error:", err);
    },
  });
}

export function useStartSession() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { gameId: string; connectionId?: string }) =>
      api.post<StartSessionResponse>("/game/session/start", data),
    onMutate: (variables) => {
      toast.loading("Starting the next session and generating recap...", {
        id: `game-session-start:${variables.gameId}`,
      });
    },
    onSuccess: (res, variables) => {
      store.getState().setActiveGame(variables.gameId, res.sessionChat.id, null);
      store.getState().setSessionNumber(res.sessionNumber);
      qc.setQueryData(chatKeys.detail(res.sessionChat.id), res.sessionChat);
      useChatStore.getState().setActiveChatId(res.sessionChat.id);
      toast.success(`Session ${res.sessionNumber} is ready.`, {
        id: `game-session-start:${variables.gameId}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: gameKeys.sessions(variables.gameId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(res.sessionChat.id) });
    },
    onError: (err, variables) => {
      console.error("[startSession] Error:", err);
      toast.error(err.message || "Failed to start the next session.", {
        id: `game-session-start:${variables.gameId}`,
      });
    },
  });
}

export function useConcludeSession() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; connectionId?: string; nextSessionRequest?: string }) =>
      api.post<ConcludeSessionResponse>("/game/session/conclude", data),
    onMutate: (variables) => {
      console.info("[game/session/conclude] Starting conclude request", variables);
      toast.loading("Ending session and generating summary...", {
        id: `game-session-conclude:${variables.chatId}`,
      });
    },
    onSuccess: (_, variables) => {
      console.info("[game/session/conclude] Conclude request completed", variables);
      toast.success("Session concluded.", {
        id: `game-session-conclude:${variables.chatId}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(variables.chatId) });
    },
    onError: (err, variables) => {
      console.error("[game/session/conclude] Error:", err);
      toast.error(err.message || "Failed to end session.", {
        id: `game-session-conclude:${variables.chatId}`,
      });
    },
  });
}

export function useRegenerateSessionConclusion() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; sessionNumber: number; connectionId?: string }) =>
      api.post<RegenerateSessionConclusionResponse>("/game/session/regenerate-conclusion", data),
    onMutate: (variables) => {
      toast.loading(`Regenerating session ${variables.sessionNumber} conclusion...`, {
        id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
    onSuccess: (_, variables) => {
      toast.success(`Session ${variables.sessionNumber} conclusion regenerated.`, {
        id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(variables.chatId) });
    },
    onError: (err, variables) => {
      console.error("[game/session/regenerate-conclusion] Error:", err);
      toast.error(err.message || "Failed to regenerate session conclusion.", {
        id: `game-session-regenerate:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
  });
}

export function useUpdateCampaignProgression() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; sessionNumber: number; connectionId?: string }) =>
      api.post<UpdateCampaignProgressionResponse>("/game/session/update-campaign-progression", data),
    onMutate: (variables) => {
      toast.loading(`Updating plot arcs from session ${variables.sessionNumber}...`, {
        id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(res.sessionChat.id), res.sessionChat);
      toast.success(`Plot arcs updated from session ${variables.sessionNumber}.`, {
        id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
      });
      qc.invalidateQueries({ queryKey: chatKeys.detail(res.sessionChat.id) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: gameKeys.sessions(res.gameId) });
    },
    onError: (err, variables) => {
      console.error("[game/session/update-campaign-progression] Error:", err);
      toast.error(err.message || "Failed to update plot arcs.", {
        id: `game-campaign-progression:${variables.chatId}:${variables.sessionNumber}`,
      });
    },
  });
}

export function useRecruitPartyMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; characterName: string; connectionId?: string }) =>
      api.post<RecruitPartyMemberResponse>("/game/party/recruit", data),
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(variables.chatId), res.sessionChat);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      if (res.added) {
        toast.success(`${res.characterName} joined the party.`);
      } else if (res.cardCreated) {
        toast.success(`${res.characterName}'s party card was created.`);
      }
    },
    onError: (err) => {
      console.error("[recruitPartyMember] Error:", err);
      toast.error(err.message || "Failed to recruit party member.");
    },
  });
}

export function useRemovePartyMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: { chatId: string; characterName: string }) =>
      api.post<RemovePartyMemberResponse>("/game/party/remove", data),
    onSuccess: (res, variables) => {
      qc.setQueryData(chatKeys.detail(variables.chatId), res.sessionChat);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      if (res.removed) {
        toast.success(`${res.characterName} left the party.`);
      }
    },
    onError: (err) => {
      console.error("[removePartyMember] Error:", err);
      toast.error(err.message || "Failed to remove party member.");
    },
  });
}

export function useRollDice() {
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; notation: string; context?: string }) =>
      api.post<DiceRollResponse>("/game/dice/roll", data),
    onSuccess: (res) => {
      store.getState().setDiceRollResult(res.result);
    },
  });
}

export function useSkillCheck() {
  return useMutation({
    mutationFn: (data: { chatId: string; skill: string; dc: number; advantage?: boolean; disadvantage?: boolean }) =>
      api.post<{ result: import("@marinara-engine/shared").SkillCheckResult }>("/game/skill-check", data),
  });
}

export function useTransitionGameState() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; newState: GameActiveState }) =>
      api.post<StateTransitionResponse>("/game/state/transition", data),
    onSuccess: (res, variables) => {
      store.getState().setGameState(res.newState);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
  });
}

export function useGenerateMap() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; locationType: string; context: string; connectionId?: string }) =>
      api.post<MapGenerateResponse>("/game/map/generate", data),
    onSuccess: (res, variables) => {
      if (res.maps?.length) {
        store.getState().setMaps(res.maps, res.activeGameMapId);
      } else {
        store.getState().setCurrentMap(res.map);
      }
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
  });
}

export function useMoveOnMap() {
  const qc = useQueryClient();
  const store = useGameModeStore;

  return useMutation({
    mutationFn: (data: { chatId: string; position: { x: number; y: number } | string; mapId?: string | null }) =>
      api.post<MapMoveResponse>("/game/map/move", data),
    onSuccess: (res, variables) => {
      if (res.maps?.length) {
        store.getState().setMaps(res.maps, res.activeGameMapId);
      } else {
        store.getState().setCurrentMap(res.map);
      }
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: [...gameKeys.all, "journal", variables.chatId] });
    },
  });
}

export function useUpdateGameWidgets() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ chatId, widgets }: { chatId: string; widgets: HudWidget[] }) =>
      api.put<UpdateGameWidgetsResponse>(`/game/${chatId}/widgets`, { widgets }),
    onSuccess: (_, variables) => {
      useGameModeStore.getState().setHudWidgets(variables.widgets);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
    },
    onError: (err) => {
      console.error("[updateGameWidgets] Error:", err);
    },
  });
}

// ── Queries ──

export function useGameSessions(gameId: string | null) {
  return useQuery({
    queryKey: gameKeys.sessions(gameId ?? ""),
    queryFn: () => api.get<Chat[]>(`/game/${gameId}/sessions`),
    enabled: !!gameId,
    staleTime: 2 * 60_000,
  });
}

// ── Sync hook — reads chat metadata and updates game store ──

export function useSyncGameState(activeChatId: string, chatMeta: Record<string, unknown>) {
  const prevChatIdRef = useRef<string | null>(null);

  // Reset game store only when the active chat changes, not on every metadata refetch
  useEffect(() => {
    if (prevChatIdRef.current && prevChatIdRef.current !== activeChatId) {
      useGameModeStore.getState().reset();
    }
    prevChatIdRef.current = activeChatId;
    return () => {
      useGameModeStore.getState().reset();
    };
  }, [activeChatId]);

  // Sync metadata into the game store
  useEffect(() => {
    if (!chatMeta.gameId) return;
    const state = useGameModeStore.getState();

    if (chatMeta.gameId !== state.activeGameId) {
      useGameModeStore
        .getState()
        .setActiveGame(chatMeta.gameId as string, activeChatId, chatMeta.gamePartyChatId as string | undefined);
      // Auto-collapse the chat sidebar when entering a game to maximize game area
      useUIStore.getState().setSidebarOpen(false);
    }
    if (chatMeta.gameActiveState && chatMeta.gameActiveState !== state.gameState) {
      useGameModeStore.getState().setGameState(chatMeta.gameActiveState as GameActiveState);
    }
    const metadataMaps = Array.isArray(chatMeta.gameMaps) ? (chatMeta.gameMaps as GameMap[]) : [];
    const activeMapId = typeof chatMeta.activeGameMapId === "string" ? chatMeta.activeGameMapId : null;
    if (metadataMaps.length > 0) {
      useGameModeStore.getState().setMaps(metadataMaps, activeMapId);
    } else if (chatMeta.gameMap && chatMeta.gameMap !== state.currentMap) {
      useGameModeStore.getState().setCurrentMap(chatMeta.gameMap as GameMap);
    }
    if (chatMeta.gameNpcs) {
      useGameModeStore.getState().setNpcs(chatMeta.gameNpcs as any[]);
    }
    if (chatMeta.gameSessionNumber) {
      useGameModeStore.getState().setSessionNumber(chatMeta.gameSessionNumber as number);
    }
    if (chatMeta.gameSessionStatus === "setup") {
      useGameModeStore.getState().setSetupActive(true);
    }
    // Load blueprint + HUD widgets (only if store doesn't already have them)
    if (chatMeta.gameBlueprint && !state.blueprint) {
      const bp = chatMeta.gameBlueprint as import("@marinara-engine/shared").GameBlueprint;
      useGameModeStore.getState().setBlueprint(bp);
      if (bp.hudWidgets?.length) {
        // Normalize: GM may produce "items" instead of "contents" for inventory_grid,
        // and older blueprints used {name, slot: number} instead of {name, slot?: string, quantity}.
        const normalized = bp.hudWidgets.map((w) => {
          if (w.type === "inventory_grid" && !w.config.contents && Array.isArray((w.config as any).items)) {
            const items = (w.config as any).items as Array<{ name: string; slot?: string | number; quantity?: number }>;
            return {
              ...w,
              config: {
                ...w.config,
                contents: items.map((i) => ({
                  name: i.name,
                  slot: typeof i.slot === "string" ? i.slot : undefined,
                  quantity: i.quantity ?? 1,
                })),
              },
            };
          }
          return w;
        });
        useGameModeStore.getState().setHudWidgets(normalized);
      }
    }
    // Load persisted widget state (overrides blueprint defaults)
    if (chatMeta.gameWidgetState && Array.isArray(chatMeta.gameWidgetState)) {
      const persisted = chatMeta.gameWidgetState as import("@marinara-engine/shared").HudWidget[];
      if (persisted.length > 0) {
        useGameModeStore.getState().setHudWidgets(persisted);
      }
    }
  }, [activeChatId, chatMeta]);
}

/**
 * Polls `chatKeys.detail(activeChatId)` while at least one materialised game
 * NPC is missing its `avatarUrl` or has a `pending` sprite status. The Auto
 * NPC Materialiser kicks off avatar/sprite generation as fire-and-forget
 * background tasks that can finish AFTER the streaming `done` event closes
 * the SSE reply, so a single invalidation on `done` only catches assets that
 * happen to be ready already. This watcher fills the gap by re-fetching
 * metadata until every NPC has its assets, then tears down automatically.
 *
 * Strategy:
 *   - Recursive `setTimeout` chain instead of `setInterval`. Each tick
 *     reschedules itself with the next delay, so the cadence can grow.
 *   - Exponential backoff: ~3s → 5s → 8s → 13s → 21s → 34s → 55s, capped
 *     at 60s. Image generation on slow image providers can take >30s for
 *     a single NPC; backing off avoids hammering the server with cheap
 *     metadata fetches that almost certainly haven't observed any change
 *     yet.
 *   - Visibility-aware pause: when the tab is hidden we re-poll every 5s
 *     just to keep the timer alive, but skip the expensive `invalidate`.
 *     `document.visibilitychange` resets the attempt counter so the user
 *     gets a fresh fast poll right after re-focusing.
 *   - No hard ceiling. The previous 60s cutoff would silently abandon
 *     long-running generations; under backoff each later poll is cheap
 *     enough to keep going indefinitely. Cleanup happens via the existing
 *     `hasPendingAssets` guard once everything resolves.
 */
export function useNpcAssetWatcher(activeChatId: string | null) {
  const qc = useQueryClient();
  const npcs = useGameModeStore((s) => s.npcs);

  const hasPendingAssets = useMemo(() => {
    if (npcs.length === 0) return false;
    return npcs.some((n) => !n.avatarUrl || n.spriteStatus === "pending");
  }, [npcs]);

  useEffect(() => {
    if (!activeChatId || !hasPendingAssets) return;

    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const FIRST_DELAY_MS = 3000;
    const MAX_DELAY_MS = 60_000;
    const HIDDEN_RECHECK_MS = 5000;

    const computeDelay = (n: number): number => {
      const grown = FIRST_DELAY_MS * Math.pow(1.6, n);
      return Math.min(MAX_DELAY_MS, grown);
    };

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(tick, delayMs);
    };

    const tick = () => {
      if (cancelled) return;
      // Tab is hidden — skip the network round-trip but keep the timer
      // alive so we resume promptly when the user comes back.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule(HIDDEN_RECHECK_MS);
        return;
      }
      qc.invalidateQueries({ queryKey: chatKeys.detail(activeChatId) });
      attempt += 1;
      schedule(computeDelay(attempt));
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        // Reset backoff and poll right away — there may be assets the user
        // can finally see now that they've come back.
        attempt = 0;
        if (timer !== undefined) window.clearTimeout(timer);
        schedule(0);
      }
    };

    schedule(FIRST_DELAY_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [activeChatId, hasPendingAssets, qc]);
}

/**
 * After NPC sprite generation completes (`pending` → `ready`), invalidate
 * `spriteKeys.list(spriteId)` so dialogue avatars and VN overlays refetch
 * fresh `?v=mtime` URLs instead of a still-fresh 5-minute React Query cache.
 * Also clears stale lists on `pending` → `failed` after a regen wiped files.
 */
export function useInvalidateNpcSpriteListOnReady(npcs: GameNpc[]) {
  const qc = useQueryClient();
  const prevByNpcIdRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const prev = prevByNpcIdRef.current;
    for (const npc of npcs) {
      const spriteId = npc.spriteId?.trim();
      if (!spriteId) continue;
      const was = prev.get(npc.id);
      const now = npc.spriteStatus ?? "";
      if (was === "pending" && (now === "ready" || now === "failed")) {
        void qc.invalidateQueries({ queryKey: spriteKeys.list(spriteId) });
      }
      prev.set(npc.id, now);
    }
    for (const id of [...prev.keys()]) {
      if (!npcs.some((n) => n.id === id)) prev.delete(id);
    }
  }, [npcs, qc]);
}

interface RegenerateNpcAssetsRequest {
  chatId: string;
  npcId: string;
  /** Defaults to true on the server. Pass `false` to skip avatar regeneration. */
  avatar?: boolean;
  /** Defaults to true on the server. Pass `false` to skip sprite regeneration. */
  sprite?: boolean;
}

interface RegenerateNpcAssetsResponse {
  ok: boolean;
  npcId: string;
  npcName: string | null;
  regenerated: { avatar: boolean; sprite: boolean };
  reason?: "npc-not-found" | "no-image-connection" | "nothing-to-do";
}

/**
 * Manually regenerate an NPC's avatar and/or sprite. The server deletes the
 * existing on-disk artifacts (otherwise the existsSync short-circuits in the
 * generators would skip work), resets metadata fields, and re-runs the
 * unified asset pipeline. We invalidate `chatKeys.detail` on success so the
 * NPC's cleared-out `avatarUrl` is reflected immediately, then the existing
 * `useNpcAssetWatcher` polling picks up the regenerated assets.
 */
export function useRegenerateNpcAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RegenerateNpcAssetsRequest) =>
      api.post<RegenerateNpcAssetsResponse>("/game/npc/regenerate", data),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(vars.chatId) });
      if (!res.ok) {
        const msg =
          res.reason === "no-image-connection"
            ? "Image generation is not configured for this game"
            : res.reason === "npc-not-found"
              ? "NPC not found"
              : res.reason === "nothing-to-do"
                ? "Nothing selected to regenerate"
                : "Could not start regeneration";
        toast.error(msg);
        return;
      }
      const { avatar, sprite } = res.regenerated;
      const what = avatar && sprite ? "avatar & sprite" : avatar ? "avatar" : "sprite";
      toast.success(`Regenerating ${what} for ${res.npcName ?? "NPC"}…`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    },
  });
}

// ── New Game Mechanics Hooks ──

export function useCombatRound() {
  return useMutation({
    mutationFn: (data: {
      chatId: string;
      combatants: Array<Omit<Combatant, "sprite">>;
      round: number;
      playerAction?: CombatPlayerAction;
    }) => api.post<{ result: CombatRoundResult; combatants: Combatant[] }>("/game/combat/round", data),
  });
}

export function useCombatLoot() {
  return useMutation({
    mutationFn: async (data: { chatId: string; enemyCount: number }) => {
      const res = await api.post<{
        drops: Array<{ item?: { name?: string | null } | null; quantity?: number | null } | null>;
      }>("/game/combat/loot", data);

      return {
        drops: (res.drops ?? [])
          .filter((drop): drop is NonNullable<(typeof res.drops)[number]> => !!drop?.item?.name)
          .map((drop) => ({ name: drop.item!.name!, quantity: drop.quantity ?? undefined })),
      };
    },
  });
}

export function useLootGenerate() {
  return useMutation({
    mutationFn: (data: { chatId: string; count?: number }) =>
      api.post<{ drops: unknown[] }>("/game/loot/generate", data),
  });
}

export function useAdvanceTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatId: string; action: string }) =>
      api.post<{ time: unknown; formatted: string }>("/game/time/advance", data),
    onSuccess: (res, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      // Sync time into the game state snapshot so WeatherEffects updates immediately
      if (res.formatted) {
        const current = useGameStateStore.getState().current;
        if (current) {
          useGameStateStore.getState().setGameState({
            ...current,
            time: res.formatted,
          });
        }
      }
    },
  });
}

export function useUpdateWeather() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatId: string; action: string; location?: string; season?: string; type?: string }) =>
      api.post<{ changed: boolean; weather: { type: string; temperature: number } }>("/game/weather/update", data),
    onSuccess: (res, variables) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      // Sync weather into the game state snapshot store so WeatherEffects updates immediately
      if (res.changed && res.weather) {
        const current = useGameStateStore.getState().current;
        if (current) {
          useGameStateStore.getState().setGameState({
            ...current,
            weather: res.weather.type,
            temperature: `${res.weather.temperature}°C`,
          });
        }
      }
    },
  });
}

export function useRollEncounter() {
  return useMutation({
    mutationFn: (data: { chatId: string; action: string; location?: string }) =>
      api.post<{ encounter: { triggered: boolean; type: string | null; hint: string }; enemyCount: number }>(
        "/game/encounter/roll",
        data,
      ),
  });
}

export function useUpdateReputation() {
  const qc = useQueryClient();
  const store = useGameModeStore;
  return useMutation({
    mutationFn: (data: { chatId: string; actions: Array<{ npcId: string; action: string; modifier?: number }> }) =>
      api.post<{ npcs: unknown[]; changes: unknown[] }>("/game/reputation/update", data),
    onSuccess: (res, variables) => {
      store.getState().setNpcs(res.npcs as any[]);
      qc.invalidateQueries({ queryKey: chatKeys.detail(variables.chatId) });
      qc.invalidateQueries({ queryKey: [...gameKeys.all, "journal", variables.chatId] });
    },
  });
}

export function useJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatId: string; type: string; data: Record<string, unknown> }) =>
      api.post<{ journal: unknown }>("/game/journal/entry", data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: [...gameKeys.all, "journal", variables.chatId] });
    },
  });
}

export function useGameJournal(chatId: string | null) {
  return useQuery({
    queryKey: [...gameKeys.all, "journal", chatId],
    queryFn: () => api.get<{ journal: unknown; recap: string }>(`/game/${chatId}/journal`),
    enabled: !!chatId,
    staleTime: 30_000,
  });
}

// ── Checkpoints ──

export function useGameCheckpoints(chatId: string | null) {
  return useQuery({
    queryKey: [...gameKeys.all, "checkpoints", chatId],
    queryFn: () => api.get<import("@marinara-engine/shared").GameCheckpoint[]>(`/game/${chatId}/checkpoints`),
    enabled: !!chatId,
    staleTime: 30_000,
  });
}

export function useCreateCheckpoint() {
  return useMutation({
    mutationFn: (data: { chatId: string; label: string; triggerType: string }) =>
      api.post<{ id: string }>("/game/checkpoint", data),
  });
}

export function useLoadCheckpoint() {
  return useMutation({
    mutationFn: (data: { chatId: string; checkpointId: string }) =>
      api.post<{ ok: boolean; messageId: string }>("/game/checkpoint/load", data),
  });
}

export function useDeleteCheckpoint() {
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/game/checkpoint/${id}`),
  });
}

export interface GameTimelineForkRow {
  chatId: string;
  name: string;
  gameId?: string;
  forkLabel?: string;
  forkedFromMessageId?: string;
  updatedAt: string;
}

export function useRelatedGameTimelines(gameId: string | null) {
  return useQuery({
    queryKey: gameId ? gameKeys.relatedTimelines(gameId) : [...gameKeys.all, "related-timelines", "none"],
    queryFn: () => api.get<{ timelines: GameTimelineForkRow[] }>(`/game/${gameId}/related-timelines`),
    enabled: !!gameId,
    staleTime: 30_000,
  });
}

export function useForkGameTimeline() {
  const qc = useQueryClient();
  const store = useGameModeStore;
  return useMutation({
    mutationFn: (data: { chatId: string; upToMessageId: string; name?: string; forkLabel?: string }) =>
      api.post<Chat>(`/game/${data.chatId}/fork-timeline`, {
        upToMessageId: data.upToMessageId,
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.forkLabel?.trim() ? { forkLabel: data.forkLabel.trim() } : {}),
      }),
    onSuccess: (newChat) => {
      const meta = newChat.metadata as Record<string, unknown> | undefined;
      const gid = (meta?.gameId as string) || "";
      const lineage = (meta?.forkLineageRootGameId as string) || gid;
      store.getState().setActiveGame(gid, newChat.id, (meta?.gamePartyChatId as string | undefined) ?? null);
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: chatKeys.detail(newChat.id) });
      qc.invalidateQueries({ queryKey: chatKeys.messages(newChat.id) });
      if (lineage) {
        qc.invalidateQueries({ queryKey: gameKeys.relatedTimelines(lineage) });
      }
      if (gid) {
        qc.invalidateQueries({ queryKey: gameKeys.sessions(gid) });
      }
    },
  });
}
