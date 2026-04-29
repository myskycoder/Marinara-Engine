// ──────────────────────────────────────────────
// Game: fork timeline — new game from message cutoff + related branches list
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GitBranch, Loader2 } from "lucide-react";
import type { Message } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";
import { useForkGameTimeline, useRelatedGameTimelines } from "../../hooks/use-game";
import { useChatStore } from "../../stores/chat.store";
import { cn } from "../../lib/utils";

function messagePreview(m: Message): string {
  const raw = (m.content ?? "").replace(/\s+/g, " ").trim();
  const clip = raw.length > 72 ? `${raw.slice(0, 72)}…` : raw;
  return `${m.role}: ${clip || "(empty)"}`;
}

export interface GameForkTimelineModalProps {
  open: boolean;
  onClose: () => void;
  chatId: string;
  /** Current game's `gameId` (for related timelines query) */
  lineageRootGameId: string | null;
  messages: Message[];
}

export function GameForkTimelineModal({
  open,
  onClose,
  chatId,
  lineageRootGameId,
  messages,
}: GameForkTimelineModalProps) {
  const fork = useForkGameTimeline();
  const related = useRelatedGameTimelines(lineageRootGameId);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);

  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  const [upToMessageId, setUpToMessageId] = useState("");
  const [name, setName] = useState("");
  const [forkLabel, setForkLabel] = useState("");

  useEffect(() => {
    if (open && ordered.length > 0) {
      setUpToMessageId((prev) => (prev && ordered.some((m) => m.id === prev) ? prev : ordered[0]!.id));
    }
  }, [open, ordered]);

  const handleFork = () => {
    if (!upToMessageId) {
      toast.error("Pick a message to fork up to");
      return;
    }
    fork.mutate(
      { chatId, upToMessageId, name: name.trim() || undefined, forkLabel: forkLabel.trim() || undefined },
      {
        onSuccess: (newChat) => {
          toast.success("Timeline fork created");
          setActiveChatId(newChat.id);
          onClose();
        },
        onError: () => toast.error("Failed to fork timeline"),
      },
    );
  };

  const openBranch = (id: string) => {
    setActiveChatId(id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Fork timeline" width="max-w-lg">
      <div className="flex max-h-[min(70vh,520px)] flex-col gap-4 overflow-y-auto p-1">
        <p className="text-sm text-[var(--muted-foreground)]">
          Creates a <strong>new game</strong> with a copy of this chat up to the selected message. The LLM will not
          see anything after that point. Party / combat sub-chats are cleared on the fork.
        </p>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Include messages through</label>
          <select
            className={cn(
              "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-2 text-sm",
              "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            )}
            value={upToMessageId}
            onChange={(e) => setUpToMessageId(e.target.value)}
          >
            {ordered.map((m) => (
              <option key={m.id} value={m.id}>
                {messagePreview(m)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">New chat name (optional)</label>
            <input
              className={cn(
                "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm",
                "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              )}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to “(fork)” suffix"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">Branch label (optional)</label>
            <input
              className={cn(
                "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm",
                "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              )}
              value={forkLabel}
              onChange={(e) => setForkLabel(e.target.value)}
              placeholder="e.g. spared the merchant"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={fork.isPending || !upToMessageId}
          onClick={() => handleFork()}
          className="flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {fork.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          Fork here
        </button>

        {lineageRootGameId ? (
          <div className="border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Related timelines
            </div>
            {related.isLoading ? (
              <div className="flex justify-center py-4 text-[var(--muted-foreground)]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !related.data?.timelines?.length ? (
              <p className="text-xs text-[var(--muted-foreground)]">No other branches yet.</p>
            ) : (
              <ul className="space-y-1">
                {related.data.timelines.map((row) => (
                  <li key={row.chatId}>
                    <button
                      type="button"
                      onClick={() => openBranch(row.chatId)}
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                        row.chatId === chatId
                          ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                          : "hover:bg-[var(--muted)]/50",
                      )}
                    >
                      <div className="font-medium">{row.name}</div>
                      {row.forkLabel ? (
                        <div className="text-xs text-[var(--muted-foreground)]">{row.forkLabel}</div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
