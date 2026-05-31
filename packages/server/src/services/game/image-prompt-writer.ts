// ──────────────────────────────────────────────
// Game-mode: Image Prompt Writer
// ──────────────────────────────────────────────
//
// Two-stage pipeline (extract-facts → compose-prompt) with single-shot
// fallback when the provider lacks json_schema support or stages fail.
//
// The function never throws — on any failure it returns `null` and the
// caller falls back to the original draft prompt.

import type { FastifyInstance } from "fastify";
import {
  BUILT_IN_AGENT_IDS,
  detectImageModelFamily,
  getImageModelFamilyInfo,
  PROVIDERS,
} from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { createAgentsStorage } from "../storage/agents.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import {
  runSingleShotRewrite,
  runTwoStagePipeline,
  supportsJsonSchema,
  type ImagePromptWriterPipelineSettings,
  type PipelineLlmConnection,
  type RewriteIllustrationPromptRequest,
} from "./image-prompt-pipeline.js";

export type { RewriteIllustrationPromptRequest };

const COMFYUI_FLUX_STYLE_GUIDE = getImageModelFamilyInfo("flux").promptStyleGuide;
const COMFYUI_FLUX_FAMILY_LABEL = "Flux 2 Klein / ComfyUI (natural-language)";

interface ParsedAgentSettings extends ImagePromptWriterPipelineSettings {
  extractConnectionId: string | null;
}

interface ResolvedAgentLlmConn {
  conn: {
    provider: string;
    apiKey: string | null;
    model: string;
    maxContext: number | null;
    openrouterProvider: string | null;
    maxTokensOverride: number | null;
  };
  baseUrl: string;
  source: "agent" | "default-agent" | "chat" | "extract-override";
  name: string;
}

