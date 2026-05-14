// ──────────────────────────────────────────────
// AI Audit — Runtime Settings (cached)
// ──────────────────────────────────────────────
// Settings live in the `app_settings` key/value table under the
// `ai_audit_settings` JSON key. We cache reads for a few seconds so the
// hot LLM path does not hit the DB on every call.
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getDB } from "../../db/connection.js";
import { appSettings } from "../../db/schema/index.js";
import { now } from "../../utils/id-generator.js";

export const AI_AUDIT_SETTINGS_KEY = "ai_audit_settings";

export interface AiAuditSettings {
  enabled: boolean;
  maxEntries: number;
  /** Per-record cap for request_payload + response_payload (each), bytes. */
  maxRecordSize: number;
  retentionDays: number;
  logRequestBody: boolean;
  logResponseBody: boolean;
}

export const AI_AUDIT_DEFAULT_SETTINGS: AiAuditSettings = {
  enabled: true,
  maxEntries: 1000,
  maxRecordSize: 262_144,
  retentionDays: 14,
  logRequestBody: true,
  logResponseBody: true,
};

const CACHE_TTL_MS = 5_000;

let cachedSettings: AiAuditSettings | null = null;
let cachedAt = 0;

function coerceSettings(raw: unknown): AiAuditSettings {
  if (!raw || typeof raw !== "object") return AI_AUDIT_DEFAULT_SETTINGS;
  const obj = raw as Record<string, unknown>;
  const num = (value: unknown, fallback: number, min: number, max: number) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  };
  const bool = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  };
  return {
    enabled: bool(obj.enabled, AI_AUDIT_DEFAULT_SETTINGS.enabled),
    maxEntries: num(obj.maxEntries, AI_AUDIT_DEFAULT_SETTINGS.maxEntries, 0, 1_000_000),
    maxRecordSize: num(obj.maxRecordSize, AI_AUDIT_DEFAULT_SETTINGS.maxRecordSize, 0, 50 * 1024 * 1024),
    retentionDays: num(obj.retentionDays, AI_AUDIT_DEFAULT_SETTINGS.retentionDays, 0, 3650),
    logRequestBody: bool(obj.logRequestBody, AI_AUDIT_DEFAULT_SETTINGS.logRequestBody),
    logResponseBody: bool(obj.logResponseBody, AI_AUDIT_DEFAULT_SETTINGS.logResponseBody),
  };
}

export function invalidateAiAuditSettingsCache() {
  cachedSettings = null;
  cachedAt = 0;
}

export async function readAiAuditSettings(): Promise<AiAuditSettings> {
  const nowMs = Date.now();
  if (cachedSettings && nowMs - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  try {
    const db = await getDB();
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, AI_AUDIT_SETTINGS_KEY));
    const value = rows[0]?.value;
    let parsed: unknown = null;
    if (typeof value === "string" && value.length > 0) {
      try {
        parsed = JSON.parse(value);
      } catch (err) {
        logger.warn(err, "[ai-audit] Failed to parse ai_audit_settings JSON; using defaults");
      }
    }
    cachedSettings = parsed ? coerceSettings(parsed) : AI_AUDIT_DEFAULT_SETTINGS;
    cachedAt = nowMs;
    return cachedSettings;
  } catch (err) {
    logger.warn(err, "[ai-audit] Failed to load settings; using defaults");
    return AI_AUDIT_DEFAULT_SETTINGS;
  }
}

export async function writeAiAuditSettings(input: Partial<AiAuditSettings>): Promise<AiAuditSettings> {
  const current = await readAiAuditSettings();
  const merged = coerceSettings({ ...current, ...input });
  const db = await getDB();
  const value = JSON.stringify(merged);
  const timestamp = now();
  const existing = await db.select().from(appSettings).where(eq(appSettings.key, AI_AUDIT_SETTINGS_KEY));
  if (existing.length > 0) {
    await db.update(appSettings).set({ value, updatedAt: timestamp }).where(eq(appSettings.key, AI_AUDIT_SETTINGS_KEY));
  } else {
    await db.insert(appSettings).values({ key: AI_AUDIT_SETTINGS_KEY, value, updatedAt: timestamp });
  }
  invalidateAiAuditSettingsCache();
  cachedSettings = merged;
  cachedAt = Date.now();
  return merged;
}
