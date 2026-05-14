// ──────────────────────────────────────────────
// Modal: AI Request Audit — Detail
// ──────────────────────────────────────────────
import { useMemo, useState } from "react";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useAiAuditDetail, useDeleteAiAuditEntry } from "../../hooks/use-ai-audit";
import { copyToClipboard } from "../../lib/utils";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { toast } from "sonner";

interface Props {
  open: boolean;
  entryId: string | null;
  onClose: () => void;
}

type TabKey = "request" | "response" | "metadata";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "request", label: "Запрос" },
  { key: "response", label: "Ответ" },
  { key: "metadata", label: "Метаданные" },
];

function tryParseJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AiAuditDetailModal({ open, entryId, onClose }: Props) {
  const [tab, setTab] = useState<TabKey>("request");
  const { data, isLoading } = useAiAuditDetail(entryId);
  const deleteMutation = useDeleteAiAuditEntry();

  const entry = data?.entry;

  const requestParsed = useMemo(() => (entry ? tryParseJson(entry.requestPayload) : null), [entry]);
  const responseParsed = useMemo(() => (entry ? tryParseJson(entry.responsePayload) : null), [entry]);
  const metadataParsed = useMemo(() => (entry ? tryParseJson(entry.metadata) : null), [entry]);

  const renderedBody = useMemo(() => {
    if (!entry) return "";
    if (tab === "request") return formatJson(requestParsed);
    if (tab === "response") return formatJson(responseParsed);
    return "";
  }, [tab, entry, requestParsed, responseParsed]);

  const handleCopy = async () => {
    if (!entry) return;
    const ok = await copyToClipboard(renderedBody);
    if (ok) toast.success("Скопировано");
    else toast.error("Не удалось скопировать");
  };

  const handleDelete = async () => {
    if (!entry) return;
    const ok = await showConfirmDialog({
      title: "Удалить запись?",
      message: "Запись аудита будет удалена без возможности восстановления.",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(entry.id);
      toast.success("Запись удалена");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="AI Request" width="max-w-4xl">
      {isLoading || !entry ? (
        <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
          <Loader2 className="animate-spin" size="1rem" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <header className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Время">{new Date(entry.createdAt).toLocaleString()}</Field>
            <Field label="Источник">{entry.source}</Field>
            <Field label="Тип">{entry.kind}</Field>
            <Field label="Статус">
              <StatusBadge status={entry.status} />
            </Field>
            <Field label="Провайдер">{entry.provider}</Field>
            <Field label="Модель">{entry.model || "—"}</Field>
            <Field label="Длительность">{entry.durationMs} мс</Field>
            <Field label="Токены">
              {entry.totalTokens != null
                ? `${entry.totalTokens} (${entry.promptTokens ?? 0}/${entry.completionTokens ?? 0})`
                : "—"}
            </Field>
            {entry.agentName && <Field label="Агент">{entry.agentName}</Field>}
            {entry.chatId && <Field label="Chat">{entry.chatId}</Field>}
            {entry.errorMessage && (
              <div className="col-span-full rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
                {entry.errorMessage}
              </div>
            )}
          </header>

          <div className="flex items-center justify-between border-b border-[var(--border)]/40">
            <div className="flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative rounded-t-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab === t.key
                      ? "bg-[var(--accent)] text-[var(--primary)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 pb-1">
              {tab !== "metadata" && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--primary)] active:scale-95"
                  title="Скопировать"
                >
                  <Copy size="0.75rem" /> Копировать
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:opacity-50 active:scale-95"
                title="Удалить"
              >
                <Trash2 size="0.75rem" /> Удалить
              </button>
            </div>
          </div>

          {tab === "request" && (
            <PayloadView truncated={entry.requestTruncated === "true"} body={renderedBody} />
          )}
          {tab === "response" && (
            <PayloadView truncated={entry.responseTruncated === "true"} body={renderedBody} />
          )}
          {tab === "metadata" && (
            <div className="space-y-3">
              <pre className="max-h-[24rem] overflow-auto rounded-lg border border-[var(--border)]/40 bg-[var(--card)]/50 p-3 text-xs leading-relaxed text-[var(--foreground)]">
                {formatJson({
                  source: entry.source,
                  kind: entry.kind,
                  provider: entry.provider,
                  model: entry.model,
                  agentConfigId: entry.agentConfigId,
                  agentName: entry.agentName,
                  chatId: entry.chatId,
                  messageId: entry.messageId,
                  status: entry.status,
                  durationMs: entry.durationMs,
                  promptTokens: entry.promptTokens,
                  completionTokens: entry.completionTokens,
                  totalTokens: entry.totalTokens,
                  cachedPromptTokens: entry.cachedPromptTokens,
                  errorMessage: entry.errorMessage,
                  requestTruncated: entry.requestTruncated === "true",
                  responseTruncated: entry.responseTruncated === "true",
                  customMetadata: metadataParsed,
                })}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--border)]/40 bg-[var(--card)]/40 px-3 py-2">
      <span className="text-[0.65rem] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
      <span className="truncate text-xs text-[var(--foreground)]">{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ok"
      ? "bg-emerald-500/15 text-emerald-500"
      : status === "error"
        ? "bg-red-500/15 text-red-500"
        : "bg-amber-500/15 text-amber-500";
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[0.65rem] font-semibold ${tone}`}>{status}</span>;
}

function PayloadView({ truncated, body }: { truncated: boolean; body: string }) {
  return (
    <div className="space-y-2">
      {truncated && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          Полезная нагрузка обрезана из-за лимита размера записи. Увеличьте «Лимит размера записи» в настройках, чтобы
          сохранять больше.
        </div>
      )}
      <pre className="max-h-[28rem] overflow-auto rounded-lg border border-[var(--border)]/40 bg-[var(--card)]/50 p-3 text-xs leading-relaxed text-[var(--foreground)]">
        {body || "(пусто)"}
      </pre>
    </div>
  );
}
