// ──────────────────────────────────────────────
// Server-side wiring for shared NPC name utils
// ──────────────────────────────────────────────
//
// Re-exports `npcNameKey`, `isSameNpcName`, `slugifyForFs` from the shared
// package and adds a Node-specific SHA-1 hex helper (`sha1HexLegacy`).
//
// The shared package can't depend on `node:crypto`, but legacy on-disk
// filenames in `/data/avatars/npc/<chatId>/<slug>.png` were generated with
// `crypto.createHash("sha1").digest("hex").slice(0, 10)`. To keep those
// files reachable we pass `sha1HexLegacy` into `slugifyForFs(name, {…})` from
// any server caller doing legacy-compatible lookups.

import { createHash } from "node:crypto";

export { npcNameKey, isSameNpcName, slugifyForFs } from "@marinara-engine/shared";

/** SHA-1 hex digest — used to preserve legacy filename hashes. */
export function sha1HexLegacy(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}
