// ──────────────────────────────────────────────
// Game: full-screen image preview (portraits, sprites)
// ──────────────────────────────────────────────
import { X } from "lucide-react";

export function GameMediaLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/88 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Close preview"
      >
        <X size={22} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[min(92vh,1200px)] max-w-full rounded-lg object-contain shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
