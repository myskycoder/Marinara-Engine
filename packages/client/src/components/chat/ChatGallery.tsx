// ──────────────────────────────────────────────
// Chat Gallery — Image grid for per-chat generated images
// ──────────────────────────────────────────────
import { useState, useRef } from "react";
import { ImagePlus, Paintbrush, Trash2, X, ZoomIn, Download, Sparkles, Pin, Minimize2, ImageOff } from "lucide-react";
import {
  useGalleryImages,
  useUploadGalleryImage,
  useDeleteGalleryImage,
  type ChatImage,
} from "../../hooks/use-gallery";
import { useGalleryStore } from "../../stores/gallery.store";
import { ImagePromptPanel } from "./ImagePromptPanel";

interface ChatGalleryProps {
  chatId: string;
  /** Manually trigger the Illustrator agent */
  onIllustrate?: () => void;
  /** Game mode: запросить ещё одну CG-иллюстрацию (вид от первого лица) через SFW image-модель */
  onManualImpactSfw?: () => void;
  /** Game mode: запросить ещё одну CG-иллюстрацию (вид от первого лица) через NSFW image-модель */
  onManualImpactNsfw?: () => void;
  /** Game mode: запросить полную CG-иллюстрацию сцены (третье лицо, игрок в кадре) через SFW image-модель */
  onManualImpactSceneSfw?: () => void;
  /** Game mode: запросить полную CG-иллюстрацию сцены (третье лицо, игрок в кадре) через NSFW image-модель */
  onManualImpactSceneNsfw?: () => void;
  /** Game mode: снять CG-подложку и вернуть фон локации */
  onClearCgPlate?: () => void;
}

function formatImageMeta(image: ChatImage) {
  const details: string[] = [];
  if (image.model) details.push(image.model);
  if (image.provider) details.push(image.provider.replace(/_/g, " "));
  if (image.width && image.height) details.push(`${image.width} x ${image.height}`);
  return details.join(" | ");
}

