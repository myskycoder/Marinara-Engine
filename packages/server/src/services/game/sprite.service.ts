import { readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { DATA_DIR } from "../../utils/data-dir.js";

const SPRITE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
const AUTOMATIC_FULL_BODY_POSES = new Set([
  "idle",
  "walk",
  "run",
  "battle_stance",
  "attack",
  "defend",
  "casting",
  "hurt",
  "jump",
  "thinking",
  "cheer",
  "victory",
  "wave",
  "sit",
  "kneel",
  "point",
]);

export interface CharacterSpriteInfo {
  name: string;
  expressions: string[];
  /** Custom full-body aliases the model may intentionally choose. */
  fullBody: string[];
  /** Engine-assigned standard full-body poses; not exposed to the model. */
  automaticFullBody: string[];
}

/**
 * List available sprite expressions for a character by reading their sprites directory.
 * Returns expression names (without extension) split into portrait and full-body.
 */
export function listCharacterSprites(
  characterId: string,
): { expressions: string[]; fullBody: string[]; automaticFullBody: string[] } | null {
  const dir = join(DATA_DIR, "sprites", characterId);
  if (!existsSync(dir)) return null;

  try {
    const files = readdirSync(dir).filter((f) => SPRITE_EXTS.has(extname(f).toLowerCase()));
    const expressions: string[] = [];
    const fullBody: string[] = [];
    const automaticFullBody: string[] = [];

    for (const f of files) {
      const name = f.slice(0, -extname(f).length);
      if (name.startsWith("full_")) {
        const stripped = name.slice(5);
        if (stripped) {
          if (AUTOMATIC_FULL_BODY_POSES.has(stripped.toLowerCase())) {
            automaticFullBody.push(stripped);
          } else {
            fullBody.push(stripped);
          }
        }
      } else {
        expressions.push(name);
      }
    }

    if (expressions.length === 0 && fullBody.length === 0 && automaticFullBody.length === 0) return null;
    return { expressions, fullBody, automaticFullBody };
  } catch {
    return null;
  }
}

/**
 * List sprites for multiple characters, returning a map of name → sprite info.
 */
export function listPartySprites(characters: Array<{ id: string; name: string }>): CharacterSpriteInfo[] {
  const result: CharacterSpriteInfo[] = [];
  for (const char of characters) {
    const sprites = listCharacterSprites(char.id);
    if (sprites) {
      result.push({ name: char.name, ...sprites });
    }
  }
  return result;
}
