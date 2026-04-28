// ──────────────────────────────────────────────
// React Query: Scene Painter descriptions per chat
// ──────────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export interface SceneDescriptionEntry {
  id: string;
  messageId: string;
  createdAt: string;
  reason: string;
  description: string;
  mood?: string;
}

export const sceneDescriptionKeys = {
  all: ["scene-descriptions"] as const,
  chat: (chatId: string) => [...sceneDescriptionKeys.all, chatId] as const,
};

export function useSceneDescriptions(chatId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: sceneDescriptionKeys.chat(chatId!),
    queryFn: () => api.get<SceneDescriptionEntry[]>(`/agents/scene-descriptions/${chatId}`),
    enabled: !!chatId && enabled,
    staleTime: 60_000,
  });
}
