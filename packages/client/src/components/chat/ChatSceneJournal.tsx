// ──────────────────────────────────────────────
// Chat: Scene Painter journal — literary scene descriptions
// ──────────────────────────────────────────────
import { useState } from "react";
import { Loader2, ScrollText } from "lucide-react";
import { useSceneDescriptions, type SceneDescriptionEntry } from "../../hooks/use-scene-descriptions";
import { Modal } from "../ui/Modal";

interface ChatSceneJournalProps {
  chatId: string;
  open: boolean;
  onPaintScene?: () => void;
}

const DESC_PREVIEW_LEN = 140;
const REASON_PREVIEW_LEN = 90;

function clip(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

function formatWhen(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function ChatSceneJournal({ chatId, open, onPaintScene }: ChatSceneJournalProps) {
  const { data, isLoading, isError } = useSceneDescriptions(chatId, open);
  const [selected, setSelected] = useState<SceneDescriptionEntry | null>(null);

  return (
    <div className="flex flex-col gap-3 p-4">
      {onPaintScene && (
        <button
          type="button"
          onClick={onPaintScene}
          className="flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)]/15 px-4 py-3 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
        >
          <ScrollText size="1rem" />
          Describe current scene
        </button>
      )}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--muted-foreground)]">
          <Loader2 size="1rem" className="animate-spin" />
          Loading descriptions…
        </div>
      )}

      {isError && (
        <p className="text-center text-xs text-red-400/90">Could not load scene descriptions. Try again later.</p>
      )}

      {!isLoading && !isError && (!data || data.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-8 text-[var(--muted-foreground)]">
          <ScrollText size="1.5rem" className="opacity-40" />
          <p className="text-xs">No scene descriptions yet</p>
          <p className="text-[0.625rem] opacity-60">
            Enable the Scene Painter agent for this chat, then generate or use the button above.
          </p>
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((entry) => {
            const reasonShort = entry.reason ? clip(entry.reason, REASON_PREVIEW_LEN) : "";
            const descShort = clip(entry.description, DESC_PREVIEW_LEN);
            const needsModal =
              entry.description.trim().length > DESC_PREVIEW_LEN ||
              (entry.reason && entry.reason.trim().length > REASON_PREVIEW_LEN);

            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-3 text-left text-xs ring-1 ring-[var(--border)]/60 transition-colors hover:bg-[var(--secondary)]/70 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                    <span>{formatWhen(entry.createdAt)}</span>
                    {entry.mood ? (
                      <span className="rounded-md bg-[var(--primary)]/10 px-1.5 py-0.5 text-[var(--primary)]">
                        {entry.mood}
                      </span>
                    ) : null}
                  </div>
                  {entry.reason ? (
                    <p className="mb-1.5 line-clamp-2 text-[0.6875rem] font-medium text-[var(--foreground)]/90">
                      {reasonShort}
                    </p>
                  ) : null}
                  <p className="line-clamp-3 leading-relaxed text-[var(--muted-foreground)]">{descShort}</p>
                  {needsModal ? (
                    <span className="mt-2 inline-block text-[0.625rem] font-medium text-[var(--primary)]">
                      Tap for full text
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? formatWhen(selected.createdAt) : ""}
        width="max-w-4xl"
      >
        {selected ? (
          <div className="flex max-h-[min(78vh,40rem)] flex-col gap-3 overflow-y-auto text-sm">
            {selected.mood ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">Mood:</span> {selected.mood}
              </p>
            ) : null}
            {selected.reason ? (
              <div>
                <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Why
                </p>
                <p className="whitespace-pre-wrap text-[var(--foreground)]/95">{selected.reason}</p>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Description
              </p>
              <p className="whitespace-pre-wrap leading-relaxed text-[var(--muted-foreground)]">{selected.description}</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
