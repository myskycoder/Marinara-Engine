// ──────────────────────────────────────────────
// Hook: AI Audit Log (admin)
// ──────────────────────────────────────────────
// Wraps the privileged `/api/admin/ai-audit/*` endpoints. All calls require
// `X-Admin-Secret` (handled centrally by the api client).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export interface AiAuditListItem {
  id: string;
  createdAt: string;
  source: string;
  kind: string;
  provider: string;
  model: string;
  agentConfigId: string | null;
  agentName: string | null;
  chatId: string | null;
  messageId: string | null;
  status: string;
  errorMessage: string | null;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedPromptTokens: number | null;
  requestTruncated: string;
  responseTruncated: string;
}

export interface AiAuditDetail extends AiAuditListItem {
  requestPayload: string;
  responsePayload: string;
  metadata: string;
}

export interface AiAuditListResponse {
  rows: AiAuditListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AiAuditDistinct {
  sources: string[];
  kinds: string[];
  providers: string[];
  statuses: string[];
}

export interface AiAuditSettings {
  enabled: boolean;
  maxEntries: number;
  maxRecordSize: number;
  retentionDays: number;
  logRequestBody: boolean;
  logResponseBody: boolean;
}

export interface AiAuditSettingsResponse {
  settings: AiAuditSettings;
  defaults: AiAuditSettings;
}

export interface AiAuditFilters {
  limit?: number;
  offset?: number;
  source?: string;
  kind?: string;
  provider?: string;
  agentConfigId?: string;
  chatId?: string;
  status?: string;
  q?: string;
  since?: string;
  until?: string;
}

const aiAuditKeys = {
  all: ["ai-audit"] as const,
  list: (filters: AiAuditFilters) => ["ai-audit", "list", filters] as const,
  detail: (id: string) => ["ai-audit", "detail", id] as const,
  distinct: () => ["ai-audit", "distinct"] as const,
  settings: () => ["ai-audit", "settings"] as const,
};

function buildQuery(filters: AiAuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAiAuditList(filters: AiAuditFilters) {
  return useQuery({
    queryKey: aiAuditKeys.list(filters),
    queryFn: () => api.get<AiAuditListResponse>(`/admin/ai-audit${buildQuery(filters)}`),
    staleTime: 5_000,
  });
}

export function useAiAuditDetail(id: string | null) {
  return useQuery({
    queryKey: aiAuditKeys.detail(id ?? ""),
    queryFn: () => api.get<{ entry: AiAuditDetail }>(`/admin/ai-audit/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAiAuditDistinct() {
  return useQuery({
    queryKey: aiAuditKeys.distinct(),
    queryFn: () => api.get<AiAuditDistinct>("/admin/ai-audit/distinct"),
    staleTime: 30_000,
  });
}

export function useAiAuditSettings() {
  return useQuery({
    queryKey: aiAuditKeys.settings(),
    queryFn: () => api.get<AiAuditSettingsResponse>("/admin/ai-audit/settings"),
    staleTime: 30_000,
  });
}

export function useUpdateAiAuditSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AiAuditSettings>) =>
      api.put<{ settings: AiAuditSettings }>("/admin/ai-audit/settings", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAuditKeys.settings() });
    },
  });
}

export function useDeleteAiAuditEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: string }>(`/admin/ai-audit/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAuditKeys.all });
    },
  });
}

export function useClearAiAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ cleared: boolean }>("/admin/ai-audit"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAuditKeys.all });
    },
  });
}

export type AiAuditExportMode = "last_turn" | "last_turns" | "last_logs";

export interface AiAuditExportInput {
  mode: AiAuditExportMode;
  /** Used by `last_turns` (default 5). */
  turnCount?: number;
  /** Used by `last_logs` (default 100). */
  logCount?: number;
  /** Window in seconds for turn modes (server default 300). */
  windowSeconds?: number;
  /** Same filter object the panel feeds to `useAiAuditList`. */
  filters?: AiAuditFilters;
}

export function useExportAiAudit() {
  return useMutation({
    mutationFn: async (input: AiAuditExportInput) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filenameByMode: Record<AiAuditExportMode, string> = {
        last_turn: `ai-audit-last-turn-${stamp}.json`,
        last_turns: `ai-audit-last-${input.turnCount ?? 5}-turns-${stamp}.json`,
        last_logs: `ai-audit-last-${input.logCount ?? 100}-logs-${stamp}.json`,
      };
      await api.downloadPost("/admin/ai-audit/export", input, filenameByMode[input.mode]);
    },
  });
}

export function usePruneAiAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ deletedByAge: number; deletedByCount: number }>("/admin/ai-audit/prune"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAuditKeys.all });
    },
  });
}
