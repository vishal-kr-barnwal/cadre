import type { JsonObject } from "../../../types";

export const AGENT_IDENTIFIERS = ["claude", "codex", "copilot", "antigravity"] as const;

export type AgentIdentifier = typeof AGENT_IDENTIFIERS[number];

const DISPATCH_ADAPTERS: Record<AgentIdentifier, JsonObject> = {
  claude: {
    agent_identifier: "claude",
    mechanism: "Task",
    instruction: "Call the Task tool once for this prompt and dispatch payload. Return the result JSON to the coordinator.",
  },
  codex: {
    agent_identifier: "codex",
    mechanism: "multi_agent_v1.spawn_agent",
    instruction: "Use tool discovery for multi_agent_v1.spawn_agent, pass this prompt and dispatch payload, then wait for completion.",
  },
  copilot: {
    agent_identifier: "copilot",
    mechanism: "copilot_cli.custom_agent",
    instruction: "Invoke the installed Cadre worker custom agent with this prompt and dispatch payload. For multiple ready workers, Copilot /fleet may be used when it preserves the returned Cadre record_finish contract.",
  },
  antigravity: {
    agent_identifier: "antigravity",
    mechanism: "invoke_subagent",
    instruction: "Use invoke_subagent, or define and invoke a Cadre worker subagent, with this prompt and dispatch payload. Return the result JSON to the coordinator.",
  },
};

export function isAgentIdentifier(value: unknown): value is AgentIdentifier {
  return typeof value === "string" && (AGENT_IDENTIFIERS as readonly string[]).includes(value);
}

export function dispatchAdapterFor(agentIdentifier: AgentIdentifier): JsonObject {
  return DISPATCH_ADAPTERS[agentIdentifier];
}
