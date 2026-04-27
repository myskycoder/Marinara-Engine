// ──────────────────────────────────────────────
// Store: Game Mode
// ──────────────────────────────────────────────
import { create } from "zustand";
import { api } from "../lib/api-client";
import type {
  GameActiveState,
  GameMap,
  GameNpc,
  DiceRollResult,
  HudWidget,
  GameBlueprint,
  WidgetUpdate,
} from "@marinara-engine/shared";

interface GameModeStore {
  /** The active game ID (groupId that links all sessions). */
  activeGameId: string | null;
  /** Current session chat ID. */
  activeSessionChatId: string | null;
  /** Linked party chat ID. */
  partyChatId: string | null;
  /** Current game state. */
  gameState: GameActiveState;
  /** Current map. */
  currentMap: GameMap | null;
  /** NPCs discovered in this game. */
  npcs: GameNpc[];
  /** Whether the setup wizard is showing. */
  isSetupActive: boolean;
  /** Current step in the setup wizard. */
  setupStep: number;
  /** Last dice roll result (for animation). */
  diceRollResult: DiceRollResult | null;
  /** Character sheet modal state. */
  characterSheetOpen: boolean;
  characterSheetCharId: string | null;
  /** Party chat sidebar expanded. */
  partyChatExpanded: boolean;
  /** Session number. */
  sessionNumber: number;
  /** Model-designed HUD widgets. */
  hudWidgets: HudWidget[];
  /** Game blueprint from setup. */
  blueprint: GameBlueprint | null;

  // Actions
  setActiveGame: (gameId: string | null, sessionChatId?: string | null, partyChatId?: string | null) => void;
  setGameState: (state: GameActiveState) => void;
  setCurrentMap: (map: GameMap | null) => void;
  setNpcs: (npcs: GameNpc[]) => void;
  setSetupActive: (active: boolean) => void;
  setSetupStep: (step: number) => void;
  setDiceRollResult: (result: DiceRollResult | null) => void;
  openCharacterSheet: (charId: string) => void;
  closeCharacterSheet: () => void;
  togglePartyChat: () => void;
  setPartyChatExpanded: (expanded: boolean) => void;
  setSessionNumber: (num: number) => void;
  setHudWidgets: (widgets: HudWidget[]) => void;
  applyWidgetUpdate: (update: WidgetUpdate) => void;
  setBlueprint: (bp: GameBlueprint | null) => void;
  /** Patch avatarUrl on tracked NPCs after server-side image generation. */
  patchNpcAvatars: (avatars: Array<{ name: string; avatarUrl: string }>) => void;
  reset: () => void;
}

// Debounced widget persistence
let widgetPersistTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPersistWidgets(chatId: string, widgets: HudWidget[]) {
  if (widgetPersistTimer) clearTimeout(widgetPersistTimer);
  widgetPersistTimer = setTimeout(() => {
    api.put(`/game/${chatId}/widgets`, { widgets }).catch(() => {
      /* best-effort persistence */
    });
  }, 1000);
}

const MAX_LIST_WIDGET_ITEMS = 5;

function normalizeListWidgetItem(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?;,:]+$/g, "")
    .toLowerCase();
}

function appendListWidgetItem(items: string[], nextItem: string): string[] {
  const cleaned = nextItem.trim();
  if (!cleaned) return items;

  const normalizedNewItem = normalizeListWidgetItem(cleaned);
  const dedupedItems = items.filter((item) => normalizeListWidgetItem(item) !== normalizedNewItem);
  return [...dedupedItems, cleaned].slice(-MAX_LIST_WIDGET_ITEMS);
}

function removeListWidgetItem(items: string[], target: string): string[] {
  const normalizedTarget = normalizeListWidgetItem(target);
  if (!normalizedTarget) return items;

  const exactMatchIndex = items.findIndex((item) => normalizeListWidgetItem(item) === normalizedTarget);
  if (exactMatchIndex >= 0) {
    return items.filter((_, index) => index !== exactMatchIndex);
  }

  const partialMatches = items
    .map((item, index) => ({ index, normalized: normalizeListWidgetItem(item) }))
    .filter(({ normalized }) => normalized.includes(normalizedTarget) || normalizedTarget.includes(normalized));

  if (partialMatches.length !== 1) return items;
  return items.filter((_, index) => index !== partialMatches[0]!.index);
}

const INITIAL_STATE = {
  activeGameId: null,
  activeSessionChatId: null,
  partyChatId: null,
  gameState: "exploration" as GameActiveState,
  currentMap: null,
  npcs: [],
  isSetupActive: false,
  setupStep: 0,
  diceRollResult: null,
  characterSheetOpen: false,
  characterSheetCharId: null,
  partyChatExpanded: false,
  sessionNumber: 1,
  hudWidgets: [],
  blueprint: null,
};

