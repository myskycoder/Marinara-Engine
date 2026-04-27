// ──────────────────────────────────────────────
// NPC avatar resolver
// ──────────────────────────────────────────────
//
// Single resolver that fills in `avatarPath` on every PresentCharacter that
// doesn't already have one. Centralizes the three-phase fallback chain that
// previously lived (duplicated) in `chats.routes.ts` and the character-tracker
// branch of `generate.routes.ts`:
//
//   1. Character cards            → `knownCharacterAvatars` map (Roleplay HUD)
//   2. Materialized Game-mode NPC → `gameNpcs[].avatarUrl` (canonical)
//   3. Legacy filesystem fallback → `<DATA_DIR>/avatars/npc/<chatId>/<slug>.png`
//      for chats that pre-date Auto NPC Materializer.
//
// Mutates `presentChars[i].avatarPath` in place so callers can keep their
// existing wire shapes — both routes feed `presentCharacters` directly into
// the SSE event payload and the game-state row.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GameNpc } from "@marinara-engine/shared";
import { DATA_DIR } from "../../utils/data-dir.js";
import { npcNameKey, sha1HexLegacy, slugifyForFs } from "./npc-name-server.js";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");

/**
 * Loose shape we mutate in place. Both call sites pass arrays of dynamic
 * objects (parsed JSON snapshots from `game_state.presentCharacters` and
 * direct LLM output), so we accept any record-like shape and only require
 * `name` / `avatarPath` access.
 */
type PresentCharLike = { name?: unknown; avatarPath?: unknown } & Record<string, unknown>;

export interface ResolveAvatarsContext {
  chatId: string;
  /**
   * Avatars from character cards (display name → avatar path/URL). Keys are
   * compared via `npcNameKey`, so callers can pass either the original name
   * or any pre-normalized form.
   */
  knownCharacterAvatars?: Map<string, string>;
  /** Materialized Game-mode NPCs from `chat.metadata.gameNpcs`. */
  gameNpcs?: GameNpc[];
}

/**
 * Resolve avatar paths for all `PresentCharacter` entries that don't already
 * have one. Mutates entries in place; entries that already have `avatarPath`
 * set are skipped without re-checks.
 */
export function resolvePresentCharacterAvatars(
  presentChars: PresentCharLike[],
  ctx: ResolveAvatarsContext,
): void {
  const charsNeedingAvatar = presentChars.filter(
    (c) => !c.avatarPath && typeof c.name === "string" && c.name,
  );
  if (charsNeedingAvatar.length === 0) return;

  const knownAvatarByKey = new Map<string, string>();
  if (ctx.knownCharacterAvatars) {
    for (const [name, path] of ctx.knownCharacterAvatars) {
      const key = npcNameKey(name);
      if (key && path) knownAvatarByKey.set(key, path);
    }
  }

  const npcByKey = new Map<string, GameNpc>();
  if (ctx.gameNpcs) {
    for (const npc of ctx.gameNpcs) {
      if (npc?.name) npcByKey.set(npcNameKey(npc.name), npc);
    }
  }

  for (const char of charsNeedingAvatar) {
    const name = char.name as string;
    const key = npcNameKey(name);

    const knownAvatar = knownAvatarByKey.get(key);
    if (knownAvatar) {
      char.avatarPath = knownAvatar;
      continue;
    }

    const matchedNpc = npcByKey.get(key);
    if (matchedNpc?.avatarUrl) {
      char.avatarPath = matchedNpc.avatarUrl;
      continue;
    }

    const slug = slugifyForFs(name, { prefix: "s", hashHex: sha1HexLegacy });
    if (!slug) continue;
    const npcPath = join(NPC_AVATAR_DIR, ctx.chatId, `${slug}.png`);
    if (existsSync(npcPath)) {
      char.avatarPath = `/api/avatars/npc/${ctx.chatId}/${slug}.png`;
    }
  }
}
