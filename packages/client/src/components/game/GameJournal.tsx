// ──────────────────────────────────────────────
// Game: Journal Viewer
//
// Browsable auto-journal panel showing
// NPC notes, locations, inventory, and events —
// all assembled from committed snapshots, no LLM.
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  X,
  MapPin,
  Swords,
  ScrollText,
  Package,
  Users,
  PenLine,
  BookOpen,
  RotateCw,
  Trash2,
  Loader2,
  Info,
  Upload,
  Wand2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import { applyInlineMarkdown, renderMarkdownBlocks } from "../../lib/markdown";
import { AnimatedText } from "./AnimatedText";
import { useRegenerateNpcAssets } from "../../hooks/use-game";
import { GameNpcCardPanel } from "./GameNpcCardPanel";
import { GameMediaLightbox } from "./GameMediaLightbox";

import type { GameNpc } from "@marinara-engine/shared";
import { DEFAULT_NPC_SPRITE_EXPRESSIONS } from "@marinara-engine/shared";

interface JournalEntry {
  timestamp: string;
  type: "location" | "npc" | "combat" | "quest" | "item" | "event" | "note";
  title: string;
  content: string;
  readableType?: "note" | "book";
  sourceMessageId?: string;
  sourceSegmentIndex?: number;
}

interface QuestEntry {
  id: string;
  name: string;
  status: "active" | "completed" | "failed";
  description: string;
  objectives: string[];
}

interface Journal {
  entries: JournalEntry[];
  quests: QuestEntry[];
  locations: string[];
  npcLog: Array<{ npcName: string; interactions: string[] }>;
  inventoryLog: Array<{
    item: string;
    action: "acquired" | "used" | "lost" | "removed";
    quantity: number;
    timestamp: string;
  }>;
}

interface GameJournalProps {
  chatId: string;
  npcs?: GameNpc[];
  /** True while auto NPC assets, batch portrait gen, or manual regen is in flight (shows NPC tab + header hint). */
  npcAssetsActivityPending?: boolean;
  /** Character Tracker sprite expressions from chat metadata (falls back to defaults in the regen dialog). */
  npcSpriteExpressions?: string[];
  onClose: () => void;
  onNpcPortraitClick?: (npcName: string) => void;
  onNpcPortraitGenerate?: (npcName: string) => void;
  npcPortraitGenerationEnabled?: boolean;
  generatingNpcPortraitNames?: Set<string>;
  onNpcRemove?: (npcName: string) => Promise<void> | void;
}

type TabId = "all" | "npcs" | "locations" | "inventory" | "library" | "notes";

const TABS: Array<{ id: TabId; label: string; icon: typeof ScrollText }> = [
  { id: "all", label: "Timeline", icon: ScrollText },
  { id: "npcs", label: "NPCs", icon: Users },
  { id: "locations", label: "Map", icon: MapPin },
  { id: "inventory", label: "Items", icon: Package },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "notes", label: "Notes", icon: PenLine },
];

const TYPE_ICONS: Record<string, typeof ScrollText> = {
  location: MapPin,
  combat: Swords,
  quest: ScrollText,
  item: Package,
  npc: Users,
  event: ScrollText,
  note: ScrollText,
};

const TRAILING_REPUTATION_LABEL = /(devoted|allied|friendly|neutral|unfriendly|hostile|enemy)$/i;

