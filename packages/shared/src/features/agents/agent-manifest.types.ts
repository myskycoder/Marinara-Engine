import type { AgentCategory, AgentPhase, AgentPromptTemplateOption, AgentResultType } from "../../types/agent.js";
import type { ChatMode } from "../../types/chat.js";

export interface BuiltInAgentManifest {
  id: string;
  name: string;
  description: string;
  author?: string;
  phase: AgentPhase;
  enabledByDefault: boolean;
  defaultInjectAsSection?: boolean;
  category: AgentCategory;
  resultType?: AgentResultType;
  modeAllowlist?: readonly ChatMode[];
  defaultTools?: readonly string[];
  defaultSettings?: Record<string, unknown>;
  promptTemplates?: readonly AgentPromptTemplateOption[];
  runInterval?: number;
}
