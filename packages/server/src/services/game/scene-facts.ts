// ──────────────────────────────────────────────
// Scene facts schema + validation (image-prompt pipeline stage 1)
// ──────────────────────────────────────────────

export interface SceneFactsCharacter {
  name: string;
  hair: string;
  outfit: string;
  garment_state: string;
  expression: string;
  pose: string;
}

export interface SceneFacts {
  pov: "first_person" | "third_person";
  protagonist_visible: boolean;
  visible_body_parts: string[];
  characters: SceneFactsCharacter[];
  action: string;
  location_id: string;
  location_label: string;
  props: string[];
  lighting: string;
  time_weather: string;
  offscreen: string[];
  mirror_shows: string;
  nsfw: boolean;
}

export const SCENE_FACTS_JSON_SCHEMA = {
  name: "scene_facts",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pov: { type: "string", enum: ["first_person", "third_person"] },
      protagonist_visible: { type: "boolean" },
      visible_body_parts: { type: "array", items: { type: "string" } },
      characters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            hair: { type: "string" },
            outfit: { type: "string" },
            garment_state: { type: "string" },
            expression: { type: "string" },
            pose: { type: "string" },
          },
          required: ["name", "hair", "outfit", "garment_state", "expression", "pose"],
        },
      },
      action: { type: "string" },
      location_id: { type: "string" },
      location_label: { type: "string" },
      props: { type: "array", items: { type: "string" } },
      lighting: { type: "string" },
      time_weather: { type: "string" },
      offscreen: { type: "array", items: { type: "string" } },
      mirror_shows: { type: "string" },
      nsfw: { type: "boolean" },
    },
    required: [
      "pov",
      "protagonist_visible",
      "visible_body_parts",
      "characters",
      "action",
      "location_id",
      "location_label",
      "props",
      "lighting",
      "time_weather",
      "offscreen",
      "mirror_shows",
      "nsfw",
    ],
  },
} as const;

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
  }
  return cleaned;
}

/** Parse the extractor JSON, tolerant of code fences and surrounding text. */
export function parseFactsJson(raw: string): SceneFacts {
  let text = stripCodeFences(raw);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(text) as SceneFacts;
}

/** Throw when required visual facts are missing. */
export function validateFacts(facts: unknown): SceneFacts {
  if (!facts || typeof facts !== "object") {
    throw new Error("facts is not an object");
  }
  const record = facts as SceneFacts;
  if (!Array.isArray(record.characters) || record.characters.length === 0) {
    throw new Error("facts.characters is empty");
  }
  if (!record.action || !String(record.action).trim()) {
    throw new Error("facts.action is empty");
  }
  if (!record.location_label || !String(record.location_label).trim()) {
    throw new Error("facts.location_label is empty");
  }
  if (!record.pov || !String(record.pov).trim()) {
    throw new Error("facts.pov is empty");
  }
  return record;
}
