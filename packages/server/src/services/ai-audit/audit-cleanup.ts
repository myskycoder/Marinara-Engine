// ──────────────────────────────────────────────
// AI Audit — Cleanup
// ──────────────────────────────────────────────
// Periodically prunes old audit log rows so the DB does not grow without
// bound. Two strategies are applied together:
//   1. Hard age limit (retentionDays).
//   2. Hard count limit (maxEntries) — keeps most recent rows only.
// Runs on startup and once per hour thereafter.
import { lt, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getDB } from "../../db/connection.js";
import { aiRequestLogs } from "../../db/schema/index.js";
import { readAiAuditSettings } from "./audit-settings.js";

const HOUR_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export async function pruneAiRequestLogs(): Promise<{ deletedByAge: number; deletedByCount: number }> {
  const settings = await readAiAuditSettings();
  if (!settings.enabled) {
    return { deletedByAge: 0, deletedByCount: 0 };
  }

  const db = await getDB();

  let deletedByAge = 0;
  if (settings.retentionDays > 0) {
    const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      const before = await db.select({ c: sql<number>`count(*)` }).from(aiRequestLogs);
      await db.delete(aiRequestLogs).where(lt(aiRequestLogs.createdAt, cutoff));
      const after = await db.select({ c: sql<number>`count(*)` }).from(aiRequestLogs);
      deletedByAge = Math.max(0, Number(before[0]?.c ?? 0) - Number(after[0]?.c ?? 0));
    } catch (err) {
      logger.warn(err, "[ai-audit] Age-based prune failed");
    }
  }

  let deletedByCount = 0;
  if (settings.maxEntries > 0) {
    try {
      const rows = await db
        .select({ id: aiRequestLogs.id, createdAt: aiRequestLogs.createdAt })
        .from(aiRequestLogs);
      if (rows.length > settings.maxEntries) {
        const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const toDelete = sorted.slice(settings.maxEntries);
        for (const row of toDelete) {
          await db.delete(aiRequestLogs).where(sql`id = ${row.id}`);
          deletedByCount += 1;
        }
      }
    } catch (err) {
      logger.warn(err, "[ai-audit] Count-based prune failed");
    }
  }

  if (deletedByAge > 0 || deletedByCount > 0) {
    logger.info(
      "[ai-audit] Pruned %d (age) + %d (count) audit log rows",
      deletedByAge,
      deletedByCount,
    );
  }

  return { deletedByAge, deletedByCount };
}

export function startAiAuditCleanupSchedule(): void {
  if (timer) return;
  void pruneAiRequestLogs().catch((err) => {
    logger.warn(err, "[ai-audit] Initial prune failed");
  });
  timer = setInterval(() => {
    void pruneAiRequestLogs().catch((err) => {
      logger.warn(err, "[ai-audit] Scheduled prune failed");
    });
  }, HOUR_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopAiAuditCleanupSchedule(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