export const useGameModeStore = create<GameModeStore>((set) => ({
  ...INITIAL_STATE,

  setActiveGame: (gameId, sessionChatId, partyChatId) =>
    set({ activeGameId: gameId, activeSessionChatId: sessionChatId ?? null, partyChatId: partyChatId ?? null }),
  setGameState: (state) => set({ gameState: state }),
  setCurrentMap: (map) => set({ currentMap: map }),
  setNpcs: (npcs) =>
    set((s) => {
      // Preserve existing avatarUrls: the incoming list may come from a stale
      // chat-metadata cache that predates a recent /generate-assets call. If
      // we already have an avatarUrl for an NPC and the incoming record is
      // missing one, keep ours rather than clobbering it to null.
      const existingByName = new Map<string, string>();
      for (const existing of s.npcs) {
        if (existing.avatarUrl && existing.name) {
          existingByName.set(existing.name.toLowerCase(), existing.avatarUrl);
        }
      }
      const merged = npcs.map((npc) => {
        if (npc.avatarUrl) return npc;
        const preserved = existingByName.get((npc.name ?? "").toLowerCase());
        return preserved ? { ...npc, avatarUrl: preserved } : npc;
      });
      return { npcs: merged };
    }),
  patchNpcAvatars: (avatars) =>
    set((s) => ({
      npcs: s.npcs.map((npc) => {
        const match = avatars.find((a) => a.name.toLowerCase() === npc.name.toLowerCase());
        return match ? { ...npc, avatarUrl: match.avatarUrl } : npc;
      }),
    })),
  setSetupActive: (active) => set({ isSetupActive: active }),
  setSetupStep: (step) => set({ setupStep: step }),
  setDiceRollResult: (result) => set({ diceRollResult: result }),
  openCharacterSheet: (charId) => set({ characterSheetOpen: true, characterSheetCharId: charId }),
  closeCharacterSheet: () => set({ characterSheetOpen: false, characterSheetCharId: null }),
  togglePartyChat: () => set((s) => ({ partyChatExpanded: !s.partyChatExpanded })),
  setPartyChatExpanded: (expanded) => set({ partyChatExpanded: expanded }),
  setSessionNumber: (num) => set({ sessionNumber: num }),
  setHudWidgets: (widgets) => set({ hudWidgets: widgets }),
  applyWidgetUpdate: (update) =>
    set((s) => {
      const updatedWidgets = s.hudWidgets.map((w) => {
        if (w.id !== update.widgetId) return w;
        const changes = update.changes;
        const newConfig = { ...w.config };

        // Handle stat_block: update a specific stat by name
        if (changes.statName && w.type === "stat_block" && newConfig.stats) {
          const targetName = changes.statName;
          const newValue = changes.value;
          newConfig.stats = newConfig.stats.map((stat) =>
            stat.name === targetName && newValue !== undefined ? { ...stat, value: newValue } : stat,
          );
        } else {
          // Merge simple numeric/config fields
          if (changes.value !== undefined)
            newConfig.value = typeof changes.value === "number" ? changes.value : newConfig.value;
          if (changes.count !== undefined) newConfig.count = changes.count;
          if (changes.running !== undefined) newConfig.running = changes.running;
          if (changes.seconds !== undefined) newConfig.seconds = changes.seconds;
        }

        // Handle list/inventory add/remove
        if (w.type === "list") {
          let nextItems = [...(newConfig.items ?? [])];
          if (changes.remove) {
            nextItems = removeListWidgetItem(nextItems, changes.remove);
          }
          if (changes.add) {
            nextItems = appendListWidgetItem(nextItems, changes.add);
          }
          newConfig.items = nextItems;
        } else {
          if (changes.add && w.type === "inventory_grid") {
            newConfig.contents = [...(newConfig.contents ?? []), { name: changes.add, quantity: 1 }];
          }
          if (changes.remove && w.type === "inventory_grid") {
            newConfig.contents = (newConfig.contents ?? []).filter((c) => c.name !== changes.remove);
          }
        }
        return { ...w, config: newConfig };
      });
      // Persist to server
      const chatId = s.activeSessionChatId;
      if (chatId) debouncedPersistWidgets(chatId, updatedWidgets);
      return { hudWidgets: updatedWidgets };
    }),
  setBlueprint: (bp) => set({ blueprint: bp }),
  reset: () => set(INITIAL_STATE),
}));

// Dev-only: expose the store on `window` so we can inspect NPC asset state
// directly from the browser console:
//   window.__gameStore.getState().npcs
// Vite strips this whole block from production bundles via dead-code
// elimination on `import.meta.env.DEV`.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __gameStore?: typeof useGameModeStore }).__gameStore = useGameModeStore;
}
