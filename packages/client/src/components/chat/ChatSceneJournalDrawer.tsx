// ──────────────────────────────────────────────
// Chat: Scene Painter drawer
// ──────────────────────────────────────────────
import { X } from "lucide-react";
import type { Chat } from "@marinara-engine/shared";
import { ChatSceneJournal } from "./ChatSceneJournal";

interface ChatSceneJournalDrawerProps {
  chat: Chat;
  open: boolean;
  onClose: () => void;
  onPaintScene?: () => void;
}

export function ChatSceneJournalDrawer({ chat, open, onClose, onPaintScene }: ChatSceneJournalDrawerProps) {
  if (!open) return null;

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      <div className="absolute right-0 top-0 z-50 flex h-full w-80 max-md:w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl animate-fade-in-up max-md:pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-bold">Scene descriptions</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ChatSceneJournal chatId={chat.id} open={open} onPaintScene={onPaintScene} />
        </div>
      </div>
    </>
  );
}
