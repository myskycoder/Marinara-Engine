// ──────────────────────────────────────────────
// Zustand Store: Pinned Gallery Images
// ──────────────────────────────────────────────
import { create } from "zustand";
import type { GalleryIllustrationStylePresetId } from "@marinara-engine/shared";
import type { ChatImage } from "../hooks/use-gallery";

export const GALLERY_COMFY_STEP_OPTIONS = [4, 8, 12, 18, 28] as const;
export type GalleryComfySteps = (typeof GALLERY_COMFY_STEP_OPTIONS)[number];

const GALLERY_ILLUSTRATION_OPTIONS_KEY = "gallery-illustration-options";

type StoredGalleryIllustrationOptions = {
  includeImageReference?: boolean;
  comfySteps?: GalleryComfySteps;
  stylePreset?: GalleryIllustrationStylePresetId;
};

function isGalleryComfySteps(value: unknown): value is GalleryComfySteps {
  return typeof value === "number" && (GALLERY_COMFY_STEP_OPTIONS as readonly number[]).includes(value);
}

function isGalleryStylePreset(value: unknown): value is GalleryIllustrationStylePresetId {
  return (
    value === "game" ||
    value === "vn-cel" ||
    value === "cinematic" ||
    value === "painterly" ||
    value === "noir" ||
    value === "retro-90s"
  );
}

function readStoredIllustrationOptions(): StoredGalleryIllustrationOptions {
  try {
    const raw = window.localStorage.getItem(GALLERY_ILLUSTRATION_OPTIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredGalleryIllustrationOptions;
    return {
      includeImageReference:
        typeof parsed.includeImageReference === "boolean" ? parsed.includeImageReference : undefined,
      comfySteps: isGalleryComfySteps(parsed.comfySteps) ? parsed.comfySteps : undefined,
      stylePreset: isGalleryStylePreset(parsed.stylePreset) ? parsed.stylePreset : undefined,
    };
  } catch {
    return {};
  }
}

function persistIllustrationOptions(options: StoredGalleryIllustrationOptions): void {
  try {
    window.localStorage.setItem(GALLERY_ILLUSTRATION_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* localStorage unavailable — silently degrade */
  }
}

const storedIllustrationOptions = readStoredIllustrationOptions();

interface GalleryState {
  /** Images pinned to the chat area as floating overlays */
  pinnedImages: ChatImage[];
  /** Gallery manual illustration: attach character/background reference images */
  includeImageReference: boolean;
  /** Gallery manual illustration: ComfyUI workflow steps override */
  comfySteps: GalleryComfySteps;
  /** Gallery manual illustration: art style preset override */
  stylePreset: GalleryIllustrationStylePresetId;
  pinImage: (image: ChatImage) => void;
  unpinImage: (imageId: string) => void;
  clearPinned: () => void;
  setIncludeImageReference: (value: boolean) => void;
  setComfySteps: (value: GalleryComfySteps) => void;
  setStylePreset: (value: GalleryIllustrationStylePresetId) => void;
}

export const useGalleryStore = create<GalleryState>((set) => ({
  pinnedImages: [],
  includeImageReference: storedIllustrationOptions.includeImageReference ?? true,
  comfySteps: storedIllustrationOptions.comfySteps ?? 8,
  stylePreset: storedIllustrationOptions.stylePreset ?? "game",

  pinImage: (image) =>
    set((s) => (s.pinnedImages.some((p) => p.id === image.id) ? s : { pinnedImages: [...s.pinnedImages, image] })),

  unpinImage: (imageId) => set((s) => ({ pinnedImages: s.pinnedImages.filter((p) => p.id !== imageId) })),

  clearPinned: () => set({ pinnedImages: [] }),

  setIncludeImageReference: (value) =>
    set((s) => {
      persistIllustrationOptions({
        includeImageReference: value,
        comfySteps: s.comfySteps,
        stylePreset: s.stylePreset,
      });
      return { includeImageReference: value };
    }),

  setComfySteps: (value) =>
    set((s) => {
      persistIllustrationOptions({
        includeImageReference: s.includeImageReference,
        comfySteps: value,
        stylePreset: s.stylePreset,
      });
      return { comfySteps: value };
    }),

  setStylePreset: (value) =>
    set((s) => {
      persistIllustrationOptions({
        includeImageReference: s.includeImageReference,
        comfySteps: s.comfySteps,
        stylePreset: value,
      });
      return { stylePreset: value };
    }),
}));
