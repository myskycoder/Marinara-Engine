// ──────────────────────────────────────────────
// Game: Audio Manager
//
// Handles music playback with crossfade, SFX,
// and ambient sound layers. Uses Web Audio API
// for smooth transitions.
// ──────────────────────────────────────────────

const CROSSFADE_MS = 2000;
const SFX_POOL_SIZE = 8;

/** Release an audio element without triggering an "Invalid URI" console error. */
function releaseAudio(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

/** Singleton audio manager for game mode. */
class GameAudioManager {
  private musicElement: HTMLAudioElement | null = null;
  private nextMusicElement: HTMLAudioElement | null = null;
  private ambientElement: HTMLAudioElement | null = null;
  private sfxPool: HTMLAudioElement[] = [];
  private sfxIndex = 0;
  private musicVolume = 0.5;
  private sfxVolume = 0.5;
  private ambientVolume = 0.35;
  private isMuted = false;
  private currentMusicTag: string | null = null;
  private currentAmbientTag: string | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  /** Tracks tags whose play() was rejected by autoplay policy. */
  private pendingMusic: { tag: string; manifest?: Record<string, { path: string }> | null } | null = null;
  private pendingAmbient: { tag: string; manifest?: Record<string, { path: string }> | null } | null = null;
  private gestureListenerAttached = false;
  /** True after the user has interacted with the page (click/touch/key). */
  private userHasInteracted = false;
  private interactionListenerAttached = false;

  constructor() {
    // Pre-create SFX pool
    for (let i = 0; i < SFX_POOL_SIZE; i++) {
      const el = new Audio();
      el.preload = "auto";
      this.sfxPool.push(el);
    }
    this.attachInteractionListener();
  }

  /** Track user interaction so we know autoplay is allowed. */
  private attachInteractionListener(): void {
    if (this.interactionListenerAttached) return;
    this.interactionListenerAttached = true;
    const handler = () => {
      this.userHasInteracted = true;
      document.removeEventListener("click", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", handler, true);
      document.removeEventListener("pointerdown", handler, true);
      // Retry any pending audio now that the user has interacted
      this.retryPending();
    };
    document.addEventListener("click", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", handler, true);
    document.addEventListener("pointerdown", handler, true);
  }

  /** Attach a one-time user gesture listener to retry blocked audio. */
  private ensureGestureListener(): void {
    if (this.gestureListenerAttached) return;
    this.gestureListenerAttached = true;
    const handler = () => {
      document.removeEventListener("click", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", handler, true);
      document.removeEventListener("pointerdown", handler, true);
      this.gestureListenerAttached = false;
      this.retryPending();
    };
    document.addEventListener("click", handler, true);
    document.addEventListener("touchstart", handler, true);
    document.addEventListener("keydown", handler, true);
    document.addEventListener("pointerdown", handler, true);
  }

  /** Retry any autoplay-blocked audio. Call from a user gesture for best results. */
  retryPending(): void {
    if (this.pendingMusic) {
      const { tag, manifest } = this.pendingMusic;
      this.pendingMusic = null;
      this.currentMusicTag = null;
      this.playMusic(tag, manifest);
    }
    if (this.pendingAmbient) {
      const { tag, manifest } = this.pendingAmbient;
      this.pendingAmbient = null;
      this.currentAmbientTag = null;
      this.playAmbient(tag, manifest);
    }
  }

  /** Resolve an asset tag to a URL. */
  private resolveUrl(tag: string): string {
    // Tag format: "category:subcategory:name" → path: "category/subcategory/name.*"
    // The manifest stores the full relative path with extension
    // For now, convert tag colons to slashes
    const path = tag.replace(/:/g, "/");
    return `/api/game-assets/file/${path}`;
  }

  /** Try to find the full path from manifest, falling back to tag-based URL. */
  resolveAssetUrl(tag: string, manifest?: Record<string, { path: string }> | null): string {
    if (manifest && manifest[tag]) {
      return `/api/game-assets/file/${manifest[tag]!.path}`;
    }
    return this.resolveUrl(tag);
  }

  /** Play background music with crossfade. */
  playMusic(tag: string, manifest?: Record<string, { path: string }> | null): void {
    if (tag === this.currentMusicTag) return;
    const previousMusicTag = this.currentMusicTag;
    this.currentMusicTag = tag;

    // Defer playback if the user hasn't interacted yet (avoids autoplay warnings)
    if (!this.userHasInteracted) {
      this.pendingMusic = { tag, manifest };
      return;
    }

    const url = this.resolveAssetUrl(tag, manifest);
    const newAudio = new Audio(url);
    newAudio.loop = true;
    newAudio.volume = 0;
    newAudio.muted = this.isMuted;

    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    const oldAudio = this.musicElement;
    if (this.nextMusicElement && this.nextMusicElement !== oldAudio) {
      releaseAudio(this.nextMusicElement);
      this.nextMusicElement = null;
    }
    if (oldAudio) {
      oldAudio.volume = this.isMuted ? 0 : this.musicVolume;
      oldAudio.muted = this.isMuted;
    }
    this.nextMusicElement = newAudio;

    newAudio
      .play()
      .then(() => {
        if (this.nextMusicElement !== newAudio) {
          releaseAudio(newAudio);
          return;
        }
        // Playback started — clear any pending retry
        this.pendingMusic = null;
        const steps = CROSSFADE_MS / 50;
        const fadeStep = this.musicVolume / steps;
        let step = 0;

        const interval = setInterval(() => {
          if (this.nextMusicElement !== newAudio) {
            clearInterval(interval);
            if (this.fadeInterval === interval) this.fadeInterval = null;
            releaseAudio(newAudio);
            return;
          }

          step++;
          // Fade in new
          newAudio.volume = Math.min(this.isMuted ? 0 : this.musicVolume, fadeStep * step);
          // Fade out old
          if (oldAudio) {
            oldAudio.volume = Math.max(0, (this.isMuted ? 0 : this.musicVolume) - fadeStep * step);
          }

          if (step >= steps) {
            clearInterval(interval);
            if (this.fadeInterval === interval) this.fadeInterval = null;
            if (oldAudio) {
              releaseAudio(oldAudio);
            }
            this.musicElement = newAudio;
            this.nextMusicElement = null;
          }
        }, 50);

        this.fadeInterval = interval;
      })
      .catch(() => {
        if (this.nextMusicElement !== newAudio) {
          releaseAudio(newAudio);
          return;
        }

        this.nextMusicElement = null;
        releaseAudio(newAudio);

        // Autoplay blocked — queue for retry on user gesture
        this.pendingMusic = { tag, manifest };
        this.currentMusicTag = previousMusicTag;
        if (oldAudio) {
          oldAudio.volume = this.isMuted ? 0 : this.musicVolume;
          oldAudio.muted = this.isMuted;
        }
        this.ensureGestureListener();
      });
  }

  /** Stop music with fade out. */
  stopMusic(): void {
    this.currentMusicTag = null;
    this.pendingMusic = null;

    // Cancel any running crossfade so the next-element doesn't keep playing
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    if (this.nextMusicElement) {
      releaseAudio(this.nextMusicElement);
      this.nextMusicElement = null;
    }

    if (!this.musicElement) return;

    const audio = this.musicElement;
    this.musicElement = null;
    const steps = CROSSFADE_MS / 50;
    const fadeStep = audio.volume / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      audio.volume = Math.max(0, audio.volume - fadeStep);
      if (step >= steps) {
        clearInterval(interval);
        releaseAudio(audio);
      }
    }, 50);
  }

  /** Play a one-shot sound effect. */
  playSfx(tag: string, manifest?: Record<string, { path: string }> | null): void {
    if (this.isMuted || this.sfxVolume <= 0 || !this.userHasInteracted) return;
    const url = this.resolveAssetUrl(tag, manifest);
    const audio = this.sfxPool[this.sfxIndex % SFX_POOL_SIZE]!;
    this.sfxIndex++;
    audio.src = url;
    audio.volume = this.sfxVolume;
    audio.muted = false;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  /** Set looping ambient sound. */
  playAmbient(tag: string, manifest?: Record<string, { path: string }> | null): void {
    if (tag === this.currentAmbientTag) return;
    const previousAmbientTag = this.currentAmbientTag;
    const previousAmbient = this.ambientElement;
    this.currentAmbientTag = tag;

    // Defer playback if the user hasn't interacted yet (avoids autoplay warnings)
    if (!this.userHasInteracted) {
      this.pendingAmbient = { tag, manifest };
      return;
    }

    const url = this.resolveAssetUrl(tag, manifest);
    const nextAmbient = new Audio(url);
    nextAmbient.loop = true;
    nextAmbient.volume = this.isMuted ? 0 : this.ambientVolume;
    nextAmbient.muted = this.isMuted;
    nextAmbient
      .play()
      .then(() => {
        if (this.currentAmbientTag !== tag) {
          releaseAudio(nextAmbient);
          return;
        }

        if (previousAmbient && previousAmbient !== nextAmbient) {
          releaseAudio(previousAmbient);
        }
        this.ambientElement = nextAmbient;
        this.pendingAmbient = null;
      })
      .catch((err) => {
        releaseAudio(nextAmbient);
        if (this.currentAmbientTag !== tag) {
          return;
        }

        console.warn("[audio] Ambient playback failed:", tag, err);
        this.pendingAmbient = { tag, manifest };
        this.currentAmbientTag = previousAmbientTag;
        this.ambientElement = previousAmbient ?? null;
        if (previousAmbient) {
          previousAmbient.volume = this.isMuted ? 0 : this.ambientVolume;
          previousAmbient.muted = this.isMuted;
        }
        this.ensureGestureListener();
      });
  }

  /** Stop ambient sound. */
  stopAmbient(): void {
    this.currentAmbientTag = null;
    this.pendingAmbient = null;
    if (this.ambientElement) {
      releaseAudio(this.ambientElement);
      this.ambientElement = null;
    }
  }

  /** Set global mute state. */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.musicElement) {
      this.musicElement.volume = muted ? 0 : this.musicVolume;
      this.musicElement.muted = muted;
    }
    if (this.nextMusicElement) {
      this.nextMusicElement.volume = muted ? 0 : this.musicVolume;
      this.nextMusicElement.muted = muted;
    }
    if (this.ambientElement) {
      this.ambientElement.volume = muted ? 0 : this.ambientVolume;
      this.ambientElement.muted = muted;
    }
    // Mute any currently-playing SFX
    for (const el of this.sfxPool) {
      el.muted = muted;
    }
  }

  /** Set volume levels (0–1). */
  setVolumes(music: number, sfx: number, ambient: number): void {
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.sfxVolume = Math.max(0, Math.min(1, sfx));
    this.ambientVolume = Math.max(0, Math.min(1, ambient));
    if (!this.isMuted) {
      if (this.musicElement) this.musicElement.volume = this.musicVolume;
      if (this.ambientElement) this.ambientElement.volume = this.ambientVolume;
    }
    for (const el of this.sfxPool) {
      el.volume = this.sfxVolume;
    }
  }

  /** Stop everything and clean up. */
  dispose(): void {
    this.stopMusic();
    this.stopAmbient();
    for (const el of this.sfxPool) {
      releaseAudio(el);
    }
  }

  /** Get current playback state. */
  getState() {
    return {
      musicTag: this.currentMusicTag,
      ambientTag: this.currentAmbientTag,
      isMuted: this.isMuted,
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume,
      ambientVolume: this.ambientVolume,
    };
  }
}

/** Global singleton instance. */
export const audioManager = new GameAudioManager();
