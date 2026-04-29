interface BuildImpersonateInstructionArgs {
  customPrompt?: unknown;
  direction?: string | null;
  personaName?: string | null;
  personaDescription?: string | null;
}

const LEGACY_IMPERSONATION_DIRECTION_RE =
  /^\[Impersonation instruction (?:\u2014|-) write \{\{user\}\}'s next response, steering it toward the following:\s*([\s\S]+?)\]$/;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDirection(direction: string | null | undefined): string {
  const rawDirection = normalizeText(direction);
  const legacyDirectionMatch = rawDirection.match(LEGACY_IMPERSONATION_DIRECTION_RE);
  return legacyDirectionMatch ? legacyDirectionMatch[1]!.trim() : rawDirection;
}

function punctuateDirection(direction: string): string {
  const trimmed = direction.trim();
  if (!trimmed) return "";

  const lastChar = trimmed[trimmed.length - 1];
  return lastChar && ".!?)]}\"'".includes(lastChar) ? trimmed : `${trimmed}.`;
}

function buildCustomImpersonateInstruction(customPrompt: string, direction: string): string {
  if (!direction) return customPrompt;
  return `${customPrompt} ${punctuateDirection(direction)}`;
}

export function buildImpersonateInstruction({
  customPrompt,
  direction,
  personaName,
  personaDescription,
}: BuildImpersonateInstructionArgs): string {
  const normalizedCustomPrompt = normalizeText(customPrompt);
  const impersonationDirection = normalizeDirection(direction);
  const personaLabel = normalizeText(personaName) || "{{user}}";

  if (normalizedCustomPrompt) {
    const resolvedCustomPrompt = normalizedCustomPrompt.replaceAll("{{user}}", personaLabel);
    return buildCustomImpersonateInstruction(resolvedCustomPrompt, impersonationDirection);
  }

  const description = normalizeText(personaDescription);

  return [
    `<instruction>`,
    `You are now writing as ${personaLabel}, the user's character.`,
    `Study ${personaLabel}'s previous messages in the conversation and replicate their voice, mannerisms, speech patterns, and style as closely as possible.`,
    description ? `Character description: ${description}` : "",
    impersonationDirection ? `Additional direction for this reply: ${impersonationDirection}` : "",
    `Write a single in-character response from ${personaLabel}'s perspective. Do NOT break character or add meta-commentary. Respond exactly as ${personaLabel} would.`,
    `</instruction>`,
  ]
    .filter(Boolean)
    .join("\n");
}