function normalizeNpcName(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanNpcDisplayName(value: string): string {
  return value.replace(TRAILING_REPUTATION_LABEL, "").trim() || value;
}

function normalizeNpcEntryTitle(value: string): string {
  const title = value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return normalizeNpcName(cleanNpcDisplayName(title));
}

function dedupeNpcInteractions(interactions: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const interaction of interactions) {
    const trimmed = interaction.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

function pruneJournalNpc(journal: Journal, npcName: string): Journal {
  const target = normalizeNpcName(cleanNpcDisplayName(npcName));
  return {
    ...journal,
    npcLog: journal.npcLog.filter((entry) => normalizeNpcName(cleanNpcDisplayName(entry.npcName)) !== target),
    entries: journal.entries.filter((entry) => {
      if (entry.type !== "npc") return true;
      const title = entry.title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
      return normalizeNpcName(cleanNpcDisplayName(title)) !== target;
    }),
  };
}

function shouldShowNpcDescription(npc: GameNpc): boolean {
  return (npc as GameNpc & { descriptionSource?: string }).descriptionSource === "model" && !!npc.description?.trim();
}

function shouldShowJournalNpc(npc: GameNpc): boolean {
  const source = (npc as GameNpc & { descriptionSource?: string }).descriptionSource;
  const hasReputationChange = Number.isFinite(npc.reputation) && npc.reputation !== 0;
  const hasRelationshipNotes = Array.isArray(npc.notes) && npc.notes.some((note) => !!note.trim());
  return source === "model" || hasReputationChange || hasRelationshipNotes;
}

function isDuplicateInventoryEntry(
  left: { item: string; action: string; quantity: number; timestamp: string },
  right: { item: string; action: string; quantity: number; timestamp: string },
): boolean {
  if (normalizeNpcName(left.item) !== normalizeNpcName(right.item)) return false;
  if (left.action !== right.action || left.quantity !== right.quantity) return false;
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return true;
  return Math.abs(leftTime - rightTime) <= 10_000;
}

function JournalMarkdown({ text, className }: { text: string; className?: string }) {
  const rendered = useMemo(() => renderMarkdownBlocks(text, applyInlineMarkdown, "game-journal"), [text]);
  return <div className={cn("mari-message-content whitespace-pre-wrap", className)}>{rendered}</div>;
}

function dedupeAdjacentInventoryEntries<
  T extends { item: string; action: string; quantity: number; timestamp: string },
>(items: T[]): T[] {
  const deduped: T[] = [];
  for (const item of items) {
    const previous = deduped[deduped.length - 1];
    if (previous && isDuplicateInventoryEntry(previous, item)) continue;
    deduped.push(item);
  }
  return deduped;
}

export function GameJournal({
  chatId,
  npcs,
  npcAssetsActivityPending = false,
  npcSpriteExpressions,
  onClose,
  onNpcPortraitClick,
  onNpcPortraitGenerate,
  npcPortraitGenerationEnabled = false,
  generatingNpcPortraitNames,
  onNpcRemove,
}: GameJournalProps) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [playerNotes, setPlayerNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(true);
  const [removingNpcName, setRemovingNpcName] = useState<string | null>(null);
  const [npcCardNpc, setNpcCardNpc] = useState<GameNpc | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<{ src: string; alt: string } | null>(null);
  const npcCardResolved = useMemo(() => {
    if (!npcCardNpc) return null;
    const fresh = npcs?.find((n) => n.id === npcCardNpc.id);
    return fresh ?? npcCardNpc;
  }, [npcCardNpc, npcs]);
  const npcCardSpriteExpressionLabels = useMemo(
    () => npcSpriteExpressionPool(npcSpriteExpressions),
    [npcSpriteExpressions],
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNotesRef = useRef("");

  useEffect(() => {
    api
      .get<{ journal: Journal; playerNotes?: string }>(`/game/${chatId}/journal`)
      .then((res) => {
        setJournal(res.journal);
        if (res.playerNotes) setPlayerNotes(res.playerNotes);
      })
      .catch(() => {});
  }, [chatId]);

  const saveNotes = useCallback(
    (text: string) => {
      api
        .put(`/game/${chatId}/notes`, { notes: text })
        .then(() => setNotesSaved(true))
        .catch(() => {});
    },
    [chatId],
  );

  const handleNotesChange = useCallback(
    (text: string) => {
      setPlayerNotes(text);
      latestNotesRef.current = text;
      setNotesSaved(false);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveNotes(text), 800);
    },
    [saveNotes],
  );

  // Flush unsaved notes on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        saveNotes(latestNotesRef.current);
      }
    };
  }, [saveNotes]);

  const handleRemoveNpc = useCallback(
    async (npcName: string) => {
      if (!onNpcRemove) return;
      setRemovingNpcName(npcName);
      try {
        await onNpcRemove(npcName);
        setJournal((prev) => (prev ? pruneJournalNpc(prev, npcName) : prev));
      } finally {
        setRemovingNpcName(null);
      }
    },
    [onNpcRemove],
  );

  const journalNpcs = useMemo(() => (npcs ?? []).filter(shouldShowJournalNpc), [npcs]);

  const trackedNpcNames = useMemo(() => {
    const names = new Set<string>();
    for (const npc of journalNpcs) {
      const key = normalizeNpcName(cleanNpcDisplayName(npc.name));
      if (key) names.add(key);
    }
    return names;
  }, [journalNpcs]);

  const visibleEntries = useMemo(
    () =>
      (journal?.entries ?? []).filter(
        (entry) => entry.type !== "npc" || trackedNpcNames.has(normalizeNpcEntryTitle(entry.title)),
      ),
    [journal?.entries, trackedNpcNames],
  );

  if (!journal) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="text-sm text-white/60">Loading journal...</div>
      </div>
    );
  }

  return (
    <>
    <div className="absolute inset-0 z-40 flex flex-col bg-black/85 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-bold text-white/90">📖 Adventure Journal</h2>
          {npcAssetsActivityPending && (
            <span className="flex items-center gap-1 text-[0.625rem] font-medium text-sky-300/90" title="NPC portraits or sprites are still generating">
              <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
              <span className="hidden sm:inline">NPC assets…</span>
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs — horizontally scrollable on mobile */}
      <div className="overflow-x-auto border-b border-white/10 px-4 py-2 scrollbar-hide [-webkit-overflow-scrolling:touch]">
        <div className="flex gap-1 w-max min-w-full">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const showNpcLoader = tab.id === "npcs" && npcAssetsActivityPending;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={showNpcLoader ? "NPC portraits or sprites are still generating" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.625rem] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                    : "text-white/50 hover:bg-white/5 hover:text-white/70",
                )}
              >
                <Icon size={12} />
                {tab.label}
                {showNpcLoader && <Loader2 size={11} className="shrink-0 animate-spin text-sky-300" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "all" && <TimelineView entries={visibleEntries} />}
        {activeTab === "npcs" && (
          <NpcsView
            chatId={chatId}
            npcLog={journal.npcLog}
            npcs={journalNpcs}
            npcSpriteExpressions={npcSpriteExpressions}
            onNpcPortraitClick={onNpcPortraitClick}
            onNpcOpenCard={setNpcCardNpc}
            onPreviewPortrait={(src, alt) => setPortraitPreview({ src, alt })}
            onNpcPortraitGenerate={onNpcPortraitGenerate}
            npcPortraitGenerationEnabled={npcPortraitGenerationEnabled}
            generatingNpcPortraitNames={generatingNpcPortraitNames}
            onNpcRemove={onNpcRemove ? handleRemoveNpc : undefined}
            removingNpcName={removingNpcName}
          />
        )}
        {activeTab === "locations" && <LocationsView locations={journal.locations} />}
        {activeTab === "inventory" && <InventoryView items={journal.inventoryLog} />}
        {activeTab === "library" && <LibraryView entries={visibleEntries.filter((e) => e.type === "note")} />}
        {activeTab === "notes" && <NotesView notes={playerNotes} onChange={handleNotesChange} saved={notesSaved} />}
      </div>
    </div>
    {npcCardResolved && (
      <GameNpcCardPanel
        chatId={chatId}
        npc={npcCardResolved}
        spriteExpressionLabels={npcCardSpriteExpressionLabels}
        onClose={() => setNpcCardNpc(null)}
      />
    )}
    {portraitPreview && (
      <GameMediaLightbox
        src={portraitPreview.src}
        alt={portraitPreview.alt}
        onClose={() => setPortraitPreview(null)}
      />
    )}
    </>
  );
}

