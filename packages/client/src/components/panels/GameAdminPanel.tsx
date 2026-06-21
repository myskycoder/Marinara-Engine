// ──────────────────────────────────────────────
// Panel: Game Session Admin
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Gamepad2,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { showConfirmDialog } from "../../lib/app-dialogs";
import {
  useExportGameCampaign,
  useExportGameSession,
  useGameAdminAgentRuns,
  useGameAdminAssets,
  useGameAdminCampaigns,
  useGameAdminCheckpoints,
  useGameAdminInspector,
  useGameAdminMessages,
  useGameAdminReferences,
  useGameAdminSessions,
  useGameAdminSnapshots,
  usePatchGameSessionMetadata,
  type GameCampaignListItem,
  type GameSessionListItem,
} from "../../hooks/use-admin-game";

type AdminView = "campaigns" | "sessions" | "inspector";

type InspectorTab =
  | "overview"
  | "metadata"
  | "npcs"
  | "world"
  | "journal"
  | "hud"
  | "transcript"
  | "state"
  | "checkpoints"
  | "agents"
  | "assets"
  | "references"
  | "export"
  | "edit";

const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "metadata", label: "Metadata" },
  { id: "npcs", label: "NPC" },
  { id: "world", label: "Мир" },
  { id: "journal", label: "Журнал" },
  { id: "hud", label: "HUD" },
  { id: "transcript", label: "Транскрипт" },
  { id: "state", label: "State" },
  { id: "checkpoints", label: "Чекпоинты" },
  { id: "agents", label: "Агенты" },
  { id: "assets", label: "Ассеты" },
  { id: "references", label: "Ссылки" },
  { id: "export", label: "Экспорт" },
  { id: "edit", label: "Редактор" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[28rem] overflow-auto rounded-lg border border-[var(--border)]/40 bg-[var(--background)]/60 p-3 text-xs leading-relaxed text-[var(--foreground)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <td className={`px-3 py-2 text-xs text-[var(--foreground)] ${mono ? "font-mono" : ""}`}>{children}</td>
  );
}