function normalizeImageServiceHint(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isComfyUiImageConnection(imageConn: RewriteIllustrationPromptRequest["imageConn"]): boolean {
  const service = normalizeImageServiceHint(imageConn.imageService ?? imageConn.imageGenerationSource);
  if (service === "comfyui" || service === "runpod_comfyui") return true;
  const baseUrl = (imageConn.baseUrl ?? "").toLowerCase();
  return baseUrl.includes(":8188") || baseUrl.includes("comfyui");
}

function resolveRewriteStyleGuide(imageConn: RewriteIllustrationPromptRequest["imageConn"]): {
  family: string;
  label: string;
  styleGuide: string;
} {
  if (isComfyUiImageConnection(imageConn)) {
    return {
      family: "flux",
      label: COMFYUI_FLUX_FAMILY_LABEL,
      styleGuide: COMFYUI_FLUX_STYLE_GUIDE,
    };
  }
  const service = normalizeImageServiceHint(imageConn.imageService ?? imageConn.imageGenerationSource);
  const model = (imageConn.model ?? "").toLowerCase();
  const baseUrl = (imageConn.baseUrl ?? "").toLowerCase();
  const familyInfo = detectImageModelFamily({
    service,
    provider: imageConn.provider ?? null,
    model,
    baseUrl,
  });
  return {
    family: familyInfo.family,
    label: familyInfo.label,
    styleGuide: getImageModelFamilyInfo(familyInfo.family).promptStyleGuide,
  };
}

function parseAgentSettings(raw: unknown, connectionModel: string): ParsedAgentSettings {
  const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const maxTokens =
    typeof settings.maxTokens === "number" && settings.maxTokens > 0
      ? Math.min(8192, Math.max(256, Math.floor(settings.maxTokens)))
      : 4096;
  const composeTemperature =
    typeof settings.composeTemperature === "number" &&
    settings.composeTemperature >= 0 &&
    settings.composeTemperature <= 2
      ? settings.composeTemperature
      : typeof settings.temperature === "number" && settings.temperature >= 0 && settings.temperature <= 2
        ? settings.temperature
        : 0.45;
  const extractTemperature =
    typeof settings.extractTemperature === "number" &&
    settings.extractTemperature >= 0 &&
    settings.extractTemperature <= 2
      ? settings.extractTemperature
      : 0.2;
  const pipelineRetries =
    typeof settings.pipelineRetries === "number" && settings.pipelineRetries >= 1
      ? Math.min(5, Math.floor(settings.pipelineRetries))
      : 3;
  const extractModel =
    typeof settings.extractModel === "string" && settings.extractModel.trim()
      ? settings.extractModel.trim()
      : connectionModel;
  const composeModel =
    typeof settings.composeModel === "string" && settings.composeModel.trim()
      ? settings.composeModel.trim()
      : connectionModel;
  const extractConnectionId =
    typeof settings.extractConnectionId === "string" && settings.extractConnectionId.trim()
      ? settings.extractConnectionId.trim()
      : null;

  return {
    maxTokens,
    extractModel,
    composeModel,
    extractTemperature,
    composeTemperature,
    pipelineRetries,
    extractConnectionId,
  };
}

async function resolveAgentLlmConnection(
  app: FastifyInstance,
  agentConnectionId: string | null,
  chatConnectionId: string | null,
  explicitConnectionId: string | null = null,
): Promise<ResolvedAgentLlmConn | null> {
  const connections = createConnectionsStorage(app.db);

  type Candidate = { id: string; source: ResolvedAgentLlmConn["source"] };
  const candidates: Candidate[] = [];

  if (explicitConnectionId) {
    candidates.push({ id: explicitConnectionId, source: "extract-override" });
  } else {
    if (agentConnectionId) candidates.push({ id: agentConnectionId, source: "agent" });
    if (!agentConnectionId) {
      try {
        const defaultAgentConn = await connections.getDefaultForAgents();
        if (defaultAgentConn?.id) {
          candidates.push({ id: defaultAgentConn.id, source: "default-agent" });
        }
      } catch (err) {
        logger.warn(err, "[image-prompt-writer] failed to load default-for-agents connection");
      }
    }
    if (chatConnectionId) candidates.push({ id: chatConnectionId, source: "chat" });
  }

  for (const candidate of candidates) {
    const conn = await connections.getWithKey(candidate.id);
    if (!conn) continue;

    let baseUrl = conn.baseUrl;
    if (!baseUrl) {
      const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
      baseUrl = providerDef?.defaultBaseUrl ?? "";
    }
    if (!baseUrl && conn.provider === "claude_subscription") baseUrl = "claude-agent-sdk://local";
    if (!baseUrl && conn.provider === "openai_chatgpt") baseUrl = "openai-chatgpt://codex-auth";
    if (!baseUrl) continue;

    return {
      conn: {
        provider: conn.provider,
        apiKey: conn.apiKey ?? null,
        model: conn.model ?? "",
        maxContext: conn.maxContext ?? null,
        openrouterProvider: conn.openrouterProvider ?? null,
        maxTokensOverride: conn.maxTokensOverride ?? null,
      },
      baseUrl,
      source: candidate.source,
      name: conn.name ?? "",
    };
  }

  return null;
}

function toPipelineConnection(resolved: ResolvedAgentLlmConn): PipelineLlmConnection {
  return {
    provider: createLLMProvider(
      resolved.conn.provider,
      resolved.baseUrl,
      resolved.conn.apiKey ?? "",
      resolved.conn.maxContext,
      resolved.conn.openrouterProvider,
      resolved.conn.maxTokensOverride,
    ),
    providerName: resolved.conn.provider,
    baseUrl: resolved.baseUrl,
    model: resolved.conn.model,
    connectionName: resolved.name,
    source: resolved.source,
    openrouterProvider: resolved.conn.openrouterProvider,
  };
}

/**
 * Rewrite a draft scene-illustration prompt using the configured
 * image-prompt-writer agent. Returns the rewritten prompt or `null` when
 * the agent is disabled, misconfigured, or any error occurs (caller falls
 * back to the original draft).
 */
export async function rewriteIllustrationPrompt(req: RewriteIllustrationPromptRequest): Promise<string | null> {
  logger.info(
    "[image-prompt-writer] invoked: chatId=%s draftChars=%d service=%s/%s model=%s",
    req.chatId,
    req.draftPrompt?.length ?? 0,
    req.imageConn.imageService ?? req.imageConn.imageGenerationSource ?? "?",
    req.imageConn.provider ?? "?",
    req.imageConn.model ?? "?",
  );

  if (!req.draftPrompt?.trim()) {
    logger.info("[image-prompt-writer] empty draft prompt — skipping rewrite");
    return null;
  }

  let agentConnectionId: string | null = null;
  let agentPromptTemplate = "";
  let agentConfigId: string | null = null;
  let agentSettingsRaw: Record<string, unknown> = {};

  try {
    const agents = createAgentsStorage(req.app.db);
    const agentRow = await agents.getByType(BUILT_IN_AGENT_IDS.IMAGE_PROMPT_WRITER);
    if (!agentRow) {
      logger.info(
        "[image-prompt-writer] SKIPPED: no agent row in DB — open Agents panel and enable 'Image Prompt Writer' once to materialize it",
      );
      return null;
    }
    if (agentRow.enabled !== "true") {
      logger.info("[image-prompt-writer] SKIPPED: agent exists but is disabled (enable it in the Agents panel)");
      return null;
    }
    agentConfigId = agentRow.id;
    agentConnectionId = agentRow.connectionId ?? null;
    agentPromptTemplate = (agentRow.promptTemplate as string) || "";
    try {
      agentSettingsRaw = agentRow.settings ? JSON.parse(agentRow.settings as string) : {};
    } catch {
      agentSettingsRaw = {};
    }
  } catch (err) {
    logger.warn(err, "[image-prompt-writer] failed to load agent config — skipping rewrite");
    return null;
  }

  const composeResolved = await resolveAgentLlmConnection(
    req.app,
    agentConnectionId,
    req.chatConnectionId ?? null,
  );
  if (!composeResolved) {
    logger.warn(
      "[image-prompt-writer] SKIPPED: no LLM connection available (agent=%s, default-for-agents=fallback, chat=%s)",
      agentConnectionId ?? "null",
      req.chatConnectionId ?? "null",
    );
    return null;
  }

  const settings = parseAgentSettings(agentSettingsRaw, composeResolved.conn.model);

  let extractResolved = composeResolved;
  if (settings.extractConnectionId && settings.extractConnectionId !== agentConnectionId) {
    const override = await resolveAgentLlmConnection(
      req.app,
      null,
      null,
      settings.extractConnectionId,
    );
    if (override) {
      extractResolved = override;
    } else {
      logger.warn(
        "[image-prompt-writer] extractConnectionId=%s not found — using compose connection for both stages",
        settings.extractConnectionId,
      );
    }
  }

  const styleGuideInfo = resolveRewriteStyleGuide(req.imageConn);
  const rewriterRating = req.rating === "nsfw" ? "nsfw" : "sfw";
  const jailbreakOn = rewriterRating === "nsfw";
  const composeConn = toPipelineConnection(composeResolved);
  const extractConn = toPipelineConnection(extractResolved);

  logger.info(
    '[image-prompt-writer] pipeline config: family=%s extract="%s" (%s/%s) compose="%s" (%s/%s) [rating=%s, jailbreak=%s]',
    styleGuideInfo.family,
    extractResolved.name || "<unnamed>",
    extractResolved.conn.provider,
    settings.extractModel,
    composeResolved.name || "<unnamed>",
    composeResolved.conn.provider,
    settings.composeModel,
    rewriterRating,
    jailbreakOn ? "on" : "off",
  );

  const canUseTwoStage = supportsJsonSchema(extractConn.providerName, extractConn.baseUrl);

  try {
    if (canUseTwoStage) {
      return await runTwoStagePipeline({
        req,
        styleGuideInfo,
        extractConn,
        composeConn,
        settings,
        agentConfigId,
        rewriterRating,
        customAgentAddendum: agentPromptTemplate,
      });
    }

    logger.warn(
      "[image-prompt-writer] provider %s does not support json_schema — using single-shot fallback",
      extractConn.providerName,
    );
    return await runSingleShotRewrite({
      req,
      styleGuideInfo,
      conn: composeConn,
      settings: {
        maxTokens: settings.maxTokens,
        composeTemperature: settings.composeTemperature,
        composeModel: settings.composeModel,
      },
      agentConfigId,
      rewriterRating,
      customAgentAddendum: agentPromptTemplate,
    });
  } catch (pipelineErr) {
    if (styleGuideInfo.family === "flux") {
      logger.warn(
        pipelineErr,
        "[image-prompt-writer] two-stage flux pipeline failed — skipping un-audited single-shot fallback",
      );
      return null;
    }
    logger.warn(pipelineErr, "[image-prompt-writer] two-stage pipeline failed — trying single-shot fallback");
    try {
      return await runSingleShotRewrite({
        req,
        styleGuideInfo,
        conn: composeConn,
        settings: {
          maxTokens: settings.maxTokens,
          composeTemperature: settings.composeTemperature,
          composeModel: settings.composeModel,
        },
        agentConfigId,
        rewriterRating,
        customAgentAddendum: agentPromptTemplate,
      });
    } catch (fallbackErr) {
      logger.warn(fallbackErr, "[image-prompt-writer] single-shot fallback failed — using draft prompt");
      return null;
    }
  }
}
