import assert from "node:assert/strict";
import test from "node:test";
import { generateCharacterSchedule } from "../src/services/conversation/schedule.service.js";
import {
  BaseLLMProvider,
  type ChatMessage,
  type ChatOptions,
  type LLMUsage,
} from "../src/services/llm/base-provider.js";

class RecordingProvider extends BaseLLMProvider {
  public lastOptions: ChatOptions | null = null;

  constructor(maxTokensOverride?: number | null) {
    super("http://example.test", "", undefined, null, maxTokensOverride);
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    void messages;
    this.lastOptions = options;
    yield JSON.stringify({
      talkativeness: 50,
      inactivityThresholdMinutes: 120,
      days: {},
    });
  }
}

test("schedule generation uses the connection max token override when configured", async () => {
  const provider = new RecordingProvider(16000);

  await generateCharacterSchedule(provider, "test-model", "Mari", "AI engineer", "brilliant");

  assert.equal(provider.lastOptions?.maxTokens, 16000);
});

test("schedule generation keeps the default max token budget without an override", async () => {
  const provider = new RecordingProvider(null);

  await generateCharacterSchedule(provider, "test-model", "Mari", "AI engineer", "brilliant");

  assert.equal(provider.lastOptions?.maxTokens, 8192);
});
