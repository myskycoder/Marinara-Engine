import type { SceneAst } from "@marinara-engine/shared";

const MAX_SNAPSHOTS = 5;

export interface SceneAstSnapshot {
  characterId: string;
  scene: SceneAst;
  capturedAt: number;
}

/** In-memory cross-scene continuity store (Phase 3 stub — per-process). */
const memoryByChat = new Map<string, SceneAstSnapshot[]>();

export function rememberSceneAst(chatId: string, characterId: string, scene: SceneAst): void {
  const list = memoryByChat.get(chatId) ?? [];
  list.unshift({ characterId, scene, capturedAt: Date.now() });
  memoryByChat.set(chatId, list.slice(0, MAX_SNAPSHOTS));
}

export function getRecentSceneAst(chatId: string, characterId: string): SceneAst | null {
  const list = memoryByChat.get(chatId) ?? [];
  return list.find((s) => s.characterId === characterId)?.scene ?? null;
}

export function clearSceneMemory(chatId: string): void {
  memoryByChat.delete(chatId);
}

/** Apply outfit continuity from last snapshot when current AST omits outfit state. */
export function applySceneMemoryContinuity(current: SceneAst, prior: SceneAst | null): SceneAst {
  if (!prior?.characters?.[0]?.outfit) return current;
  const chars = current.characters ?? [];
  const first = chars[0];
  if (!first?.id) return current;
  if (first.outfit) return current;
  const priorOutfit = prior.characters?.[0]?.outfit;
  if (!priorOutfit) return current;
  return {
    ...current,
    characters: [{ ...first, outfit: priorOutfit }, ...chars.slice(1)],
  };
}
