// ──────────────────────────────────────────────
// Strip GM inline tags for server-side LLM context
// (mirrors packages/client stripGmTags / bracket helpers — no client import)
// ──────────────────────────────────────────────

/**
 * Strip any unknown `[word: ...]` tag. Respects quotes and nested `[]`.
 */
function stripUnknownBracketTags(text: string, keep?: (tagName: string) => boolean): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      const tagName = text.slice(i + 1, j);
      if (j > i + 1 && text[j] === ":" && (!keep || !keep(tagName))) {
        let depth = 1;
        let inString: '"' | "'" | null = null;
        let escaped = false;
        let k = j + 1;
        for (; k < text.length; k++) {
          const c = text[k]!;
          if (escaped) {
            escaped = false;
            continue;
          }
          if (c === "\\") {
            escaped = true;
            continue;
          }
          if (inString) {
            if (c === inString) inString = null;
            continue;
          }
          if (c === '"' || c === "'") {
            inString = c;
            continue;
          }
          if (c === "[") depth++;
          else if (c === "]") {
            depth--;
            if (depth === 0) break;
          }
        }
        if (k < text.length) {
          i = k + 1;
          continue;
        }
      }
    }
    out += text[i]!;
    i++;
  }
  return out;
}

/** Remove bracket tags whose body may contain nested `[` / `]`. */
function stripBalancedTag(text: string, tagPrefix: string): string {
  const lower = tagPrefix.toLowerCase();
  let result = text;
  let searchFrom = 0;
  while (true) {
    const idx = result.toLowerCase().indexOf(lower, searchFrom);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < result.length; i++) {
      if (result[i] === "[") depth++;
      else if (result[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      searchFrom = idx + 1;
      continue;
    }
    result = result.slice(0, idx) + result.slice(end + 1);
  }
  return result;
}

/**
 * Remove game GM command tags so narration can be fed to an LLM as context.
 * Aligned with `stripGmTags` in the client game-tag-parser.
 */
export function stripGameInlineTagsForContext(content: string): string {
  let text = content
    .replace(/\[combat_result\][\s\S]*?\[\/combat_result\]/gi, "")
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[status:\s*[^\]]+\]/gi, "")
    .replace(/\[inventory:\s*[^\]]+\]/gi, "")
    .replace(/\[party_add:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "");
  text = stripUnknownBracketTags(text);
  text = stripBalancedTag(text, "[map_update:");
  text = stripBalancedTag(text, "[choices:");
  text = stripBalancedTag(text, "[Note:");
  text = stripBalancedTag(text, "[Book:");
  text = text.replace(/^\s*\]\s*$/gm, "");
  return text.trim();
}
