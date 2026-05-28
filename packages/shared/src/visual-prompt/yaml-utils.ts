/** Strip markdown code fences and optional yaml header from LLM YAML output. */
export function stripCodeFences(raw: string): string {
  let cleaned = raw.trim();
  while (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }
  cleaned = cleaned.replace(/^yaml\s*\n/i, "").trim();
  return cleaned;
}
