import { useCallback, useEffect } from "react";
import type { GameState, PlayerStats } from "@marinara-engine/shared";
import { api } from "../lib/api-client";
import { useGameStateStore } from "../stores/game-state.store";

export type GameStatePatchField =
  | "date"
  | "time"
  | "location"
  | "weather"
  | "temperature"
  | "presentCharacters"
  | "playerStats"
  | "personaStats";

type GameStatePatch = Partial<Record<GameStatePatchField, unknown>>;

const PATCH_DEBOUNCE_MS = 500;
const pendingPatches = new Map<string, GameStatePatch>();
const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();
let beforeUnloadListeners = 0;

function createEmptyPlayerStats(): PlayerStats {
  return {
    stats: [],
    attributes: null,
    skills: {},
    inventory: [],
    activeQuests: [],
    status: "",
  };
}

function createEmptyGameState(chatId: string): GameState {
  return {
    id: "",
    chatId,
    messageId: "",
    swipeIndex: 0,
    date: null,
    time: null,
    location: null,
    weather: null,
    temperature: null,
    presentCharacters: [],
    recentEvents: [],
    playerStats: null,
    personaStats: null,
    createdAt: "",
  };
}

function getCurrentGameStateForChat(chatId: string) {
  const current = useGameStateStore.getState().current;
  return current?.chatId === chatId ? current : null;
}

function buildPayloadFromLatestState(chatId: string, queued: GameStatePatch) {
  const current = getCurrentGameStateForChat(chatId);
  const payload: GameStatePatch = {};

  for (const field of Object.keys(queued) as GameStatePatchField[]) {
    payload[field] = current ? current[field] : queued[field];
  }

  return payload;
}

function queuePatch(chatId: string, field: GameStatePatchField, value: unknown) {
  const queued = pendingPatches.get(chatId) ?? {};
  queued[field] = value;
  pendingPatches.set(chatId, queued);

  const existingTimer = patchTimers.get(chatId);
  if (existingTimer) clearTimeout(existingTimer);

  patchTimers.set(
    chatId,
    setTimeout(() => {
      void flushGameStatePatch(chatId).catch((error) => {
        console.warn("Failed to flush game-state patch", error);
      });
    }, PATCH_DEBOUNCE_MS),
  );
}

export async function flushGameStatePatch(chatId?: string) {
  const chatIds = chatId ? [chatId] : Array.from(pendingPatches.keys());
  const errors: unknown[] = [];

  for (const id of chatIds) {
    const timer = patchTimers.get(id);
    if (timer) clearTimeout(timer);
    patchTimers.delete(id);

    const queued = pendingPatches.get(id);
    if (!queued || Object.keys(queued).length === 0) continue;
    const queuedSnapshot = { ...queued };
    pendingPatches.delete(id);

    const payload = buildPayloadFromLatestState(id, queuedSnapshot);
    try {
      await api.patch(`/chats/${id}/game-state`, { ...payload, manual: true });
    } catch (error) {
      pendingPatches.set(id, {
        ...queuedSnapshot,
        ...(pendingPatches.get(id) ?? {}),
      });
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to flush ${errors.length} game-state patch${errors.length === 1 ? "" : "es"}.`);
  }
}

export function discardPendingGameStatePatch(chatId?: string) {
  const chatIds = chatId ? [chatId] : Array.from(pendingPatches.keys());

  for (const id of chatIds) {
    const timer = patchTimers.get(id);
    if (timer) clearTimeout(timer);
    patchTimers.delete(id);
    pendingPatches.delete(id);
  }
}

function flushGameStatePatchOnUnload() {
  for (const [chatId, queued] of pendingPatches.entries()) {
    const timer = patchTimers.get(chatId);
    if (timer) clearTimeout(timer);
    patchTimers.delete(chatId);
    pendingPatches.delete(chatId);

    if (Object.keys(queued).length === 0) continue;
    const payload = buildPayloadFromLatestState(chatId, queued);
    void api.patch(`/chats/${chatId}/game-state`, { ...payload, manual: true }, { keepalive: true }).catch(() => {});
  }
}

function retainBeforeUnloadFlush() {
  if (beforeUnloadListeners === 0) {
    window.addEventListener("beforeunload", flushGameStatePatchOnUnload);
  }
  beforeUnloadListeners += 1;

  return () => {
    beforeUnloadListeners = Math.max(0, beforeUnloadListeners - 1);
    if (beforeUnloadListeners === 0) {
      window.removeEventListener("beforeunload", flushGameStatePatchOnUnload);
    }
  };
}

export function patchGameStateField(chatId: string, field: GameStatePatchField, value: unknown) {
  const prev = getCurrentGameStateForChat(chatId);
  const nextState = { ...(prev ?? createEmptyGameState(chatId)), [field]: value } as GameState;
  useGameStateStore.getState().setGameState(nextState);
  queuePatch(chatId, field, value);
}

export function patchPlayerStatsField(chatId: string, field: keyof PlayerStats, value: unknown) {
  const current = getCurrentGameStateForChat(chatId)?.playerStats ?? createEmptyPlayerStats();
  patchGameStateField(chatId, "playerStats", { ...current, [field]: value });
}

export function useGameStatePatcher(chatId: string | null, registrationId?: string) {
  const registerFlushPatch = useGameStateStore((s) => s.registerFlushPatch);

  const patchField = useCallback(
    (field: GameStatePatchField, value: unknown) => {
      if (!chatId) return;
      patchGameStateField(chatId, field, value);
    },
    [chatId],
  );

  const patchPlayerStats = useCallback(
    (field: keyof PlayerStats, value: unknown) => {
      if (!chatId) return;
      patchPlayerStatsField(chatId, field, value);
    },
    [chatId],
  );

  const flushPatch = useCallback(async () => {
    if (!chatId) return;
    await flushGameStatePatch(chatId);
  }, [chatId]);

  useEffect(() => retainBeforeUnloadFlush(), []);

  useEffect(() => {
    if (!registrationId) return;
    const unregister = registerFlushPatch(registrationId, flushPatch);
    return () => {
      unregister();
      void flushPatch().catch((error) => {
        console.warn("Failed to flush game-state patch on cleanup", error);
      });
    };
  }, [flushPatch, registerFlushPatch, registrationId]);

  return { patchField, patchPlayerStats, flushPatch };
}
