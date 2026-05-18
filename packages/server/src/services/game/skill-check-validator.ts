// ──────────────────────────────────────────────
// Service: Skill Check Validator
// ──────────────────────────────────────────────
// Walks an assistant message looking for `[skill_check: ...]` tags and
// enforces server-side honesty:
//
//   • sparse tags (no `result=`) are resolved with the server RNG using the
//     player's actual skill+attribute modifiers from the character sheet, the
//     same as the legacy /game/skill-check endpoint.
//   • fully-resolved tags (with `result=`) are validated against the player's
//     real modifiers, the rolls/modifier arithmetic, and the DC-vs-total
//     outcome. Any mismatch triggers a server reroll (preserving the player's
//     d20 if the model recorded one) and the tag in the narration is rewritten
//     so the persisted message reflects the canonical roll.
//
// Returns a per-tag report describing what was kept and what was corrected,
// suitable for attaching to the AI audit metadata of the originating turn.
import { getSkillCheckOutcomeKey, serializeResolvedSkillCheckTag } from "@marinara-engine/shared";

import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { recordAiRequest } from "../ai-audit/audit-logger.js";
import { getAiAuditContext } from "../ai-audit/audit-context.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createGameStateStorage } from "../storage/game-state.storage.js";
import {
  attributeModifier,
  getGoverningAttribute,
  mapSheetAttributesToRPG,
  resolveSkillCheck,
  type SkillCheckResult,
} from "./skill-check.service.js";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type SkillCheckValidationStatus =
  | "kept"
  | "resolved_sparse"
  | "corrected_arithmetic"
  | "corrected_outcome"
  | "corrected_modifier"
  | "unparseable";

export interface SkillCheckValidationEntry {
  skill: string;
  dc: number;
  status: SkillCheckValidationStatus;
  originalTotal?: number;
  expectedTotal?: number;
  originalModifier?: number;
  expectedModifier?: number;
  originalResult?: string;
  expectedResult?: string;
  /** The tag body actually written to the message after validation. */
  resultTag?: string;
}

export interface PlayerModifierLookup {
  skill: string;
  governingAttribute: string;
  skillModifier: number;
  attributeModifier: number;
  attrScore: number | null;
}

interface ParsedTagFull {
  kind: "resolved";
  skill: string;
  dc: number;
  rolls: number[];
  usedRoll: number;
  modifier: number;
  total: number;
  resultKey: string;
  rollMode: "normal" | "advantage" | "disadvantage";
  preRolledD20: number | null;
  advantage: boolean;
  disadvantage: boolean;
}

interface ParsedTagSparse {
  kind: "sparse";
  skill: string;
  dc: number;
  advantage: boolean;
  disadvantage: boolean;
  preRolledD20: number | null;
}

type ParsedTag = ParsedTagFull | ParsedTagSparse | null;

// ──────────────────────────────────────────────
// Local meta parser (mirrors the inline one in game.routes.ts)
// ──────────────────────────────────────────────

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      logger.warn(err, "[skill-check-validator] Failed to parse chat metadata, returning empty object");
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

// ──────────────────────────────────────────────
// Tag parsing
// ──────────────────────────────────────────────

const SKILL_CHECK_TAG_RE = /\[skill_check:\s*([^\]]+)\]/gi;

