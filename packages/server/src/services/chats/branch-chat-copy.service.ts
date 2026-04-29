// ──────────────────────────────────────────────
// Service: Copy chat messages + game state snapshots for branch / game fork
// ──────────────────────────────────────────────

import type { DB } from "../../db/connection.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createGameStateStorage } from "../storage/game-state.storage.js";

export type ChatsStorage = ReturnType<typeof createChatsStorage>;

export interface CopyBranchMessagesResult {
  sourceToBranchedMessageId: Map<string, string>;
  /** Old game_state_snapshots.id → new snapshot id (for checkpoint remapping) */
  snapshotIdMap: Map<string, string>;
}

/**
 * Copy messages from sourceChatId into targetChatId (in order), optionally stopping
 * after copying the message with id `upToMessageId` (inclusive).
 * Copies game_state_snapshots re-keyed to new message ids (swipe index 0 on branch).
 */
export async function copyBranchMessagesAndSnapshots(
  db: DB,
  storage: ChatsStorage,
  sourceChatId: string,
  targetChatId: string,
  options: { upToMessageId?: string | null },
): Promise<CopyBranchMessagesResult> {
  const { upToMessageId } = options;
  const msgs = await storage.listMessages(sourceChatId);
  const sourceToBranchedMessageId = new Map<string, string>();
  const snapshotIdMap = new Map<string, string>();

  const gameStateStore = createGameStateStorage(db);

  const copySnapshot = async (
    snapshot: NonNullable<Awaited<ReturnType<typeof gameStateStore.getByMessage>>>,
    targetMessageId: string,
    targetSwipeIndex: number,
  ): Promise<void> => {
    try {
      const oldSnapshotId = snapshot.id as string;
      const overrides =
        snapshot.manualOverrides && typeof snapshot.manualOverrides === "string"
          ? (JSON.parse(snapshot.manualOverrides) as Record<string, string>)
          : null;
      const newId = await gameStateStore.create(
        {
          chatId: targetChatId,
          messageId: targetMessageId,
          swipeIndex: targetSwipeIndex,
          date: (snapshot.date as string) ?? null,
          time: (snapshot.time as string) ?? null,
          location: (snapshot.location as string) ?? null,
          weather: (snapshot.weather as string) ?? null,
          temperature: (snapshot.temperature as string) ?? null,
          presentCharacters:
            typeof snapshot.presentCharacters === "string"
              ? JSON.parse(snapshot.presentCharacters)
              : (snapshot.presentCharacters ?? []),
          recentEvents:
            typeof snapshot.recentEvents === "string"
              ? JSON.parse(snapshot.recentEvents)
              : (snapshot.recentEvents ?? []),
          playerStats:
            snapshot.playerStats == null
              ? null
              : typeof snapshot.playerStats === "string"
                ? JSON.parse(snapshot.playerStats)
                : snapshot.playerStats,
          personaStats:
            snapshot.personaStats == null
              ? null
              : typeof snapshot.personaStats === "string"
                ? JSON.parse(snapshot.personaStats)
                : snapshot.personaStats,
          committed: (snapshot.committed as unknown) === 1,
        } as Parameters<typeof gameStateStore.create>[0],
        overrides,
      );
      snapshotIdMap.set(oldSnapshotId, newId);
    } catch {
      /* ignore individual snapshot copy failures */
    }
  };

  for (const msg of msgs) {
    let content = msg.content;
    if (msg.activeSwipeIndex > 0) {
      const swipes = await storage.getSwipes(msg.id);
      const activeSwipe = swipes.find((s: { index: number }) => s.index === msg.activeSwipeIndex);
      if (activeSwipe) content = activeSwipe.content;
    }

    const created = await storage.createMessage(
      {
        chatId: targetChatId,
        role: msg.role as "user" | "assistant" | "system" | "narrator",
        characterId: msg.characterId,
        content,
      },
      { createdAt: msg.createdAt as string },
    );

    if (created) {
      sourceToBranchedMessageId.set(msg.id, created.id);

      try {
        const extraObj = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
        if (extraObj && typeof extraObj === "object") {
          await storage.updateMessageExtra(created.id, extraObj as Record<string, unknown>);
        }
      } catch {
        /* ignore */
      }
    }

    if (upToMessageId && msg.id === upToMessageId) break;
  }

  if (sourceToBranchedMessageId.size > 0) {
    for (const [srcMsgId, branchedMsgId] of sourceToBranchedMessageId) {
      const srcMsg = msgs.find((m) => m.id === srcMsgId);
      if (!srcMsg) continue;

      const snapshot = await gameStateStore.getByMessage(srcMsgId, srcMsg.activeSwipeIndex);
      if (snapshot) {
        await copySnapshot(snapshot, branchedMsgId, 0);
      }
    }

    const bootstrap = await gameStateStore.getByChatAndMessage(sourceChatId, "", 0);
    if (bootstrap) {
      await copySnapshot(bootstrap, "", 0);
    }
  }

  return { sourceToBranchedMessageId, snapshotIdMap };
}
