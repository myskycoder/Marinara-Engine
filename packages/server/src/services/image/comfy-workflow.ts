export interface ComfyWorkflowRequestFields {
  comfyWorkflow?: string;
  comfyWorkflowWithReference?: string;
  referenceImage?: string;
  referenceImages?: string[];
}

export function hasComfyReferenceImage(request: Pick<ComfyWorkflowRequestFields, "referenceImage" | "referenceImages">): boolean {
  return Boolean(request.referenceImage || (request.referenceImages && request.referenceImages.length > 0));
}

/** Pick the ComfyUI workflow JSON string for the current request. */
export function resolveActiveComfyWorkflow(request: ComfyWorkflowRequestFields): string | undefined {
  const hasReference = hasComfyReferenceImage(request);
  if (hasReference) {
    return request.comfyWorkflowWithReference ?? request.comfyWorkflow;
  }
  return request.comfyWorkflow ?? request.comfyWorkflowWithReference;
}

/** Map connection-stored workflow fields onto an ImageGenRequest spread. */
export function comfyWorkflowFieldsFromConnection(conn: {
  comfyuiWorkflow?: string | null;
  comfyuiWorkflowWithReference?: string | null;
}): { comfyWorkflow?: string; comfyWorkflowWithReference?: string } {
  const fields: { comfyWorkflow?: string; comfyWorkflowWithReference?: string } = {};
  if (conn.comfyuiWorkflow) fields.comfyWorkflow = conn.comfyuiWorkflow;
  if (conn.comfyuiWorkflowWithReference) fields.comfyWorkflowWithReference = conn.comfyuiWorkflowWithReference;
  return fields;
}

export type ComfyWorkflowVariant = "no-reference" | "with-reference" | "fallback";

/** True when the workflow JSON contains `%background_reference_image_name%`. */
export function comfyWorkflowExpectsBackgroundReference(workflow?: string | null): boolean {
  return !!workflow?.includes("%background_reference_image_name%");
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
  if (hasReference) {
    if (withRef) return "with-reference";
    if (noRef) return "fallback";
    return "fallback";
  }
  if (noRef) return "no-reference";
  if (withRef) return "fallback";
  return "fallback";
}
