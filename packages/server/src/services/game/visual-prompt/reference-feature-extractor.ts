/** Phase 3 stub: VLM reference image feature extraction (not wired to live VLM yet). */
export interface ReferenceFeatureTokens {
  face_tokens: string[];
  style_tokens: string[];
}

export function extractReferenceFeatureTokens(_referenceImagePaths: string[]): ReferenceFeatureTokens {
  return { face_tokens: [], style_tokens: [] };
}

export function mergeReferenceTokensIntoSubject(
  subjectTokens: string[],
  features: ReferenceFeatureTokens,
): string[] {
  return [...new Set([...features.face_tokens, ...subjectTokens])].slice(0, 8);
}
