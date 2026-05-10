// ──────────────────────────────────────────────
// Spotify Service — stored OAuth credentials + Web API helpers
// ──────────────────────────────────────────────
import { logger } from "../../lib/logger.js";
import { decryptApiKey, encryptApiKey } from "../../utils/crypto.js";
import type { createAgentsStorage } from "../storage/agents.storage.js";

type AgentsStorage = ReturnType<typeof createAgentsStorage>;
type AgentConfigRow = Awaited<ReturnType<AgentsStorage["getById"]>>;

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-read-private",
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
].join(" ");

export interface SpotifyCredentialsResult {
  accessToken: string;
  agentId: string;
  clientId: string;
  expiresAt: number;
  scopes: string[];
}

export type SpotifyCredentialError = {
  status: number;
  error: string;
};

function isEncryptedToken(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 3 &&
    parts.every((part) => /^[0-9a-f]+$/i.test(part)) &&
    parts[0]?.length === 24 &&
    parts[2]?.length === 32
  );
}

export function decryptStoredToken(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const decrypted = decryptApiKey(value);
  return decrypted || (isEncryptedToken(value) ? "" : value);
}

function parseSettings(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function parseScopes(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [];
}

export function spotifyHasScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope);
}

async function findSpotifyAgent(storage: AgentsStorage, preferredAgentId?: string | null): Promise<AgentConfigRow> {
  if (preferredAgentId) {
    const byId = await storage.getById(preferredAgentId);
    if (byId?.type === "spotify") return byId;
  }

  return storage.getByType("spotify");
}

async function refreshSpotifyToken(args: {
  storage: AgentsStorage;
  agent: NonNullable<AgentConfigRow>;
  settings: Record<string, unknown>;
  refreshToken: string;
  clientId: string;
}): Promise<{ accessToken: string; expiresAt: number; scopes: string[] } | null> {
  const { storage, agent, settings, refreshToken, clientId } = args;

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    logger.warn("[spotify] refresh failed with status %d: %s", tokenRes.status, body.slice(0, 200));
    return null;
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  const nextRefreshToken = tokens.refresh_token ?? refreshToken;
  const scope = tokens.scope ?? (settings.spotifyScope as string | undefined) ?? "";

  await storage.update(agent.id, {
    settings: {
      ...settings,
      spotifyAccessToken: encryptApiKey(tokens.access_token),
      spotifyRefreshToken: nextRefreshToken ? encryptApiKey(nextRefreshToken) : null,
      spotifyExpiresAt: expiresAt,
      spotifyScope: scope,
    },
  });

  return { accessToken: tokens.access_token, expiresAt, scopes: parseScopes(scope) };
}

export async function resolveSpotifyCredentials(
  storage: AgentsStorage,
  options: { agentId?: string | null; refreshSkewMs?: number } = {},
): Promise<SpotifyCredentialsResult | SpotifyCredentialError> {
  const agent = await findSpotifyAgent(storage, options.agentId ?? null);
  if (!agent) {
    return { status: 404, error: "Spotify DJ agent is not configured." };
  }

  const settings = parseSettings(agent.settings);
  const refreshToken = decryptStoredToken(settings.spotifyRefreshToken);
  const clientId = typeof settings.spotifyClientId === "string" ? settings.spotifyClientId : "";
  let accessToken = decryptStoredToken(settings.spotifyAccessToken);
  let expiresAt = typeof settings.spotifyExpiresAt === "number" ? settings.spotifyExpiresAt : 0;
  let scopes = parseScopes(settings.spotifyScope);
  const refreshSkewMs = options.refreshSkewMs ?? 60_000;

  if (!refreshToken || !clientId) {
    return { status: 400, error: "Spotify is not connected. Open the Spotify DJ agent and connect your account." };
  }

  if (!accessToken || (expiresAt > 0 && Date.now() > expiresAt - refreshSkewMs)) {
    const refreshed = await refreshSpotifyToken({ storage, agent, settings, refreshToken, clientId });
    if (!refreshed) return { status: 502, error: "Spotify token refresh failed. Reconnect Spotify and try again." };
    accessToken = refreshed.accessToken;
    expiresAt = refreshed.expiresAt;
    scopes = refreshed.scopes;
  }

  if (!accessToken || (expiresAt > 0 && Date.now() > expiresAt)) {
    return { status: 401, error: "Spotify token expired. Reconnect Spotify and try again." };
  }

  return {
    accessToken,
    agentId: agent.id,
    clientId,
    expiresAt,
    scopes,
  };
}

export async function fetchSpotifyApi(
  credentials: SpotifyCredentialsResult,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${credentials.accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}
