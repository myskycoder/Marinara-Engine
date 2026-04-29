// ──────────────────────────────────────────────
// Copy game_checkpoints rows when forking a game chat timeline
// ──────────────────────────────────────────────

import { eq } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { gameCheckpoints } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export async function copyGameCheckpointsForFork(
  db: DB,
  sourceChatId: string,
  targetChatId: string,
  messageIdMap: Map<string, string>,
  snapshotIdMap: Map<string, string>,
): Promise<void> {
  const rows = await db.select().from(gameCheckpoints).where(eq(gameCheckpoints.chatId, sourceChatId));

  for (const row of rows) {
    const newMessageId = messageIdMap.get(row.messageId);
    const newSnapshotId = snapshotIdMap.get(row.snapshotId);
    if (!newMessageId || !newSnapshotId) continue;

    await db.insert(gameCheckpoints).values({
      id: newId(),
      chatId: targetChatId,
      snapshotId: newSnapshotId,
      messageId: newMessageId,
      label: row.label,
      triggerType: row.triggerType as typeof row.triggerType,
      location: row.location,
      gameState: row.gameState,
      weather: row.weather,
      timeOfDay: row.timeOfDay,
      turnNumber: row.turnNumber,
      createdAt: now(),
    });
  }
}
