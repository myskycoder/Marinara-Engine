import test from "node:test";
import assert from "node:assert/strict";
import { resolveMacros, type MacroContext } from "@marinara-engine/shared";
import { applyRegexScriptsToPromptText } from "../src/services/regex/regex-application.js";

function macroContext(): MacroContext {
  return {
    user: "Rhea",
    char: "Ari",
    characters: ["Ari"],
    variables: {},
  };
}

function resolvePromptMacros(value: string): string {
  return resolveMacros(value, macroContext(), { trimResult: false });
}

test("regex prompt application resolves macros in find, replace, and trim strings", () => {
  const result = applyRegexScriptsToPromptText(
    "Hello Ari!",
    [
      {
        enabled: true,
        placement: ["ai_output"],
        promptOnly: true,
        findRegex: "{{char}}",
        replaceString: "{{user}}",
        flags: "g",
        trimStrings: ["Hello {{user}}"],
      },
    ],
    "ai_output",
    0,
    { resolveMacros: resolvePromptMacros },
  );

  assert.equal(result, "!");
});

test("regex replacement macros resolve once per matched replacement", () => {
  let replacementCalls = 0;
  const result = applyRegexScriptsToPromptText(
    "Ari Ari",
    [
      {
        enabled: true,
        placement: ["ai_output"],
        promptOnly: true,
        findRegex: "{{char}}",
        replaceString: "{{random}}",
        flags: "g",
      },
    ],
    "ai_output",
    0,
    {
      resolveMacros: (value) => {
        if (value === "{{char}}") return "Ari";
        if (value === "{{random}}") return String(++replacementCalls);
        return value;
      },
    },
  );

  assert.equal(result, "1 2");
  assert.equal(replacementCalls, 2);
});

test("regex replacement macros can share state across matched replacements", () => {
  const ctx = macroContext();
  const result = applyRegexScriptsToPromptText(
    "TOKEN TOKEN TOKEN",
    [
      {
        enabled: true,
        placement: ["ai_output"],
        promptOnly: true,
        findRegex: "TOKEN",
        replaceString: "[{{incvar::rx_smoke}}/{{getvar::rx_smoke}}]",
        flags: "g",
      },
    ],
    "ai_output",
    0,
    { resolveMacros: (value) => resolveMacros(value, ctx, { trimResult: false }) },
  );

  assert.equal(result, "[/1] [/2] [/3]");
});

test("regex prompt application skips visual-only scripts", () => {
  const result = applyRegexScriptsToPromptText(
    "Visible [secret] prompt",
    [
      {
        enabled: true,
        placement: ["ai_output"],
        promptOnly: false,
        findRegex: "\\[secret\\]",
        replaceString: "[redacted]",
        flags: "g",
      },
      {
        enabled: true,
        placement: ["ai_output"],
        promptOnly: true,
        findRegex: "prompt",
        replaceString: "context",
        flags: "g",
      },
    ],
    "ai_output",
    0,
  );

  assert.equal(result, "Visible [secret] context");
});