function parseAttributes(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of body.matchAll(/(\w+)=("[^"]*"|'[^']*'|[^\s\]]+)/g)) {
    const key = match[1]?.trim().toLowerCase();
    const raw = match[2]?.trim();
    if (!key || raw == null) continue;
    out.set(key, raw.replace(/^['"]|['"]$/g, ""));
  }
  return out;
}

function parseRollsList(raw: string): number[] {
  return raw
    .split(/[|,;\s]+/)
    .map((piece) => Number.parseInt(piece, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 20);
}

function normalizeOutcomeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseSkillCheckTagBody(body: string): ParsedTag {
  const values = parseAttributes(body);
  const skill = values.get("skill")?.trim() ?? "";
  const dc = Number.parseInt(values.get("dc") ?? "", 10);
  if (!skill || !Number.isFinite(dc)) return null;

  const modeValue = values.get("mode")?.trim().toLowerCase();
  const rawLower = body.toLowerCase();
  const advantage = modeValue === "advantage" || rawLower.includes(" advantage");
  const disadvantage = modeValue === "disadvantage" || rawLower.includes(" disadvantage");

  const rollsRaw = values.get("rolls");
  const modifierRaw = values.get("modifier");
  const totalRaw = values.get("total");
  const resultRaw = values.get("result");

  const modifierNum = Number.parseInt(modifierRaw ?? "", 10);
  const totalNum = Number.parseInt(totalRaw ?? "", 10);

  // Sparse: any of the four canonicalising fields missing/unparseable.
  if (!rollsRaw || !Number.isFinite(modifierNum) || !Number.isFinite(totalNum) || !resultRaw) {
    let preRolled: number | null = null;
    if (rollsRaw) {
      const trimmed = rollsRaw.trim();
      if (/^-?\d+$/.test(trimmed)) {
        const n = Number.parseInt(trimmed, 10);
        if (Number.isInteger(n) && n >= 1 && n <= 20) preRolled = n;
      }
    }
    return {
      kind: "sparse",
      skill,
      dc,
      advantage,
      disadvantage,
      preRolledD20: preRolled,
    };
  }

  const rolls = parseRollsList(rollsRaw);
  if (rolls.length === 0) {
    return {
      kind: "sparse",
      skill,
      dc,
      advantage,
      disadvantage,
      preRolledD20: null,
    };
  }

  const explicitUsedRaw = values.get("used");
  const explicitUsed = explicitUsedRaw != null ? Number.parseInt(explicitUsedRaw, 10) : Number.NaN;
  const rollMode: ParsedTagFull["rollMode"] = advantage ? "advantage" : disadvantage ? "disadvantage" : "normal";
  const inferredUsedFromTotal = totalNum - modifierNum;
  const usedRoll = Number.isFinite(explicitUsed)
    ? explicitUsed
    : rolls.includes(inferredUsedFromTotal)
      ? inferredUsedFromTotal
      : rollMode === "advantage"
        ? Math.max(...rolls)
        : rollMode === "disadvantage"
          ? Math.min(...rolls)
          : rolls[0]!;

  const preRolled = rolls.length === 1 ? rolls[0]! : null;

  return {
    kind: "resolved",
    skill,
    dc,
    rolls,
    usedRoll,
    modifier: modifierNum,
    total: totalNum,
    resultKey: normalizeOutcomeKey(resultRaw),
    rollMode,
    preRolledD20: preRolled,
    advantage,
    disadvantage,
  };
}

// ──────────────────────────────────────────────
// Player modifier lookup
// ──────────────────────────────────────────────

/**
 * Look up the player's `(skillModifier, attributeModifier)` for a given skill
 * by reading the latest game-state snapshot and falling back to the player's
 * character-sheet rpgStats if the snapshot has no per-attribute data.
 *
 * Mirrors the lookup previously done inline in the `/game/skill-check` route.
 */
export async function lookupPlayerModifiers(
  db: DB,
  chatId: string,
  skill: string,
): Promise<PlayerModifierLookup> {
  const stateStore = createGameStateStorage(db);
  const snapshot = await stateStore.getLatest(chatId);
  const playerStats =
    snapshot?.playerStats && typeof snapshot.playerStats === "string"
      ? (JSON.parse(snapshot.playerStats) as Record<string, unknown>)
      : (snapshot?.playerStats as Record<string, unknown> | null | undefined) ?? null;

  const skillsTable = (playerStats?.skills as Record<string, number> | undefined) ?? {};
  const skillModifier = Number(skillsTable[skill] ?? skillsTable[skill.toLowerCase()] ?? 0) || 0;

  const governingAttribute = getGoverningAttribute(skill);
  let attrScore: number | null = null;
  const attributes = playerStats?.attributes as Record<string, unknown> | undefined;
  if (attributes && Number.isFinite(Number(attributes[governingAttribute]))) {
    attrScore = Number(attributes[governingAttribute]);
  } else {
    const chats = createChatsStorage(db);
    const chat = await chats.getById(chatId);
    const meta = chat ? parseMeta(chat.metadata) : {};
    const cards = Array.isArray(meta.gameCharacterCards)
      ? (meta.gameCharacterCards as Array<Record<string, unknown>>)
      : [];
    const playerCard = cards[0];
    const rpgStats = playerCard?.rpgStats as { attributes?: Array<{ name: string; value: number }> } | undefined;
    const mapped = mapSheetAttributesToRPG(rpgStats?.attributes);
    if (mapped[governingAttribute] != null) attrScore = mapped[governingAttribute]!;
  }

  const attrMod = attrScore != null ? attributeModifier(attrScore) : 0;

  return {
    skill,
    governingAttribute,
    skillModifier,
    attributeModifier: attrMod,
    attrScore,
  };
}

// ──────────────────────────────────────────────
// Validation core
// ──────────────────────────────────────────────

interface ValidateOptions {
  /** When set, only the first tag matching this `(skill, dc)` is processed. */
  matchSkill?: string;
  matchDc?: number;
  /** When the caller knows the player already pre-rolled a d20 (e.g. from a sparse tag with a single roll), feed it in. */
  preRolledD20?: number;
  /** Force a specific advantage/disadvantage regardless of what the tag says. */
  forceAdvantage?: boolean;
  forceDisadvantage?: boolean;
}

interface ProcessTagResult {
  replacement: string;
  entry: SkillCheckValidationEntry;
  resolved: SkillCheckResult | null;
}

function describeResolved(result: SkillCheckResult): string {
  return `[${result.skill} DC ${result.dc}] rolls=${result.rolls.join("|")} used=${result.usedRoll} mod=${result.modifier} total=${result.total} → ${getSkillCheckOutcomeKey(result)}`;
}

async function processTag(
  fullTag: string,
  body: string,
  db: DB,
  chatId: string,
  opts: ValidateOptions,
): Promise<ProcessTagResult | null> {
  const parsed = parseSkillCheckTagBody(body);
  if (!parsed) {
    return {
      replacement: fullTag,
      entry: { skill: "", dc: 0, status: "unparseable" },
      resolved: null,
    };
  }

  if (opts.matchSkill != null) {
    if (parsed.skill.trim().toLowerCase() !== opts.matchSkill.trim().toLowerCase()) return null;
  }
  if (opts.matchDc != null) {
    if (parsed.dc !== opts.matchDc) return null;
  }

  const lookup = await lookupPlayerModifiers(db, chatId, parsed.skill);
  const expectedModifier = lookup.skillModifier + lookup.attributeModifier;

  // Helper: roll with the server using the player's real modifiers, preserving
  // any model-supplied d20 if it falls in the legal 1-20 range.
  const serverRoll = (preRolled?: number | null, advantage?: boolean, disadvantage?: boolean): SkillCheckResult =>
    resolveSkillCheck({
      skill: parsed.skill,
      dc: parsed.dc,
      skillModifier: lookup.skillModifier,
      attributeModifier: lookup.attributeModifier,
      advantage: opts.forceAdvantage ?? advantage,
      disadvantage: opts.forceDisadvantage ?? disadvantage,
      preRolledD20: opts.preRolledD20 ?? preRolled ?? undefined,
    });

  if (parsed.kind === "sparse") {
    const result = serverRoll(parsed.preRolledD20, parsed.advantage, parsed.disadvantage);
    const replacement = serializeResolvedSkillCheckTag(result);
    return {
      replacement,
      entry: {
        skill: parsed.skill,
        dc: parsed.dc,
        status: "resolved_sparse",
        expectedModifier,
        expectedTotal: result.total,
        expectedResult: getSkillCheckOutcomeKey(result),
        resultTag: replacement,
      },
      resolved: result,
    };
  }

  // Fully-resolved tag — validate three things:
  //   1) modifier matches the player's actual sheet
  //   2) usedRoll + modifier === total (arithmetic)
  //   3) outcome matches DC/total + crit rules
  const expectedOutcomeFromText =
    parsed.usedRoll === 20
      ? "critical_success"
      : parsed.usedRoll === 1
        ? "critical_failure"
        : parsed.total >= parsed.dc
          ? "success"
          : "failure";

  if (parsed.modifier !== expectedModifier) {
    const result = serverRoll(parsed.preRolledD20, parsed.advantage, parsed.disadvantage);
    const replacement = serializeResolvedSkillCheckTag(result);
    return {
      replacement,
      entry: {
        skill: parsed.skill,
        dc: parsed.dc,
        status: "corrected_modifier",
        originalModifier: parsed.modifier,
        expectedModifier,
        originalTotal: parsed.total,
        expectedTotal: result.total,
        originalResult: parsed.resultKey,
        expectedResult: getSkillCheckOutcomeKey(result),
        resultTag: replacement,
      },
      resolved: result,
    };
  }

  if (parsed.usedRoll + parsed.modifier !== parsed.total) {
    const result = serverRoll(parsed.preRolledD20, parsed.advantage, parsed.disadvantage);
    const replacement = serializeResolvedSkillCheckTag(result);
    return {
      replacement,
      entry: {
        skill: parsed.skill,
        dc: parsed.dc,
        status: "corrected_arithmetic",
        originalTotal: parsed.total,
        expectedTotal: result.total,
        originalModifier: parsed.modifier,
        expectedModifier,
        originalResult: parsed.resultKey,
        expectedResult: getSkillCheckOutcomeKey(result),
        resultTag: replacement,
      },
      resolved: result,
    };
  }

  if (parsed.resultKey !== expectedOutcomeFromText) {
    const result = serverRoll(parsed.preRolledD20, parsed.advantage, parsed.disadvantage);
    const replacement = serializeResolvedSkillCheckTag(result);
    return {
      replacement,
      entry: {
        skill: parsed.skill,
        dc: parsed.dc,
        status: "corrected_outcome",
        originalTotal: parsed.total,
        expectedTotal: result.total,
        originalModifier: parsed.modifier,
        expectedModifier,
        originalResult: parsed.resultKey,
        expectedResult: getSkillCheckOutcomeKey(result),
        resultTag: replacement,
      },
      resolved: result,
    };
  }

  // Tag is internally consistent and the modifier matches the sheet — keep it.
  return {
    replacement: fullTag,
    entry: {
      skill: parsed.skill,
      dc: parsed.dc,
      status: "kept",
      originalTotal: parsed.total,
      originalModifier: parsed.modifier,
      expectedModifier,
      originalResult: parsed.resultKey,
      expectedResult: parsed.resultKey,
      resultTag: fullTag,
    },
    resolved: null,
  };
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export interface ValidateOrResolveOptions extends ValidateOptions {
  /** When true, only the first matching tag is replaced — useful for the
   *  legacy /game/skill-check endpoint where the client targets one tag. */
  firstMatchOnly?: boolean;
  /** Optional message id to include in the audit trail. */
  messageId?: string | null;
  /** When true, write a `recordAiRequest` audit row describing corrections.
   *  Defaults to true for the generate.routes hook. */
  recordAudit?: boolean;
}

export interface ValidateOrResolveResult {
  content: string;
  report: SkillCheckValidationEntry[];
  /** Most recently resolved server-side roll, if any (used by /skill-check
   *  endpoint to return the SkillCheckResult to the client). */
  lastResolved: SkillCheckResult | null;
}

/**
 * Walk an assistant message, rewriting any `[skill_check: ...]` tags that
 * either omit canonical fields (sparse → server rolls) or contain numbers
 * that disagree with the player's sheet, the arithmetic, or the DC-vs-total
 * outcome (resolved → server rerolls and replaces the tag).
 *
 * Emits a synthetic AI audit row (`provider: "skill_check_validator"`) only
 * when at least one tag actually triggered correction; pure "kept" runs are
 * silent to keep the audit log focused on anomalies.
 */
export async function validateOrResolveSkillCheckTags(
  content: string,
  chatId: string,
  db: DB,
  options: ValidateOrResolveOptions = {},
): Promise<ValidateOrResolveResult> {
  if (!content || content.indexOf("[skill_check:") === -1) {
    return { content, report: [], lastResolved: null };
  }

  const report: SkillCheckValidationEntry[] = [];
  let lastResolved: SkillCheckResult | null = null;
  let outContent = "";
  let cursor = 0;
  let consumed = false;
  SKILL_CHECK_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_CHECK_TAG_RE.exec(content)) !== null) {
    const fullTag = match[0]!;
    const body = match[1]!;
    const matchStart = match.index;
    outContent += content.slice(cursor, matchStart);
    cursor = matchStart + fullTag.length;

    if (options.firstMatchOnly && consumed) {
      outContent += fullTag;
      continue;
    }

    try {
      const processed = await processTag(fullTag, body, db, chatId, options);
      if (processed == null) {
        outContent += fullTag;
        continue;
      }
      outContent += processed.replacement;
      report.push(processed.entry);
      if (processed.resolved) lastResolved = processed.resolved;
      if (
        processed.entry.status !== "kept" &&
        processed.entry.status !== "unparseable" &&
        processed.entry.status !== "resolved_sparse"
      ) {
        logger.info(
          "[skill-check-validator] corrected %s (chat=%s, msg=%s): %s",
          processed.entry.status,
          chatId,
          options.messageId ?? "?",
          processed.resolved ? describeResolved(processed.resolved) : "(no result)",
        );
      }
      if (processed.entry.status !== "kept") consumed = true;
    } catch (err) {
      logger.warn(err, "[skill-check-validator] Failed to process skill_check tag");
      outContent += fullTag;
      report.push({ skill: "", dc: 0, status: "unparseable" });
    }
  }
  outContent += content.slice(cursor);

  const shouldAudit =
    (options.recordAudit ?? true) &&
    report.some((entry) => entry.status !== "kept" && entry.status !== "unparseable");
  if (shouldAudit) {
    const ctx = getAiAuditContext();
    recordAiRequest({
      kind: "chat",
      source: ctx?.source ?? "main_generate",
      provider: "skill_check_validator",
      model: "",
      status: "ok",
      durationMs: 0,
      chatId,
      messageId: options.messageId ?? null,
      metadata: {
        skillCheckValidation: report,
      },
    });
  }

  return { content: outContent, report, lastResolved };
}
