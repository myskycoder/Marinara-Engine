// ──────────────────────────────────────────────
// Game: NPC detail card (journal overlay)
//
// Shows description, location, stored image prompts, and sprite generation
// history with previews and an active-version selector.
// ──────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { X, Copy, Check, ImageIcon } from "lucide-react";
import type { GameNpc } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import { spriteKeys, type SpriteInfo } from "../../hooks/use-characters";
import { useNpcFullBodyEmotionSet, useSetActiveNpcSprite } from "../../hooks/use-game";
import { GameMediaLightbox } from "./GameMediaLightbox";

function pickSpritePreviewUrl(sprites: SpriteInfo[] | undefined): string | null {
  if (!sprites?.length) return null;
  const idle = sprites.find((s) => s.expression === "full_idle" || s.filename.includes("full_idle"));
  return idle?.url ?? sprites[0]?.url ?? null;
}

export function GameNpcCardPanel({
  chatId,
  npc,
  spriteExpressionLabels,
  onClose,
}: {
  chatId: string;
  npc: GameNpc;
  /** Normalized expression keys used for `full_<expr>.png` generation (chat tracker list + defaults). */
  spriteExpressionLabels: string[];
  onClose: () => void;
}) {
  const setActive = useSetActiveNpcSprite();
  const fullBodyEmotions = useNpcFullBodyEmotionSet();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const generationRows = useMemo(() => {
    if (npc.spriteGenerations?.length) {
      return [...npc.spriteGenerations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (npc.spriteId?.trim() && npc.spriteStatus === "ready") {
      return [{ spriteId: npc.spriteId.trim(), createdAt: "", prompt: npc.spritePrompt?.trim() ?? "" }];
    }
    return [];
  }, [npc]);

  const spriteIds = useMemo(() => [...new Set(generationRows.map((g) => g.spriteId))], [generationRows]);

  const spriteQueries = useQueries({
    queries: spriteIds.map((id) => ({
      queryKey: spriteKeys.list(id),
      queryFn: () => api.get<SpriteInfo[]>(`/sprites/${id}`),
      enabled: spriteIds.length > 0,
    })),
  });

  const spriteIdToPreview = useMemo(() => {
    const map = new Map<string, string | null>();
    spriteIds.forEach((id, i) => {
      map.set(id, pickSpritePreviewUrl(spriteQueries[i]?.data));
    });
    return map;
  }, [spriteIds, spriteQueries]);

  const copyText = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setCopiedKey(null);
    }
  }, []);

  const activeSpriteId = npc.spriteId?.trim() ?? "";
  const invalidateIds = useMemo(() => {
    const s = new Set<string>();
    if (activeSpriteId) s.add(activeSpriteId);
    for (const g of generationRows) s.add(g.spriteId);
    return [...s];
  }, [activeSpriteId, generationRows]);

  return (
    <>
      {lightbox ? <GameMediaLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} /> : null}
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-2xl"
        role="dialog"
        aria-labelledby="npc-card-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 id="npc-card-title" className="truncate text-sm font-semibold text-white/90">
            {npc.emoji ? `${npc.emoji} ` : ""}
            {npc.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-white/75">
          {npc.avatarUrl ? (
            <section className="mb-4">
              <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">Portrait</div>
              <button
                type="button"
                onClick={() => setLightbox({ src: npc.avatarUrl!, alt: `${npc.name} portrait` })}
                className="group relative block w-fit rounded-full ring-2 ring-white/10 transition-transform hover:scale-[1.02] hover:ring-white/25 focus:outline-none focus:ring-2 focus:ring-sky-400/50"
                title="View full size"
              >
                <img
                  src={npc.avatarUrl}
                  alt=""
                  className="h-20 w-20 rounded-full object-cover"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-[0.65rem] font-medium text-white/0 transition-colors group-hover:bg-black/35 group-hover:text-white/90">
                  Enlarge
                </span>
              </button>
            </section>
          ) : null}

          {!!npc.description?.trim() && (
            <section className="mb-4">
              <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">Description</div>
              <p className="whitespace-pre-wrap leading-relaxed text-white/80">{npc.description.trim()}</p>
            </section>
          )}

          {!!npc.location?.trim() && (
            <section className="mb-4">
              <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">Location</div>
              <p className="text-white/80">{npc.location}</p>
            </section>
          )}

          {npc.portraitPrompt?.trim() && (
            <section className="mb-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">Portrait prompt</span>
                <button
                  type="button"
                  onClick={() => void copyText("portrait", npc.portraitPrompt!.trim())}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
                >
                  {copiedKey === "portrait" ? <Check size={12} /> : <Copy size={12} />}
                  Copy
                </button>
              </div>
              <p className="max-h-28 overflow-y-auto rounded-md border border-white/5 bg-black/30 p-2 font-mono text-[0.65rem] leading-snug text-white/60">
                {npc.portraitPrompt.trim()}
              </p>
            </section>
          )}

          <section className="mb-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">Sprite prompt</span>
              {npc.spritePrompt?.trim() ? (
                <button
                  type="button"
                  onClick={() => void copyText("sprite", npc.spritePrompt!.trim())}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-[0.65rem] text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
                >
                  {copiedKey === "sprite" ? <Check size={12} /> : <Copy size={12} />}
                  Copy
                </button>
              ) : null}
            </div>
            {npc.spritePrompt?.trim() ? (
              <p className="max-h-28 overflow-y-auto rounded-md border border-white/5 bg-black/30 p-2 font-mono text-[0.65rem] leading-snug text-white/60">
                {npc.spritePrompt.trim()}
              </p>
            ) : (
              <p className="text-white/35">No stored sprite prompt yet (generate or regenerate sprites first).</p>
            )}
          </section>

          <section>
            <div className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">Sprite versions</div>
            {npc.spriteStatus === "pending" && (
              <p className="mb-2 text-[0.65rem] text-amber-200/80">Sprite generation in progress…</p>
            )}
            {generationRows.length === 0 ? (
              <p className="text-white/35">No finished sprite sheets yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {generationRows.map((row) => {
                  const isActive = row.spriteId === activeSpriteId;
                  const preview = spriteIdToPreview.get(row.spriteId) ?? null;
                  const busy = setActive.isPending;
                  const emotionBusy =
                    fullBodyEmotions.isPending &&
                    fullBodyEmotions.variables?.spriteId === row.spriteId;
                  const rowKey = `${row.spriteId}-${row.createdAt || "legacy"}`;
                  return (
                    <li
                      key={rowKey}
                      className={cn(
                        "flex gap-3 rounded-lg border p-2",
                        isActive ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]",
                      )}
                    >
                      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-black/40 ring-1 ring-white/10">
                        {preview ? (
                          <button
                            type="button"
                            onClick={() => setLightbox({ src: preview, alt: `${npc.name} sprite (${row.spriteId})` })}
                            className="block h-full w-full cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-sky-400/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
                            title="View full size"
                          >
                            <img src={preview} alt="" className="h-full w-full object-cover object-top" />
                          </button>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/25">
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {isActive && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[0.6rem] font-medium text-emerald-200">
                              Active
                            </span>
                          )}
                          {row.createdAt ? (
                            <span className="text-[0.6rem] text-white/40">{new Date(row.createdAt).toLocaleString()}</span>
                          ) : null}
                        </div>
                        {(row.prompt || row.expressionSheetPrompt || row.fullBodyPrompt) && (
                          <div className="mt-1 space-y-1">
                            {row.prompt ? (
                              <details className="rounded border border-white/5 bg-black/20">
                                <summary className="cursor-pointer px-2 py-1 text-[0.6rem] text-white/50">
                                  Appearance prompt
                                </summary>
                                <p className="max-h-24 overflow-y-auto px-2 pb-2 font-mono text-[0.6rem] leading-snug text-white/45">
                                  {row.prompt}
                                </p>
                              </details>
                            ) : null}
                            {row.expressionSheetPrompt?.trim() ? (
                              <details className="rounded border border-white/5 bg-black/20">
                                <summary className="cursor-pointer px-2 py-1 text-[0.6rem] text-white/50">
                                  Expression sheet prompt
                                </summary>
                                <p className="max-h-24 overflow-y-auto px-2 pb-2 font-mono text-[0.6rem] leading-snug text-white/45">
                                  {row.expressionSheetPrompt.trim()}
                                </p>
                              </details>
                            ) : null}
                            {row.fullBodyPrompt?.trim() ? (
                              <details className="rounded border border-white/5 bg-black/20">
                                <summary className="cursor-pointer px-2 py-1 text-[0.6rem] text-white/50">
                                  Full body prompt
                                </summary>
                                <p className="max-h-24 overflow-y-auto px-2 pb-2 font-mono text-[0.6rem] leading-snug text-white/45">
                                  {row.fullBodyPrompt.trim()}
                                </p>
                              </details>
                            ) : null}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {!isActive && (
                            <button
                              type="button"
                              disabled={busy || emotionBusy}
                              onClick={() =>
                                setActive.mutate({
                                  chatId,
                                  npcId: npc.id,
                                  spriteId: row.spriteId,
                                  spriteIdsToInvalidate: invalidateIds,
                                })
                              }
                              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[0.65rem] font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
                            >
                              Use this version
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy || emotionBusy || npc.spriteStatus === "pending"}
                            onClick={() =>
                              fullBodyEmotions.mutate({
                                chatId,
                                npcId: npc.id,
                                spriteId: row.spriteId,
                                spriteExpressions: spriteExpressionLabels,
                              })
                            }
                            className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[0.65rem] font-medium text-sky-100/90 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
                            title="Generate full-body PNGs per emotion (full_neutral, full_happy, …) for this sprite folder"
                          >
                            {emotionBusy ? "Full-body…" : "Full-body emotions"}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
    </>
  );
}
