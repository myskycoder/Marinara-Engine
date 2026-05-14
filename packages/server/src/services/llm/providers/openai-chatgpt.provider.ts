// ──────────────────────────────────────────────
// LLM Provider - OpenAI (ChatGPT login via Codex auth)
// ──────────────────────────────────────────────
import {
  BaseLLMProvider,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatOptions,
  type LLMUsage,
} from "../base-provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import {
  OPENAI_CHATGPT_CODEX_BASE_URL,
  buildOpenAIChatGPTHeaders,
  getOpenAIChatGPTAuth,
} from "../openai-chatgpt-auth.js";

/**
 * Routes OpenAI Responses API calls through the user's local Codex ChatGPT
 * login instead of an API key. The auth helper reads and refreshes the same
 * `auth.json` created by `codex login`.
 */
export class OpenAIChatGPTProvider extends BaseLLMProvider {
  override getProviderName(): string {
    return "openai-chatgpt";
  }

  private async delegate(): Promise<OpenAIProvider> {
    const auth = await getOpenAIChatGPTAuth();
    return new OpenAIProvider(
      OPENAI_CHATGPT_CODEX_BASE_URL,
      auth.accessToken,
      this.defaultMaxContext,
      this.defaultOpenrouterProvider,
      this.maxTokensOverride,
      "openai-chatgpt",
      buildOpenAIChatGPTHeaders(auth),
    );
  }

  override async *_doChat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const provider = await this.delegate();
    return yield* provider._doChat(messages, options);
  }

  override async _doChatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    const provider = await this.delegate();
    return provider._doChatComplete(messages, options);
  }
}
