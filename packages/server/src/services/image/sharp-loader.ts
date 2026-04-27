// ──────────────────────────────────────────────
// sharp loader
// ──────────────────────────────────────────────
//
// `sharp` is an optional native dependency: prebuilds aren't published for
// every platform we ship to (e.g. Termux/Android). The server must boot
// without it; routes that need image processing (sprite background removal,
// sprite generation) instead surface a clear error string when sharp is
// missing.
//
// Three call sites used to keep their own copy of this lazy-loader. They all
// did the same thing — module-level cache, module-level error cache, dynamic
// `await import("sharp")` with `// @ts-ignore` to silence tsc on platforms
// where the package isn't installed. Centralizing keeps the caching coherent
// (only one in-process instance) and the error message uniform.

// `sharp` ships its own types, but installing them is gated on the native
// build succeeding, so we model the function as a permissive `any` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SharpFn = any;

let cachedSharp: SharpFn | null = null;
let cachedLoadError: Error | null = null;

const DEFAULT_UNAVAILABLE_MESSAGE =
  "Image processing is unavailable on this platform (native 'sharp' module could not be loaded). " +
  "Sprite generation and background removal are disabled.";

/**
 * Returns the cached `sharp` factory, importing it on first call. Throws a
 * stable error (`DEFAULT_UNAVAILABLE_MESSAGE`, falling back to the underlying
 * cause) if the import fails — both the success and failure are cached so
 * subsequent callers don't repeatedly re-attempt the dynamic import.
 */
export async function getSharp(): Promise<SharpFn> {
  if (cachedSharp) return cachedSharp;
  if (cachedLoadError) throw cachedLoadError;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional native dep, may not be installed on some platforms
    const mod = await import("sharp");
    cachedSharp = (mod.default ?? mod) as SharpFn;
    return cachedSharp;
  } catch (err) {
    cachedLoadError =
      err instanceof Error && err.message ? err : new Error(DEFAULT_UNAVAILABLE_MESSAGE);
    throw cachedLoadError;
  }
}

/**
 * Probe variant — never throws. Useful for /capabilities endpoints that want
 * to advertise whether sprite generation is available without surfacing the
 * error to the client.
 */
export async function isSharpAvailable(): Promise<boolean> {
  try {
    await getSharp();
    return true;
  } catch {
    return false;
  }
}