export function GameAdminPanel() {
  const [view, setView] = useState<AdminView>("campaigns");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedCampaignName, setSelectedCampaignName] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [messageOffset, setMessageOffset] = useState(0);
  const [metadataDraft, setMetadataDraft] = useState("");
  const [metadataDirty, setMetadataDirty] = useState(false);
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

  const campaignsQuery = useGameAdminCampaigns();
  const sessionsQuery = useGameAdminSessions(selectedGameId);
  const inspectorQuery = useGameAdminInspector(selectedChatId);
  const messagesQuery = useGameAdminMessages(selectedChatId, 50, messageOffset);
  const snapshotsQuery = useGameAdminSnapshots(selectedChatId);
  const checkpointsQuery = useGameAdminCheckpoints(selectedChatId);
  const agentRunsQuery = useGameAdminAgentRuns(selectedChatId);
  const assetsQuery = useGameAdminAssets(selectedChatId);
  const referencesQuery = useGameAdminReferences(selectedChatId);
  const exportSession = useExportGameSession();
  const exportCampaign = useExportGameCampaign();
  const patchMetadata = usePatchGameSessionMetadata(selectedChatId);

  const inspector = inspectorQuery.data;
  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const sessions = sessionsQuery.data?.sessions ?? [];

  const selectedSession = useMemo(
    () => sessions.find((s) => s.chatId === selectedChatId) ?? null,
    [sessions, selectedChatId],
  );

  const openCampaign = (campaign: GameCampaignListItem) => {
    setSelectedGameId(campaign.gameId);
    setSelectedCampaignName(campaign.name);
    setSelectedChatId(null);
    setView("sessions");
    setInspectorTab("overview");
  };

  const openSession = (session: GameSessionListItem) => {
    setSelectedChatId(session.chatId);
    setView("inspector");
    setInspectorTab("overview");
    setMessageOffset(0);
    setMetadataDirty(false);
    setMetadataDraft("");
  };

  const backToCampaigns = () => {
    setView("campaigns");
    setSelectedGameId(null);
    setSelectedChatId(null);
  };

  const backToSessions = () => {
    setView("sessions");
    setSelectedChatId(null);
    setInspectorTab("overview");
  };

  const handleExportSession = async () => {
    if (!selectedChatId) return;
    const ok = await showConfirmDialog({
      title: "Экспорт сессии?",
      message: "ZIP может содержать приватный/NSFW контент, полный transcript и бинарные ассеты.",
      confirmLabel: "Скачать",
      cancelLabel: "Отмена",
    });
    if (!ok) return;
    try {
      await exportSession.mutateAsync(selectedChatId);
      toast.success("Сессия экспортирована");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось экспортировать");
    }
  };

  const handleExportCampaign = async () => {
    if (!selectedGameId) return;
    const ok = await showConfirmDialog({
      title: "Экспорт кампании?",
      message: "Будут упакованы все сессии кампании и связанные файлы.",
      confirmLabel: "Скачать",
      cancelLabel: "Отмена",
    });
    if (!ok) return;
    try {
      await exportCampaign.mutateAsync(selectedGameId);
      toast.success("Кампания экспортирована");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось экспортировать");
    }
  };

  const loadMetadataDraft = () => {
    if (!inspector) return;
    setMetadataDraft(JSON.stringify(inspector.metadata, null, 2));
    setMetadataDirty(false);
  };

  const saveMetadataDraft = async () => {
    if (!selectedChatId) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(metadataDraft) as Record<string, unknown>;
    } catch {
      toast.error("Невалидный JSON");
      return;
    }
    const ok = await showConfirmDialog({
      title: "Сохранить metadata?",
      message: "Перед сохранением будет создан manual checkpoint. Другие сессии кампании не изменятся.",
      confirmLabel: "Сохранить",
      cancelLabel: "Отмена",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await patchMetadata.mutateAsync(parsed);
      toast.success("Metadata обновлена");
      setMetadataDirty(false);
      void inspectorQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
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
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-rose-400 to-red-500 text-white shadow-sm">
            <Gamepad2 size="0.875rem" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Game Admin</h2>
          <span className="ml-2 text-xs text-[var(--muted-foreground)]">
            Полноэкранный режим • Esc, чтобы свернуть
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)]/40 bg-[var(--card)]/40 px-4 py-3">
        {view !== "campaigns" && (
          <button
            type="button"
            onClick={view === "inspector" ? backToSessions : backToCampaigns}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)]/50 px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]/40"
          >
            <ArrowLeft size={14} />
            Назад
          </button>
        )}
        <span className="text-xs text-[var(--muted-foreground)]">
          {view === "campaigns" && "Кампании"}
          {view === "sessions" && selectedCampaignName}
          {view === "inspector" && (selectedSession?.name ?? "Сессия")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="inline-flex items-center rounded-md border border-[var(--border)]/50 p-1.5 text-[var(--foreground)] hover:bg-[var(--accent)]/40"
            title={isFullscreen ? "Свернуть (Esc)" : "Развернуть на весь экран"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={() => {
              void campaignsQuery.refetch();
              if (selectedGameId) void sessionsQuery.refetch();
              if (selectedChatId) void inspectorQuery.refetch();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)]/50 px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]/40"
          >
            <RefreshCw size={14} className={campaignsQuery.isFetching ? "animate-spin" : ""} />
            Обновить
          </button>
        </div>
      </div>

      {view === "campaigns" && (
        <div className="flex-1 overflow-auto p-4">
          {campaignsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              Загрузка кампаний…
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Игровых кампаний не найдено.</p>
          ) : (
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)]/40">
                  <Th>Имя</Th>
                  <Th>gameId</Th>
                  <Th>Сессий</Th>
                  <Th>Ветки</Th>
                  <Th>Статус</Th>
                  <Th>Обновлена</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.gameId} className="border-b border-[var(--border)]/20 hover:bg-[var(--accent)]/20">
                    <Td>{c.name}</Td>
                    <Td mono>
                      {c.gameId.slice(0, 8)}…
                    </Td>
                    <Td>{c.sessionCount}</Td>
                    <Td>{c.forkBranchCount}</Td>
                    <Td>{c.lastSessionStatus ?? "—"}</Td>
                    <Td>{formatTime(c.lastUpdatedAt)}</Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => openCampaign(c)}
                        className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
                      >
                        Открыть
                        <ChevronRight size={14} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === "sessions" && (
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              disabled={!selectedGameId || exportCampaign.isPending}
              onClick={() => void handleExportCampaign()}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)]/50 px-2 py-1 text-xs hover:bg-[var(--accent)]/40 disabled:opacity-50"
            >
              <Download size={14} />
              Экспорт кампании
            </button>
          </div>
          {sessionsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              Загрузка сессий…
            </div>
          ) : (
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)]/40">
                  <Th>#</Th>
                  <Th>Имя</Th>
                  <Th>Статус</Th>
                  <Th>Сообщ.</Th>
                  <Th>State</Th>
                  <Th>CP</Th>
                  <Th>Ассеты</Th>
                  <Th>chatId</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.chatId} className="border-b border-[var(--border)]/20 hover:bg-[var(--accent)]/20">
                    <Td>{s.gameSessionNumber ?? "—"}</Td>
                    <Td>{s.name}</Td>
                    <Td>{s.gameSessionStatus ?? "—"}</Td>
                    <Td>{s.messageCount}</Td>
                    <Td>{s.snapshotCount}</Td>
                    <Td>{s.checkpointCount}</Td>
                    <Td>
                      {s.assetFileCount} ({formatBytes(s.assetBytes)})
                    </Td>
                    <Td mono>{s.chatId.slice(0, 8)}…</Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => openSession(s)}
                        className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
                      >
                        Inspector
                        <ChevronRight size={14} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === "inspector" && selectedChatId && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-1 border-b border-[var(--border)]/40 px-3 py-2">
            {INSPECTOR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setInspectorTab(tab.id);
                  if (tab.id === "edit" && !metadataDirty && !metadataDraft) loadMetadataDraft();
                }}
                className={`rounded-md px-2 py-1 text-xs ${
                  inspectorTab === tab.id
                    ? "bg-[var(--accent)] text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/30"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {inspectorQuery.isLoading || !inspector ? (
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Loader2 size={16} className="animate-spin" />
                Загрузка inspector…
              </div>
            ) : (
              <>
                {inspectorTab === "overview" && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow label="chatId" value={selectedChatId} mono />
                      <InfoRow label="gameId" value={inspector.overview.gameId ?? "—"} mono />
                      <InfoRow label="Сессия #" value={String(inspector.overview.gameSessionNumber ?? "—")} />
                      <InfoRow label="Статус" value={inspector.overview.gameSessionStatus ?? "—"} />
                      <InfoRow label="GM mode" value={inspector.overview.gameGmMode ?? "—"} />
                      <InfoRow label="connectionId" value={inspector.overview.connectionId ?? "—"} mono />
                      <InfoRow label="personaId" value={inspector.overview.personaId ?? "—"} mono />
                      <InfoRow label="forkLabel" value={inspector.overview.forkLabel ?? "—"} />
                    </div>
                    {inspector.overview.forkedFromChatId && (
                      <p className="text-xs text-amber-400">
                        Fork from chat {inspector.overview.forkedFromChatId}
                        {inspector.overview.forkedFromMessageId ? ` @ ${inspector.overview.forkedFromMessageId}` : ""}
                      </p>
                    )}
                    <JsonBlock value={inspector.overview.counts} />
                    <JsonBlock value={inspector.overview.gameSetupConfig} />
                  </div>
                )}

                {inspectorTab === "metadata" && <JsonBlock value={inspector.metadata} />}

                {inspectorTab === "npcs" && <JsonBlock value={inspector.highlights.gameNpcs} />}

                {inspectorTab === "world" && (
                  <div className="space-y-4">
                    <Section title="World overview" value={inspector.highlights.gameWorldOverview} />
                    <Section title="Story arc" value={inspector.highlights.gameStoryArc} />
                    <JsonBlock value={inspector.highlights.gamePlotTwists} />
                    <JsonBlock value={inspector.highlights.gameMap} />
                    <JsonBlock value={inspector.highlights.gameMaps} />
                    <JsonBlock value={inspector.highlights.locationCatalog} />
                  </div>
                )}

                {inspectorTab === "journal" && (
                  <div className="space-y-4">
                    <Section title="Player notes" value={inspector.highlights.gamePlayerNotes} />
                    <JsonBlock value={inspector.highlights.gameJournal} />
                    <JsonBlock value={inspector.highlights.gameInventory} />
                    <JsonBlock value={inspector.highlights.gamePartyArcs} />
                    <JsonBlock value={inspector.highlights.gameCharacterCards} />
                  </div>
                )}

                {inspectorTab === "hud" && (
                  <div className="space-y-4">
                    <InfoRow label="Morale" value={String(inspector.highlights.gameMorale ?? "—")} />
                    <JsonBlock value={inspector.highlights.gameBlueprint} />
                    <JsonBlock value={inspector.highlights.gameWidgetState} />
                  </div>
                )}

                {inspectorTab === "transcript" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={messageOffset <= 0}
                        onClick={() => setMessageOffset((o) => Math.max(0, o - 50))}
                        className="rounded border border-[var(--border)]/50 px-2 py-1 text-xs disabled:opacity-40"
                      >
                        Назад
                      </button>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {messageOffset + 1}–{messageOffset + (messagesQuery.data?.rows.length ?? 0)} /{" "}
                        {messagesQuery.data?.total ?? 0}
                      </span>
                      <button
                        type="button"
                        disabled={
                          messageOffset + (messagesQuery.data?.rows.length ?? 0) >= (messagesQuery.data?.total ?? 0)
                        }
                        onClick={() => setMessageOffset((o) => o + 50)}
                        className="rounded border border-[var(--border)]/50 px-2 py-1 text-xs disabled:opacity-40"
                      >
                        Вперёд
                      </button>
                    </div>
                    {messagesQuery.isLoading ? (
                      <Loader2 size={16} className="animate-spin text-[var(--muted-foreground)]" />
                    ) : (
                      <JsonBlock
                        value={{
                          messages: messagesQuery.data?.rows ?? [],
                          swipes: messagesQuery.data?.swipes ?? [],
                        }}
                      />
                    )}
                  </div>
                )}

                {inspectorTab === "state" && (
                  snapshotsQuery.isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <JsonBlock value={snapshotsQuery.data?.rows ?? []} />
                  )
                )}

                {inspectorTab === "checkpoints" && (
                  checkpointsQuery.isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <JsonBlock value={checkpointsQuery.data?.rows ?? []} />
                  )
                )}

                {inspectorTab === "agents" && (
                  agentRunsQuery.isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <JsonBlock value={agentRunsQuery.data ?? { runs: [], memory: [] }} />
                  )
                )}

                {inspectorTab === "assets" && (
                  assetsQuery.isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Спрайты NPC лежат в общей папке sprites/ и привязаны через gameNpcs[].spriteId.
                      </p>
                      <JsonBlock value={assetsQuery.data ?? {}} />
                    </div>
                  )
                )}

                {inspectorTab === "references" && (
                  referencesQuery.isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <div className="space-y-3">
                      {(referencesQuery.data?.missing.length ?? 0) > 0 && (
                        <p className="text-xs text-amber-400">
                          Отсутствуют глобальные зависимости: {referencesQuery.data?.missing.join(", ")}
                        </p>
                      )}
                      <JsonBlock value={referencesQuery.data ?? {}} />
                    </div>
                  )
                )}

                {inspectorTab === "export" && (
                  <div className="space-y-4">
                    <p className="text-sm text-[var(--muted-foreground)]">
                      ZIP содержит envelope.json (полный снимок сессии) и бинарные файлы из backgrounds/, avatars/npc/,
                      gallery/ и sprites/ для NPC этой сессии.
                    </p>
                    <button
                      type="button"
                      disabled={exportSession.isPending}
                      onClick={() => void handleExportSession()}
                      className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {exportSession.isPending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      Скачать ZIP сессии
                    </button>
                  </div>
                )}

                {inspectorTab === "edit" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={loadMetadataDraft}
                        className="rounded border border-[var(--border)]/50 px-2 py-1 text-xs"
                      >
                        Перезагрузить из сервера
                      </button>
                      <button
                        type="button"
                        disabled={patchMetadata.isPending}
                        onClick={() => void saveMetadataDraft()}
                        className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        {patchMetadata.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Сохранить
                      </button>
                    </div>
                    <textarea
                      value={metadataDraft || JSON.stringify(inspector.metadata, null, 2)}
                      onChange={(e) => {
                        setMetadataDraft(e.target.value);
                        setMetadataDirty(true);
                      }}
                      className="min-h-[24rem] w-full rounded-lg border border-[var(--border)]/50 bg-[var(--background)] p-3 font-mono text-xs"
                      spellCheck={false}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!campaignsQuery.isLoading && view === "campaigns" && (
        <div className="border-t border-[var(--border)]/30 px-4 py-2 text-[0.65rem] text-[var(--muted-foreground)]">
          <Gamepad2 size={12} className="mr-1 inline" />
          Требуется ADMIN_SECRET в Settings → Admin. Сессии автономны — правка одной не меняет другие.
        </div>
      )}
    </section>
  );

  if (isFullscreen && typeof document !== "undefined") {
    return createPortal(body, document.body);
  }
  return body;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)]/30 bg-[var(--card)]/30 px-3 py-2">
      <div className="text-[0.65rem] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-1 text-xs ${mono ? "font-mono break-all" : ""}`}>{value}</div>
    </div>
  );
}

function Section({ title, value }: { title: string; value: string | null }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-[var(--foreground)]">{title}</h4>
      <pre className="whitespace-pre-wrap rounded-lg border border-[var(--border)]/40 bg-[var(--background)]/60 p-3 text-xs">
        {value?.trim() ? value : "—"}
      </pre>
    </div>
  );
}
