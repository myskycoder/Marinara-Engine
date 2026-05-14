// ──────────────────────────────────────────────
// Panel: AI Request Audit Log
// ──────────────────────────────────────────────
// Lists every recorded outbound AI call (LLM, embedding, image, TTS) with
// filters, pagination, and a click-through detail modal.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  ScrollText,
  Trash2,
} from "lucide-react";
import {
  useAiAuditList,
  useAiAuditDistinct,
  useClearAiAudit,
  type AiAuditFilters,
} from "../../hooks/use-ai-audit";
import { AiAuditDetailModal } from "../ai-audit/AiAuditDetailModal";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const SOURCE_LABELS: Record<string, string> = {
  main_generate: "Чат",
  agent: "Агент",
  agent_pipeline: "Батч агентов",
  character_maker: "Character Maker",
  persona_maker: "Persona Maker",
  lorebook_maker: "Lorebook Maker",
  prompt_reviewer: "Prompt Reviewer",
  translate: "Перевод",
  scene: "Сцена",
  encounter: "Энкаунтер",
  game: "Игра",
  conversation: "Conversation",
  image_generation: "Картинки",
  tts: "TTS",
  embedding: "Embeddings",
  connection_test: "Тест",
  other: "Прочее",
};

const KIND_LABELS: Record<string, string> = {
  chat: "chat",
  embed: "embed",
  image: "image",
  tts: "tts",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

function formatTokens(prompt: number | null, completion: number | null, total: number | null): string {
  if (total == null && prompt == null && completion == null) return "—";
  if (total != null && (prompt != null || completion != null)) {
    return `${total} (${prompt ?? "—"}/${completion ?? "—"})`;
  }
  return String(total ?? prompt ?? completion ?? "—");
}

export function AiAuditPanel() {
  const [page, setPage] = useState(0);
  const [source, setSource] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  const filters: AiAuditFilters = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      source: source || undefined,
      kind: kind || undefined,
      provider: provider || undefined,
      status: status || undefined,
      q: q || undefined,
    }),
    [page, source, kind, provider, status, q],
  );

  const { data, isLoading, isFetching, refetch } = useAiAuditList(filters);
  const { data: distinct } = useAiAuditDistinct();
  const clearMutation = useClearAiAudit();

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleClear = async () => {
    const ok = await showConfirmDialog({
      title: "Очистить весь лог?",
      message: `Будут удалены все записи аудита (${total}). Действие необратимо.`,
      confirmLabel: "Очистить",
      cancelLabel: "Отмена",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await clearMutation.mutateAsync();
      toast.success("Лог очищен");
      setPage(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось очистить");
    }
  };

  const body = (
    <section
      className={
        isFullscreen
          ? "fixed inset-0 z-[60] flex flex-col bg-[var(--background)]"
          : "flex h-full flex-col"
      }
    >
      {isFullscreen && (
        <div className="flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-[var(--border)]/30 bg-[var(--card)]/80 px-4 backdrop-blur-sm">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-400 to-amber-500 text-white shadow-sm">
            <ScrollText size="0.875rem" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">AI Audit</h2>
          <span className="ml-2 text-xs text-[var(--muted-foreground)]">
            Полноэкранный режим • Esc, чтобы свернуть
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)]/40 bg-[var(--card)]/40 px-4 py-3">
        <FilterSelect
          value={source}
          onChange={(v) => {
            setSource(v);
            setPage(0);
          }}
          options={distinct?.sources ?? []}
          placeholder="Все источники"
          labels={SOURCE_LABELS}
        />
        <FilterSelect
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(0);
          }}
          options={distinct?.kinds ?? []}
          placeholder="Все типы"
          labels={KIND_LABELS}
        />
        <FilterSelect
          value={provider}
          onChange={(v) => {
            setProvider(v);
            setPage(0);
          }}
          options={distinct?.providers ?? []}
          placeholder="Все провайдеры"
        />
        <FilterSelect
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          options={distinct?.statuses ?? []}
          placeholder="Все статусы"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Поиск по модели..."
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)]/40 bg-[var(--input)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
        />
        <button
          onClick={() => refetch()}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-95"
          title="Обновить"
        >
          <RefreshCw size="0.875rem" className={isFetching ? "animate-spin" : ""} />
        </button>
        <button
          onClick={() => setIsFullscreen((v) => !v)}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-95"
          title={isFullscreen ? "Свернуть (Esc)" : "Развернуть на весь экран"}
        >
          {isFullscreen ? <Minimize2 size="0.875rem" /> : <Maximize2 size="0.875rem" />}
        </button>
        <button
          onClick={handleClear}
          disabled={total === 0 || clearMutation.isPending}
          className="rounded-lg p-1.5 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:opacity-40 active:scale-95"
          title="Очистить весь лог"
        >
          <Trash2 size="0.875rem" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
            <Loader2 className="animate-spin" size="1rem" />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[var(--muted-foreground)]">
            <ScrollText size="2rem" className="opacity-40" />
            <p className="text-sm">Записей нет</p>
            <p className="max-w-xs text-xs">
              Сделайте любой AI-запрос (отправьте сообщение, запустите агент, сгенерируйте картинку), чтобы он появился
              здесь.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {data.rows.map((row) => (
              <li key={row.id}>
                <button
                  onClick={() => setSelectedId(row.id)}
                  className="group flex w-full flex-col gap-1 border-b border-[var(--border)]/30 px-4 py-2.5 text-left text-xs transition-colors hover:bg-[var(--accent)]/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot status={row.status} />
                    <span className="font-medium text-[var(--foreground)]">
                      {SOURCE_LABELS[row.source] ?? row.source}
                    </span>
                    <KindBadge kind={row.kind} />
                    <span className="text-[var(--muted-foreground)]">{row.provider}</span>
                    {row.model && (
                      <span className="truncate text-[var(--muted-foreground)]">/ {row.model}</span>
                    )}
                    <span className="ml-auto text-[var(--muted-foreground)]">{formatTime(row.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[var(--muted-foreground)]">
                    {row.agentName && (
                      <span className="rounded bg-[var(--accent)]/40 px-1.5 py-0.5 text-[0.65rem]">
                        {row.agentName}
                      </span>
                    )}
                    <span>⏱ {formatDuration(row.durationMs)}</span>
                    <span>🪙 {formatTokens(row.promptTokens, row.completionTokens, row.totalTokens)}</span>
                    {row.errorMessage && (
                      <span className="truncate text-[var(--destructive)]">{row.errorMessage}</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)]/40 bg-[var(--card)]/40 px-4 py-2 text-xs text-[var(--muted-foreground)]">
        <span>
          Всего: {total}
        </span>
        <div className="flex items-center gap-1">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded p-1 transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] disabled:opacity-30 active:scale-95"
          >
            <ChevronLeft size="0.875rem" />
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded p-1 transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] disabled:opacity-30 active:scale-95"
          >
            <ChevronRight size="0.875rem" />
          </button>
        </div>
      </div>

      <AiAuditDetailModal open={!!selectedId} entryId={selectedId} onClose={() => setSelectedId(null)} />
    </section>
  );

  if (isFullscreen && typeof document !== "undefined") {
    return createPortal(body, document.body);
  }
  return body;
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  labels,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  labels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--border)]/40 bg-[var(--input)] px-2 py-1.5 text-xs text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {labels?.[opt] ?? opt}
        </option>
      ))}
    </select>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-amber-500";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`} aria-label={status} />;
}

function KindBadge({ kind }: { kind: string }) {
  const tone =
    kind === "chat"
      ? "bg-blue-500/15 text-blue-500"
      : kind === "embed"
        ? "bg-purple-500/15 text-purple-500"
        : kind === "image"
          ? "bg-pink-500/15 text-pink-500"
          : kind === "tts"
            ? "bg-emerald-500/15 text-emerald-500"
            : "bg-[var(--muted)]/40 text-[var(--muted-foreground)]";
  return (
    <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${tone}`}>
      {kind}
    </span>
  );
}
