import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext } from "@marinara-engine/shared";
import { runParallelAgents, type ResolvedAgent } from "../src/services/agents/agent-pipeline.js";
import {
  BaseLLMProvider,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatOptions,
} from "../src/services/llm/base-provider.js";

class RecordingProvider extends BaseLLMProvider {
  calls = 0;
  active = 0;
  maxActive = 0;

  constructor() {
    super("https://example.test/v1", "test-key");
  }

  async *chat(): AsyncGenerator<string, void, unknown> {
    yield "";
  }

  async chatComplete(messages: ChatMessage[], _options: ChatOptions): Promise<ChatCompletionResult> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 40));
    this.active -= 1;

    const systemPrompt = messages.map((message) => message.content).join("\n");
    const agentIds = Array.from(systemPrompt.matchAll(/<result agent="([^"]+)">/g)).map((match) => match[1]);
    return {
      content: agentIds.map((agentId) => `<result agent="${agentId}">ok ${agentId}</result>`).join("\n"),
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };
  }
}

const context: AgentContext = {
  chatId: "chat-parallel",
  chatMode: "roleplay",
  recentMessages: [{ role: "user", content: "hello" }],
  mainResponse: null,
  gameState: null,
  characters: [],
  persona: null,
  memory: {},
  activatedLorebookEntries: null,
  writableLorebookIds: null,
  chatSummary: null,
  streaming: false,
};

function makeAgent(index: number, provider: RecordingProvider): ResolvedAgent {
  return {
    id: `agent-${index}`,
    type: `agent-${index}`,
    name: `Agent ${index}`,
    phase: "parallel",
    promptTemplate: "Return a short text result.",
    connectionId: "conn-parallel",
    settings: {},
    provider,
    model: "test-model",
    maxParallelJobs: 2,
  };
}

test("agent pipeline splits same-connection work by max parallel jobs", async () => {
  const provider = new RecordingProvider();
  const agents = [1, 2, 3, 4].map((index) => makeAgent(index, provider));

  const results = await runParallelAgents(agents, context);

  assert.equal(provider.calls, 2);
  assert.equal(provider.maxActive, 2);
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.success));
});
