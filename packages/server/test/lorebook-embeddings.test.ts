import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import type { LorebookEntry } from "@marinara-engine/shared";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { lorebookEntries, lorebooks } from "../src/db/schema/index.js";
import { createLorebooksStorage } from "../src/services/storage/lorebooks.storage.js";
import {
  buildLorebookEntryEmbeddingText,
  cosineSimilarity,
  semanticShortlistLorebookEntries,
  warmLorebookEntryEmbeddings,
} from "../src/services/lorebook/embeddings.js";

function makeEntry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id: "entry-1",
    lorebookId: "book-1",
    name: "Entry",
    content: "Lore entry content",
    description: "",
    keys: ["keyword"],
    secondaryKeys: [],
    enabled: true,
    constant: false,
    selective: false,
    selectiveLogic: "and",
    probability: null,
    scanDepth: null,
    matchWholeWords: false,
    caseSensitive: false,
    useRegex: false,
    characterFilterMode: "any",
    characterFilterIds: [],
    characterTagFilterMode: "any",
    characterTagFilters: [],
    generationTriggerFilterMode: "any",
    generationTriggerFilters: [],
    additionalMatchingSources: [],
    position: 0,
    depth: 4,
    order: 100,
    role: "system",
    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,
    group: "",
    groupWeight: null,
    folderId: null,
    locked: false,
    preventRecursion: false,
    tag: "",
    relationships: {},
    dynamicState: {},
    activationConditions: [],
    schedule: null,
    excludeFromVectorization: false,
    embedding: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function entryRow(id: string, overrides: Partial<typeof lorebookEntries.$inferInsert> = {}) {
  return {
    id,
    lorebookId: "book-1",
    folderId: null,
    name: id,
    content: "Lore entry content",
    description: "",
    keys: JSON.stringify(["keyword"]),
    secondaryKeys: "[]",
    enabled: "true",
    constant: "false",
    selective: "false",
    selectiveLogic: "and" as const,
    probability: null,
    scanDepth: null,
    matchWholeWords: "false",
    caseSensitive: "false",
    useRegex: "false",
    characterFilterMode: "any" as const,
    characterFilterIds: "[]",
    characterTagFilterMode: "any" as const,
    characterTagFilters: "[]",
    generationTriggerFilterMode: "any" as const,
    generationTriggerFilters: "[]",
    additionalMatchingSources: "[]",
    position: 0,
    depth: 4,
    order: 100,
    role: "system" as const,
    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,
    group: "",
    groupWeight: null,
    locked: "false",
    tag: "",
    relationships: "{}",
    dynamicState: "{}",
    activationConditions: "[]",
    schedule: null,
    preventRecursion: "false",
    excludeFromVectorization: "false",
    embedding: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedLorebook(db: DB) {
  await db.insert(lorebooks).values({
    id: "book-1",
    name: "World Info",
    description: "",
    category: "world",
    scanDepth: 2,
    tokenBudget: 2048,
    recursiveScanning: "false",
    maxRecursionDepth: 3,
    characterId: null,
    personaId: null,
    chatId: null,
    isGlobal: "true",
    enabled: "true",
    tags: "[]",
    generatedBy: null,
    sourceAgentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

test("buildLorebookEntryEmbeddingText includes name, description, keys, secondary keys, and content", () => {
  const text = buildLorebookEntryEmbeddingText(
    makeEntry({
      name: "Silverleaf Orchard",
      description: "A hidden place.",
      keys: ["silverleaf", "orchard"],
      secondaryKeys: ["moon gate"],
      content: "The orchard opens at midnight.",
    }),
  );

  assert.match(text, /Name: Silverleaf Orchard/);
  assert.match(text, /Description: A hidden place\./);
  assert.match(text, /Keys: silverleaf, orchard/);
  assert.match(text, /Secondary Keys: moon gate/);
  assert.match(text, /Content: The orchard opens at midnight\./);
});

test("warmLorebookEntryEmbeddings embeds only missing vectors and respects batch size", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;
  try {
    await runMigrations(db);
    await seedLorebook(db);
    await db.insert(lorebookEntries).values([
      entryRow("missing-a"),
      entryRow("missing-b"),
      entryRow("already", { embedding: "[9,9]" }),
    ]);

    const entries = (await createLorebooksStorage(db).listEntries("book-1")) as LorebookEntry[];
    let calls = 0;
    const result = await warmLorebookEntryEmbeddings(db, entries, {
      batchSize: 1,
      localEmbedder: async (texts) => {
        calls += 1;
        return texts.map(() => [1, 0]);
      },
    });

    assert.deepEqual(result, { attempted: 1, embedded: 1 });
    assert.equal(calls, 1);
    const rows = await db.select().from(lorebookEntries).where(eq(lorebookEntries.id, "missing-a"));
    assert.equal(rows[0]?.embedding, "[1,0]");
    const already = await db.select().from(lorebookEntries).where(eq(lorebookEntries.id, "already"));
    assert.equal(already[0]?.embedding, "[9,9]");
  } finally {
    client.close();
  }
});

test("semanticShortlistLorebookEntries ranks top-K and skips missing or mismatched vectors", async () => {
  const entries = [
    makeEntry({ id: "near", embedding: [1, 0] }),
    makeEntry({ id: "far", embedding: [0, 1] }),
    makeEntry({ id: "missing", embedding: null }),
    makeEntry({ id: "stale", embedding: [1, 0, 0] }),
  ];

  const matches = await semanticShortlistLorebookEntries(entries, "silverleaf", {
    topK: 1,
    localEmbedder: async () => [[1, 0]],
  });

  assert.deepEqual(matches?.map((match) => match.entry.id), ["near"]);
  assert.equal(matches?.[0]?.similarity, 1);
});

test("semanticShortlistLorebookEntries returns null when embeddings are unavailable", async () => {
  const result = await semanticShortlistLorebookEntries([makeEntry({ embedding: [1, 0] })], "query", {
    localEmbedder: async () => null,
  });

  assert.equal(result, null);
});

test("semanticShortlistLorebookEntries returns null when no stored entry vectors can be scored", async () => {
  const result = await semanticShortlistLorebookEntries(
    [
      makeEntry({ id: "missing", embedding: null }),
      makeEntry({ id: "stale", embedding: [1, 0, 0] }),
    ],
    "query",
    {
      localEmbedder: async () => [[1, 0]],
    },
  );

  assert.equal(result, null);
});

test("cosineSimilarity returns zero for empty or mismatched dimensions", () => {
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
});