function TimelineView({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-center text-xs text-white/40">No journal entries yet.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {[...entries].reverse().map((entry, i) => {
        const Icon = TYPE_ICONS[entry.type] ?? ScrollText;
        return (
          <div key={i} className="flex gap-3 rounded-lg border border-white/5 bg-white/3 px-3 py-2">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Icon size={12} className="text-white/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white/80">{entry.title}</div>
              <AnimatedText html={entry.content} className="mt-0.5 text-[0.625rem] text-white/50" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reputationLabel(rep: number): { text: string; color: string } {
  if (rep >= 50) return { text: "Allied", color: "text-emerald-400" };
  if (rep >= 20) return { text: "Friendly", color: "text-green-400" };
  if (rep >= -20) return { text: "Neutral", color: "text-gray-400" };
  if (rep >= -50) return { text: "Hostile", color: "text-orange-400" };
  return { text: "Enemy", color: "text-red-400" };
}

function sanitizeSpriteExpressionKey(expression: string): string {
  return expression
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Deduped pool: chat tracker list first, then defaults for any missing labels. */
function npcSpriteExpressionPool(meta?: string[]): string[] {
  const primary = meta && meta.length > 0 ? meta : [...DEFAULT_NPC_SPRITE_EXPRESSIONS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of primary) {
    const key = sanitizeSpriteExpressionKey(e);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (meta && meta.length > 0) {
    for (const e of DEFAULT_NPC_SPRITE_EXPRESSIONS) {
      const key = sanitizeSpriteExpressionKey(e);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function NpcsView({
  chatId,
  npcLog,
  npcs,
  npcSpriteExpressions,
  onNpcPortraitClick,
  onNpcOpenCard,
  onPreviewPortrait,
  onNpcPortraitGenerate,
  npcPortraitGenerationEnabled,
  generatingNpcPortraitNames,
  onNpcRemove,
  removingNpcName,
}: {
  chatId: string;
  npcLog: Array<{ npcName: string; interactions: string[] }>;
  npcs?: GameNpc[];
  npcSpriteExpressions?: string[];
  onNpcPortraitClick?: (npcName: string) => void;
  onNpcOpenCard?: (npc: GameNpc) => void;
  onPreviewPortrait?: (src: string, alt: string) => void;
  onNpcPortraitGenerate?: (npcName: string) => void;
  npcPortraitGenerationEnabled?: boolean;
  generatingNpcPortraitNames?: Set<string>;
  onNpcRemove?: (npcName: string) => void;
  removingNpcName?: string | null;
}) {
  const regenerate = useRegenerateNpcAssets();
  const expressionPool = useMemo(() => npcSpriteExpressionPool(npcSpriteExpressions), [npcSpriteExpressions]);
  const [regenNpc, setRegenNpc] = useState<GameNpc | null>(null);
  const [regenExpressions, setRegenExpressions] = useState<string[]>([]);
  const [regenFullBodyExpr, setRegenFullBodyExpr] = useState("");
  const [regenAppearance, setRegenAppearance] = useState("");

  const openRegenDialog = useCallback(
    (npc: GameNpc) => {
      setRegenNpc(npc);
      setRegenFullBodyExpr("");
      setRegenAppearance(npc.description?.trim() || "");
      const pool = npcSpriteExpressionPool(npcSpriteExpressions);
      setRegenExpressions(pool.slice(0, Math.min(6, pool.length)));
    },
    [npcSpriteExpressions],
  );

  useEffect(() => {
    setRegenFullBodyExpr((prev) => (prev && !regenExpressions.includes(prev) ? "" : prev));
  }, [regenExpressions]);

  const toggleRegenExpression = useCallback((expr: string) => {
    setRegenExpressions((sel) => {
      const i = sel.indexOf(expr);
      if (i >= 0) return sel.filter((x) => x !== expr);
      if (sel.length >= 6) {
        toast.error("Не больше 6 выражений");
        return sel;
      }
      return [...sel, expr];
    });
  }, []);

  const trackedNpcs = npcs ?? [];
  const hasContent = trackedNpcs.length > 0;

  if (!hasContent) {
    return <div className="text-center text-xs text-white/40">No NPCs encountered yet.</div>;
  }

  const npcMap = new Map<string, { npc: GameNpc; interactions: string[]; displayName: string; originalName: string }>();
  for (const n of trackedNpcs) {
    const displayName = cleanNpcDisplayName(n.name);
    const key = normalizeNpcName(displayName);
    if (!key) continue;
    npcMap.set(key, { npc: n, interactions: [], displayName, originalName: n.name });
  }
  for (const entry of npcLog) {
    const displayName = cleanNpcDisplayName(entry.npcName);
    const key = normalizeNpcName(displayName);
    if (!key) continue;
    const existing = npcMap.get(key);
    const interactions = dedupeNpcInteractions(entry.interactions);
    if (existing) {
      existing.interactions = dedupeNpcInteractions([...existing.interactions, ...interactions]);
    }
  }
  const entries = [...npcMap.values()].sort((left, right) => {
    const repDelta = Math.abs(right.npc.reputation) - Math.abs(left.npc.reputation);
    if (repDelta !== 0) return repDelta;
    return left.displayName.localeCompare(right.displayName);
  });

  // Track which NPC's regen button is currently busy so we can show a spinner
  // even while the upstream `regenerate` mutation is shared across all rows.
  const busyNpcId = regenerate.isPending ? regenerate.variables?.npcId : null;
  const regenBusy = Boolean(
    regenerate.isPending && regenNpc !== null && regenerate.variables?.npcId === regenNpc.id,
  );

  return (
    <div className="flex flex-col gap-2">
      {regenNpc ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => !regenBusy && setRegenNpc(null)}
        >
          <div
            role="dialog"
            aria-labelledby="npc-regen-title"
            className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="npc-regen-title" className="mb-3 text-sm font-semibold text-white/90">
              Регенерация: {regenNpc.emoji ? `${regenNpc.emoji} ` : ""}
              {regenNpc.name}
            </h3>
            <div className="mb-3">
              <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                Выражения (до 6)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {expressionPool.map((expr) => {
                  const on = regenExpressions.includes(expr);
                  return (
                    <button
                      key={expr}
                      type="button"
                      disabled={regenBusy}
                      onClick={() => toggleRegenExpression(expr)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[0.65rem] font-medium transition-colors",
                        on
                          ? "border-sky-500/50 bg-sky-500/15 text-sky-100"
                          : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/10",
                      )}
                    >
                      {expr}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-3">
              <label className="block">
                <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                  Выражение для full-body (full_idle)
                </span>
                <select
                  value={regenFullBodyExpr}
                  onChange={(e) => setRegenFullBodyExpr(e.target.value)}
                  disabled={regenBusy || regenExpressions.length === 0}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[0.7rem] text-white/80 outline-none focus:border-sky-500/40"
                >
                  <option value="">Авто — neutral, если есть в списке, иначе первое выбранное</option>
                  {regenExpressions.map((ex) => (
                    <option key={ex} value={ex}>
                      {ex}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mb-3 block">
              <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                Описание внешности (только персонаж; стиль и имя добавит сервер)
              </span>
              <textarea
                value={regenAppearance}
                onChange={(e) => setRegenAppearance(e.target.value)}
                disabled={regenBusy}
                rows={5}
                className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[0.7rem] text-white/80 outline-none focus:border-sky-500/40"
              />
              <p className="mt-1 text-[0.65rem] leading-relaxed text-white/45">
                Если поле пустое, сервер возьмёт описание из карточки и актуальные appearance/outfit из Character Tracker.
              </p>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={regenBusy}
                onClick={() => setRegenNpc(null)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={regenBusy || regenExpressions.length === 0}
                onClick={() => {
                  regenerate.mutate(
                    {
                      chatId,
                      npcId: regenNpc.id,
                      avatar: true,
                      sprite: true,
                      spriteExpressions: regenExpressions,
                      spriteAppearanceOverride: regenAppearance.trim() || undefined,
                      spriteFullBodyExpression: regenFullBodyExpr.trim() || undefined,
                    },
                    { onSettled: () => setRegenNpc(null) },
                  );
                }}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {regenBusy ? "Запуск…" : "Запустить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {entries.map((entry) => {
        const name = cleanNpcDisplayName(entry.npc?.name ?? entry.displayName);
        const rep = entry.npc ? reputationLabel(entry.npc.reputation) : null;
        const showReputation = !!entry.npc && entry.npc.reputation !== 0;
        const canUploadPortrait = !!entry.npc && !!onNpcPortraitClick;
        const canGeneratePortrait =
          !!entry.npc && !!onNpcPortraitGenerate && npcPortraitGenerationEnabled === true;
        const portraitGenerating =
          !!entry.npc && (generatingNpcPortraitNames?.has(entry.npc.name.trim().toLowerCase()) ?? false);
        // Two distinct UI states:
        //   - `isRegenInFlight`: user clicked Regenerate and the mutation
        //     is running. Spinner animates, button disabled.
        //   - `isAssetPending`: the auto-pipeline is still producing the
        //     avatar/sprite (no regen click yet). Button stays clickable
        //     so the user can force a retry; we just dim the icon.
        const isRegenInFlight = !!entry.npc && busyNpcId === entry.npc.id;
        const isAssetPending =
          !!entry.npc && (!entry.npc.avatarUrl || entry.npc.spriteStatus === "pending");
        const isRemoving = removingNpcName
          ? normalizeNpcName(cleanNpcDisplayName(removingNpcName)) === normalizeNpcName(name)
          : false;
        return (
          <div key={normalizeNpcName(name)} className="rounded-lg border border-white/5 bg-white/3 px-3 py-2">
            <div className="flex items-center gap-2">
              {entry.npc ? (
                canUploadPortrait ? (
                  <div className="group/journal-avatar relative shrink-0">
                    {entry.npc.avatarUrl ? (
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => onPreviewPortrait?.(entry.npc!.avatarUrl!, `${name} portrait`)}
                          className="rounded-full transition-transform hover:scale-[1.05] focus:outline-none focus:ring-2 focus:ring-white/20"
                          title="View portrait"
                        >
                          <img
                            src={entry.npc.avatarUrl}
                            alt=""
                            className={cn(
                              "h-6 w-6 rounded-full object-cover ring-1 ring-white/10 transition-colors hover:ring-white/25",
                              isAssetPending && "animate-pulse",
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => onNpcPortraitClick?.(entry.npc!.name)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/55 ring-1 ring-white/10 transition-colors hover:bg-white/15 hover:text-white/90 hover:ring-white/25"
                          title="Upload or replace NPC portrait"
                        >
                          <Upload size={11} aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNpcPortraitClick?.(entry.npc!.name)}
                        className="shrink-0 rounded-full transition-transform hover:scale-[1.05] focus:outline-none focus:ring-2 focus:ring-white/20"
                        title="Upload or replace NPC portrait"
                      >
                        <div
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[0.6rem] font-semibold text-white/60 ring-1 ring-white/10 transition-colors hover:ring-white/25",
                            isAssetPending && "animate-pulse",
                          )}
                        >
                          {name[0]?.toUpperCase() ?? "?"}
                        </div>
                      </button>
                    )}
                    {canGeneratePortrait && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onNpcPortraitGenerate?.(entry.npc!.name);
                        }}
                        disabled={portraitGenerating}
                        className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-[var(--primary)] opacity-0 ring-1 ring-white/15 transition-opacity disabled:cursor-wait group-hover/journal-avatar:opacity-100 max-md:opacity-100"
                        title="Generate NPC portrait"
                      >
                        {portraitGenerating ? (
                          <Loader2 size="0.6rem" className="animate-spin" />
                        ) : (
                          <Wand2 size="0.6rem" />
                        )}
                      </button>
                    )}
                  </div>
                ) : entry.npc.avatarUrl ? (
                  <button
                    type="button"
                    onClick={() => onPreviewPortrait?.(entry.npc!.avatarUrl!, `${name} portrait`)}
                    className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-white/20"
                    title="View portrait"
                  >
                    <img
                      src={entry.npc!.avatarUrl!}
                      alt=""
                      className={cn("h-6 w-6 rounded-full object-cover ring-1 ring-white/10", isAssetPending && "animate-pulse")}
                    />
                  </button>
                ) : (
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[0.6rem] font-semibold text-white/60",
                      isAssetPending && "animate-pulse",
                    )}
                  >
                    {name[0]?.toUpperCase() ?? "?"}
                  </div>
                )
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[0.6rem] font-semibold text-white/60">
                  {name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <span className="flex-1 text-xs font-medium text-white/80">
                {entry.npc.emoji ? `${entry.npc.emoji} ` : ""}
                {name}
              </span>
              {entry.npc && onNpcOpenCard && (
                <button
                  type="button"
                  onClick={() => onNpcOpenCard(entry.npc!)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                  title="NPC details, prompts, and sprite versions"
                  aria-label="NPC details"
                >
                  <Info size={13} />
                </button>
              )}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  entry.npc?.met ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-white/35",
                )}
              >
                {entry.npc ? (entry.npc.met ? "Met" : "Not Met") : "Journal Only"}
              </span>
              {showReputation && rep && (
                <span className={cn("text-[10px] font-medium", rep.color)}>{rep.text}</span>
              )}
              {entry.npc?.id && (
                <button
                  type="button"
                  onClick={() => openRegenDialog(entry.npc!)}
                  disabled={isRegenInFlight}
                  title={
                    isRegenInFlight
                      ? "Regeneration in progress…"
                      : isAssetPending
                        ? "Asset generation in progress — click to force regenerate"
                        : "Regenerate avatar and sprite for this NPC"
                  }
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-60",
                    isAssetPending && !isRegenInFlight && "text-white/25",
                  )}
                >
                  <RotateCw size={11} className={cn(isRegenInFlight && "animate-spin")} />
                </button>
              )}
              {onNpcRemove && (
                <button
                  type="button"
                  onClick={() => onNpcRemove(entry.originalName)}
                  disabled={isRemoving}
                  title="Remove this NPC from the journal"
                  className="rounded p-1 text-white/35 transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            {shouldShowNpcDescription(entry.npc) && (
              <div className="mt-1 text-[0.6rem] text-white/40">{entry.npc.description}</div>
            )}
            {entry.npc?.location && <div className="mt-0.5 text-[0.6rem] text-white/30">📍 {entry.npc.location}</div>}
          </div>
        );
      })}
    </div>
  );
}

function LocationsView({ locations }: { locations: string[] }) {
  if (locations.length === 0) {
    return <div className="text-center text-xs text-white/40">No locations discovered yet.</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {locations.map((loc, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
          <MapPin size={10} className="text-white/40" />
          <span className="text-xs text-white/70">{loc}</span>
        </div>
      ))}
    </div>
  );
}

function InventoryView({
  items,
}: {
  items: Array<{
    item: string;
    action: "acquired" | "used" | "lost" | "removed";
    quantity: number;
    timestamp: string;
  }>;
}) {
  const visibleItems = dedupeAdjacentInventoryEntries(items);

  if (visibleItems.length === 0) {
    return <div className="text-center text-xs text-white/40">No items in inventory log.</div>;
  }

  const actionColors: Record<string, string> = {
    acquired: "text-emerald-400",
    used: "text-amber-400",
    lost: "text-red-400",
    removed: "text-red-300",
  };

  return (
    <div className="flex flex-col gap-1">
      {[...visibleItems].reverse().map((item, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-lg border border-white/5 bg-white/3 px-3 py-1.5"
        >
          <span className="text-xs text-white/70">
            {item.quantity > 1 ? `${item.quantity}x ` : ""}
            {item.item}
          </span>
          <span className={cn("text-[0.625rem] font-medium", actionColors[item.action])}>{item.action}</span>
        </div>
      ))}
    </div>
  );
}

function LibraryView({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-center text-xs text-white/40">No books or notes found yet.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {[...entries].reverse().map((entry, i) => {
        const isBook = entry.readableType === "book" || entry.title.toLowerCase() === "book";
        const text = entry.content;
        return (
          <div key={i} className="rounded-lg border border-white/5 bg-white/3 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <BookOpen size={11} className={isBook ? "text-amber-400/70" : "text-blue-400/70"} />
              <span
                className={cn(
                  "text-[0.625rem] font-semibold uppercase tracking-wide",
                  isBook ? "text-amber-400/70" : "text-blue-400/70",
                )}
              >
                {isBook ? "Book" : "Note"}
              </span>
              <span className="ml-auto text-[0.5625rem] text-white/30">{entry.timestamp}</span>
            </div>
            <JournalMarkdown text={text} className="mt-1.5 text-xs leading-relaxed text-white/70" />
          </div>
        );
      })}
    </div>
  );
}

function NotesView({ notes, onChange, saved }: { notes: string; onChange: (text: string) => void; saved: boolean }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[0.625rem] text-white/40">
          Your personal notes — visible to the Game Master and party members.
        </p>
        <span
          className={cn("text-[0.5625rem] transition-opacity", saved ? "text-emerald-400/60" : "text-amber-400/60")}
        >
          {saved ? "Saved" : "Saving..."}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 gap-2 md:grid-cols-2">
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your notes here... track clues, plans, NPC names, theories — anything you want to remember."
          className="min-h-44 resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-xs leading-relaxed text-white/80 outline-none placeholder:text-white/25 focus:border-white/20 md:min-h-0"
          spellCheck={false}
        />
        <div className="min-h-44 overflow-auto rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 md:min-h-0">
          {notes.trim() ? (
            <JournalMarkdown text={notes} className="text-xs leading-relaxed text-white/75" />
          ) : (
            <div className="text-xs text-white/30">Nothing written yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
