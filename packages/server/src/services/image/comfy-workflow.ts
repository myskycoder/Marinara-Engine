export interface ComfyWorkflowRequestFields {
  comfyWorkflow?: string;
  comfyWorkflowWithReference?: string;
  comfyWorkflowWithNegative?: string;
  comfyWorkflowSplitReference?: string;
  referenceImage?: string;
  referenceImages?: string[];
  /** When true and comfyWorkflowWithNegative is set, prefer CFG negative workflow for NSFW. */
  preferNegativeWorkflow?: boolean;
  /** When true and comfyWorkflowSplitReference is set, use face+body split reference workflow. */
  preferSplitReference?: boolean;
}

export function hasComfyReferenceImage(request: Pick<ComfyWorkflowRequestFields, "referenceImage" | "referenceImages">): boolean {
  return Boolean(request.referenceImage || (request.referenceImages && request.referenceImages.length > 0));
}

/** Pick the ComfyUI workflow JSON string for the current request. */
export function resolveActiveComfyWorkflow(request: ComfyWorkflowRequestFields): string | undefined {
  const hasReference = hasComfyReferenceImage(request);
  if (hasReference) {
    if (request.preferSplitReference && request.comfyWorkflowSplitReference?.trim()) {
      return request.comfyWorkflowSplitReference;
    }
    if (request.preferNegativeWorkflow && request.comfyWorkflowWithNegative?.trim()) {
      return request.comfyWorkflowWithNegative;
    }
    return request.comfyWorkflowWithReference ?? request.comfyWorkflow;
  }
  return request.comfyWorkflow ?? request.comfyWorkflowWithReference;
}

/** Map connection-stored workflow fields onto an ImageGenRequest spread. */
export function comfyWorkflowFieldsFromConnection(conn: {
  comfyuiWorkflow?: string | null;
  comfyuiWorkflowWithReference?: string | null;
  comfyuiWorkflowWithNegative?: string | null;
  comfyuiSplitReferenceWorkflow?: string | null;
}): {
  comfyWorkflow?: string;
  comfyWorkflowWithReference?: string;
  comfyWorkflowWithNegative?: string;
  comfyWorkflowSplitReference?: string;
} {
  const fields: {
    comfyWorkflow?: string;
    comfyWorkflowWithReference?: string;
    comfyWorkflowWithNegative?: string;
    comfyWorkflowSplitReference?: string;
  } = {};
  if (conn.comfyuiWorkflow) fields.comfyWorkflow = conn.comfyuiWorkflow;
  if (conn.comfyuiWorkflowWithReference) fields.comfyWorkflowWithReference = conn.comfyuiWorkflowWithReference;
  if (conn.comfyuiWorkflowWithNegative) fields.comfyWorkflowWithNegative = conn.comfyuiWorkflowWithNegative;
  if (conn.comfyuiSplitReferenceWorkflow) fields.comfyWorkflowSplitReference = conn.comfyuiSplitReferenceWorkflow;
  return fields;
}

export type ComfyWorkflowVariant = "no-reference" | "with-reference" | "with-negative" | "split-reference" | "fallback";

/** True when the workflow JSON contains `%background_reference_image_name%`. */
export function comfyWorkflowExpectsBackgroundReference(workflow?: string | null): boolean {
  return !!workflow?.includes("%background_reference_image_name%");
}

/** True when the workflow JSON contains face reference placeholder. */
export function comfyWorkflowExpectsFaceReference(workflow?: string | null): boolean {
  return !!workflow?.includes("%face_reference_image_name%");
}

/** True when the workflow JSON contains body reference placeholder. */
export function comfyWorkflowExpectsBodyReference(workflow?: string | null): boolean {
  return !!workflow?.includes("%body_reference_image_name%");
}

/** How many reference images the active ComfyUI workflow will actually consume. */
export function countActiveComfyReferenceImages(
  request: ComfyWorkflowRequestFields,
  activeWorkflow?: string | null,
): number {
  const wf = activeWorkflow ?? resolveActiveComfyWorkflow(request) ?? "";
  if (!wf.trim()) return 0;
  const hasCharacterRef = Boolean(request.referenceImage || request.referenceImages?.[0]);
  if (!hasCharacterRef) return 0;

  if (comfyWorkflowExpectsFaceReference(wf) && comfyWorkflowExpectsBodyReference(wf)) {
    let count = 0;
    if (request.referenceImage || request.referenceImages?.[0]) count += 1;
    if (request.referenceImages?.[1]) count += 1;
    return count;
  }

  const usesCharacterSlot = wf.includes("%reference_image%") || wf.includes("%reference_image_name%");
  if (!usesCharacterSlot) return 0;
  let count = 1;
  if (comfyWorkflowExpectsBackgroundReference(wf) && request.referenceImages?.[1]) {
    count += 1;
  }
  return count;
}

/** Describe which workflow slot was selected (for debug logging). */
export function describeComfyWorkflowVariant(request: ComfyWorkflowRequestFields): ComfyWorkflowVariant {
  const hasReference = hasComfyReferenceImage(request);
  const noRef = request.comfyWorkflow?.trim();
  const withRef = request.comfyWorkflowWithReference?.trim();
  const withNeg = request.comfyWorkflowWithNegative?.trim();
  const splitRef = request.comfyWorkflowSplitReference?.trim();

  if (hasReference) {
    if (request.preferSplitReference && splitRef) return "split-reference";
    if (request.preferNegativeWorkflow && withNeg) return "with-negative";
    if (withRef) return "with-reference";
    if (noRef) return "fallback";
    return "fallback";
  }
  if (noRef) return "no-reference";
  if (withRef) return "fallback";
  return "fallback";
}