export function ChatGallery({
  chatId,
  onIllustrate,
  onManualImpactSfw,
  onManualImpactNsfw,
  onManualImpactSceneSfw,
  onManualImpactSceneNsfw,
  onClearCgPlate,
}: ChatGalleryProps) {
  const { data: images, isLoading } = useGalleryImages(chatId);
  const upload = useUploadGalleryImage(chatId);
  const remove = useDeleteGalleryImage(chatId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<ChatImage | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pinImage = useGalleryStore((s) => s.pinImage);
  const lightboxPrompt = lightbox?.prompt.trim() ?? "";
  const lightboxMeta = lightbox ? formatImageMeta(lightbox) : "";

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    upload.mutate(files, {
      onSettled: () => {
        input.value = "";
      },
    });
  };

  const handleDelete = (id: string) => {
    remove.mutate(id);
    setConfirmDeleteId(null);
    if (lightbox?.id === id) setLightbox(null);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {(onIllustrate ||
        onManualImpactSfw ||
        onManualImpactNsfw ||
        onManualImpactSceneSfw ||
        onManualImpactSceneNsfw ||
        onClearCgPlate) && (
        <div className="flex flex-wrap gap-2">
          {onIllustrate && (
            <button
              type="button"
              onClick={onIllustrate}
              className="flex min-h-[2.75rem] flex-1 min-w-[6rem] items-center justify-center gap-2 rounded-xl bg-[var(--primary)]/15 px-3 py-3 text-xs font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
            >
              <Paintbrush size="1rem" />
              Illustrate
            </button>
          )}
          {onManualImpactSfw && (
            <button
              type="button"
              onClick={onManualImpactSfw}
              title="Дополнительная CG-иллюстрация текущего момента (вид от первого лица) через SFW image-модель"
              className="flex min-h-[2.75rem] min-w-[3.5rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--muted)]/10 px-3 py-3 text-xs font-semibold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--muted)]/20"
            >
              +1 SFW
            </button>
          )}
          {onManualImpactNsfw && (
            <button
              type="button"
              onClick={onManualImpactNsfw}
              title="Дополнительная CG-иллюстрация текущего момента (вид от первого лица) через NSFW image-модель. Если NSFW image connection не задан в настройках чата — кнопка покажет подсказку."
              className="flex min-h-[2.75rem] min-w-[3.5rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--destructive)]/10 px-3 py-3 text-xs font-semibold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--destructive)]/20"
            >
              +1 NSFW
            </button>
          )}
          {onManualImpactSceneSfw && (
            <button
              type="button"
              onClick={onManualImpactSceneSfw}
              title="Полная CG-иллюстрация всей сцены через SFW image-модель (вид от третьего лица, игрок виден в кадре)"
              className="flex min-h-[2.75rem] min-w-[3.5rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--primary)]/10 px-3 py-3 text-xs font-semibold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--primary)]/20"
            >
              Full SFW
            </button>
          )}
          {onManualImpactSceneNsfw && (
            <button
              type="button"
              onClick={onManualImpactSceneNsfw}
              title="Полная CG-иллюстрация всей сцены через NSFW image-модель (вид от третьего лица, игрок виден в кадре). Если NSFW image connection не задан — кнопка покажет подсказку."
              className="flex min-h-[2.75rem] min-w-[3.5rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--destructive)]/15 px-3 py-3 text-xs font-semibold tabular-nums text-[var(--foreground)] transition-all hover:bg-[var(--destructive)]/25"
            >
              Full NSFW
            </button>
          )}
          {onClearCgPlate && (
            <button
              type="button"
              onClick={onClearCgPlate}
              title="Снять CG-подложку (illustrations:…) и показать обычный фон локации из каталога или метаданных"
              className="flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--muted)]/10 px-3 py-3 text-[var(--foreground)] transition-all hover:bg-[var(--muted)]/20"
              aria-label="Снять CG"
            >
              <ImageOff size="1rem" />
            </button>
          )}
        </div>
      )}

      {/* Upload button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={upload.isPending}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-xs text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)] hover:text-[var(--primary)]"
      >
        <ImagePlus size="1rem" />
        {upload.isPending ? "Uploading…" : "Upload Images"}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />

      {/* Loading state */}
      {isLoading && <p className="text-center text-xs text-[var(--muted-foreground)]">Loading gallery…</p>}

      {/* Empty state */}
      {!isLoading && (!images || images.length === 0) && (
        <div className="flex flex-col items-center gap-2 py-8 text-[var(--muted-foreground)]">
          <Sparkles size="1.5rem" className="opacity-40" />
          <p className="text-xs">No images yet</p>
          <p className="text-[0.625rem] opacity-60">Upload images or generate them to build your gallery</p>
        </div>
      )}

      {/* Image grid */}
      {images && images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative overflow-hidden rounded-lg bg-[var(--secondary)] ring-1 ring-transparent transition-all hover:ring-[var(--primary)]/40 hover:shadow-lg"
            >
              <img
                src={img.url}
                alt={img.prompt || "Gallery image"}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
                onClick={() => setLightbox(img)}
              />
              {/* Overlay */}
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex w-full items-center justify-between p-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setLightbox(img)}
                      aria-label="View image fullscreen"
                      className="rounded-md bg-white/20 p-1.5 text-white transition-colors hover:bg-white/30"
                      title="View fullscreen"
                    >
                      <ZoomIn size="0.75rem" />
                    </button>
                    <button
                      type="button"
                      onClick={() => pinImage(img)}
                      aria-label="Pin image to chat"
                      className="rounded-md bg-white/20 p-1.5 text-white transition-colors hover:bg-white/30"
                      title="Pin to chat"
                    >
                      <Pin size="0.75rem" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(img.id)}
                    aria-label="Delete gallery image"
                    className="rounded-md bg-red-500/40 p-1.5 text-white transition-colors hover:bg-red-500/60"
                  >
                    <Trash2 size="0.75rem" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]">
          <div className="mx-4 rounded-xl bg-[var(--background)] p-5 shadow-2xl ring-1 ring-[var(--border)]">
            <p className="mb-4 text-sm font-medium">Delete this image?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 rounded-lg bg-[var(--secondary)] px-4 py-2 text-xs transition-colors hover:bg-[var(--accent)]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 rounded-lg bg-red-500/20 px-4 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 max-md:pt-[env(safe-area-inset-top)]"
          onClick={() => setLightbox(null)}
        >
          <div
            className="flex max-h-[90vh] w-[min(90vw,64rem)] max-w-[90vw] flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex min-h-0 max-w-full justify-center">
              <img
                src={lightbox.url}
                alt={lightbox.prompt || "Gallery image"}
                decoding="async"
                className={
                  lightboxPrompt || lightboxMeta
                    ? "max-h-[calc(90vh-10rem)] max-w-full rounded-lg object-contain shadow-2xl"
                    : "max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
                }
              />
              {/* Controls */}
              <div className="absolute right-2 top-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    pinImage(lightbox);
                    setLightbox(null);
                  }}
                  aria-label="Pin image to chat"
                  className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
                  title="Pin to chat"
                >
                  <Minimize2 size="0.875rem" />
                </button>
                <a
                  href={lightbox.url}
                  download
                  aria-label="Download image"
                  className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
                >
                  <Download size="0.875rem" />
                </a>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  aria-label="Close image"
                  className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
                >
                  <X size="0.875rem" />
                </button>
              </div>
            </div>
            <ImagePromptPanel prompt={lightboxPrompt} meta={lightboxMeta} className="w-full max-w-3xl" />
          </div>
        </div>
      )}
    </div>
  );
}
