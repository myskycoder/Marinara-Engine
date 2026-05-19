// ──────────────────────────────────────────────
// Synthetic Claude Code session-file lifecycle
// ──────────────────────────────────────────────
//
// Writes a temp `~/.claude/projects/<cwd-as-dashes>/<uuid>.jsonl` so the
// Claude Agent SDK's `resume: <sessionId>` option reads Marinara's
// `ChatMessage[]` history as real multi-turn context. The provider calls
// `constructSessionFile()` before its `query()` call and `cleanupSessionFile()`
// in a finally block; `cleanupOrphanedSessions()` is a boot-time sweep for
// files left behind by crashes or hard aborts.
//
// Linux/macOS only. The provider gates `process.platform !== "win32"` before
// reaching this module; if a Windows caller does slip through, the path
// derivation still returns a value, but CC's actual project-dir convention
// on Windows is unverified.

import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../../base-provider.js";
import { logger } from "../../../../lib/logger.js";
import {
  buildAssistantEntry,
  buildUserEntry,
  SDK_VERSION,
  serializeEntries,
  type CommonSessionMeta,
  type SyntheticEntry,
} from "./jsonl-entries.js";

const HOME = homedir();
const CWD = resolve(".");

/**
 * Compute the sessions directory for a given cwd. CC maps cwd → project
 * subdirectory by replacing every "/" with "-"; this mirrors that exactly
 * so `resume` reads from the same location the CLI would write to.
 */
export function sessionsDirFor(cwd: string = CWD): string {
  return join(HOME, ".claude", "projects", cwd.replaceAll("/", "-"));
}

const SESSIONS_DIR = sessionsDirFor();

export interface ConstructResult {
  sessionId: string;
  path: string;
}

export interface ConstructOptions {
  /** Model name to stamp on assistant entries. */
  model: string;
  /** Permission mode stamp for user entries. Defaults to `bypassPermissions`. */
  permissionMode?: string;
  /** SDK version stamp. Defaults to "unknown" when not detectable. */
  sdkVersion?: string;
  /** Override the working directory used both for the entry's `cwd` field and
   *  for resolving the sessions directory. Defaults to `resolve(".")` captured
   *  at module load. Callers in non-standard launch environments (electron
   *  sidecar, packaged installs) should pass their project root explicitly. */
  cwd?: string;
  /** Override the sessions directory. Tests use this to write to a temp path
   *  instead of the user's real `~/.claude/projects/...` location. */
  sessionsDir?: string;
  /** Override the git branch detection. Tests use this to skip the spawn.
   *  Defaults to running `git symbolic-ref --short HEAD`. */
  gitBranch?: string;
}

function isErrnoCode(err: unknown, code: string): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === code;
}

export async function constructSessionFile(
  history: readonly ChatMessage[],
  options: ConstructOptions,
): Promise<ConstructResult> {
  // Defense-in-depth: provider-level gate is the primary check, but a direct
  // import of this module on Windows should also fail loudly rather than
  // silently producing an unrecognised project-dir path.
  if (process.platform === "win32") {
    throw new Error(
      "[claude-subscription/jsonl] synthetic sessions are not supported on win32; provider should fall back to transcript-fold",
    );
  }
  const sessionId = randomUUID();
  const cwd = options.cwd ?? CWD;
  const dir = options.sessionsDir ?? sessionsDirFor(cwd);
  const meta: CommonSessionMeta = {
    sessionId,
    cwd,
    version: options.sdkVersion ?? SDK_VERSION,
    gitBranch: options.gitBranch ?? (await detectGitBranch(cwd)),
    permissionMode: options.permissionMode ?? "bypassPermissions",
  };

  const entries = assembleEntries(history, meta, options.model);
  const path = join(dir, `${sessionId}.jsonl`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, serializeEntries(entries), "utf8");
  return { sessionId, path };
}

/**
 * Build the parent-uuid-chained entry list. System messages are excluded —
 * they ride the SDK's `systemPrompt` option, not the JSONL. Each entry
 * points its `parentUuid` at the prior entry's `uuid` so the SDK can walk
 * the conversation back to its root.
 */
export function assembleEntries(
  history: readonly ChatMessage[],
  meta: CommonSessionMeta,
  model: string,
): SyntheticEntry[] {
  const entries: SyntheticEntry[] = [];
  let parentUuid: string | null = null;

  for (const m of history) {
    if (m.role === "system") continue;

    if (m.role === "user" || m.role === "tool") {
      const entry = buildUserEntry({ message: m, parentUuid, meta });
      entries.push(entry);
      parentUuid = entry.uuid;
    } else if (m.role === "assistant") {
      const entry = buildAssistantEntry({ message: m, parentUuid, meta, model });
      entries.push(entry);
      parentUuid = entry.uuid;
    }
  }
  return entries;
}

/**
 * Delete a synthetic session file by path. Callers pass `ConstructResult.path`
 * directly — taking a `(sessionId, dir)` pair instead would re-introduce the
 * implicit contract that `dir` must match whatever `sessionsDir` override
 * `constructSessionFile` saw, which is easy to forget and would leak files.
 */
export async function cleanupSessionFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if (isErrnoCode(err, "ENOENT")) return;
    logger.error(err, "[claude-subscription/jsonl] cleanup failed for %s", path);
    throw err;
  }
}

export async function cleanupOrphanedSessions(
  maxAgeMs: number,
  now: number = Date.now(),
  dir: string = SESSIONS_DIR,
): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isErrnoCode(err, "ENOENT")) return 0;
    // Best-effort sweep: never fail server boot on a readdir error. Diverges
    // from `claude-openai-proxy` (which throws here) because that codebase
    // calls the sweep mid-request, where we call it once at startup.
    logger.warn(err, "[claude-subscription/jsonl] orphan sweep readdir failed for %s", dir);
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    try {
      const s = await stat(path);
      if (now - s.mtimeMs <= maxAgeMs) continue;
      await unlink(path);
      removed++;
    } catch (err) {
      // Race: another sweep / process may have removed the file between stat and unlink.
      if (isErrnoCode(err, "ENOENT")) continue;
      logger.warn(err, "[claude-subscription/jsonl] orphan sweep skip for %s", path);
    }
  }
  return removed;
}

// Best-effort git branch detection for the entry metadata stamp. The SDK
// doesn't validate this field, so any fallback is acceptable.
function detectGitBranch(cwd: string): Promise<string> {
  return new Promise<string>((resolveFn) => {
    let stdout = "";
    let settled = false;
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      resolveFn(value);
    };
    try {
      const proc = spawn("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      proc.on("error", () => finish("main"));
      proc.on("close", (code) => {
        if (code === 0) {
          const trimmed = stdout.trim();
          finish(trimmed.length > 0 ? trimmed : "main");
        } else {
          finish("main");
        }
      });
    } catch {
      finish("main");
    }
  });
}
