import type {
  ClientCapabilities,
  ElicitRequestFormParams,
  ElicitResult
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

const FIELD_ID = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_DESCRIPTION_LENGTH = 400;
const MAX_TEXT_LENGTH = 4_000;

const choiceSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(120)
});

const questionBase = {
  id: z.string().regex(FIELD_ID),
  label: z.string().min(1).max(120),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  required: z.boolean().optional()
};

export const workflowQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...questionBase,
    type: z.literal("text"),
    default: z.string().max(MAX_TEXT_LENGTH).optional()
  }),
  z.object({
    ...questionBase,
    type: z.literal("boolean"),
    default: z.boolean().optional()
  }),
  z.object({
    ...questionBase,
    type: z.literal("single_select"),
    options: z.array(choiceSchema).min(2).max(10),
    default: z.string().max(120).optional()
  })
]);

export const workflowElicitationInputSchema = {
  kind: z.enum(["approval", "clarification"]),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  binding: z.string().min(1).max(240).optional(),
  questions: z.array(workflowQuestionSchema).max(3).optional()
};

export type WorkflowQuestion = z.infer<typeof workflowQuestionSchema>;

export interface WorkflowElicitationInput {
  kind: "approval" | "clarification";
  message: string;
  binding?: string | undefined;
  questions?: WorkflowQuestion[] | undefined;
}

export interface WorkflowElicitationOutcome {
  kind: WorkflowElicitationInput["kind"];
  status: "approved" | "changes_requested" | "answered" | "declined" | "cancelled" | "fallback_required";
  binding?: string;
  answers?: Record<string, string | number | boolean | string[]>;
  fallback?: string;
}

type PrimitiveSchema = ElicitRequestFormParams["requestedSchema"]["properties"][string];

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function choiceValues(question: Extract<WorkflowQuestion, { options: unknown }>): string[] {
  const values = question.options.map((option) => option.value);
  assertUnique(values, `${question.id} option values must be unique`);
  return values;
}

function questionSchema(question: WorkflowQuestion): PrimitiveSchema {
  const common = {
    title: question.label,
    ...(question.description ? { description: question.description } : {})
  };
  switch (question.type) {
    case "text":
      return {
        ...common,
        type: "string",
        ...(question.required ? { minLength: 1 } : {}),
        maxLength: MAX_TEXT_LENGTH,
        ...(question.default === undefined ? {} : { default: question.default })
      };
    case "boolean":
      return {
        ...common,
        type: "boolean",
        ...(question.default === undefined ? {} : { default: question.default })
      };
    case "single_select": {
      const values = choiceValues(question);
      if (question.default !== undefined && !values.includes(question.default)) {
        throw new Error(`${question.id} default must match an option value`);
      }
      return {
        ...common,
        type: "string",
        oneOf: question.options.map((option) => ({ const: option.value, title: option.label })),
        ...(question.default === undefined ? {} : { default: question.default })
      };
    }
  }
}

export function supportsFormElicitation(capabilities: ClientCapabilities | undefined): boolean {
  const elicitation = capabilities?.elicitation;
  if (!elicitation) return false;
  return elicitation.form !== undefined || elicitation.url === undefined;
}

export function buildWorkflowElicitation(input: WorkflowElicitationInput): ElicitRequestFormParams {
  if (input.kind === "approval") {
    if (!input.binding) throw new Error("approval elicitation requires a proposal or checkpoint binding");
    if (input.questions?.length) throw new Error("approval elicitation uses the fixed decision form");
    return {
      mode: "form",
      message: `${input.message}\n\nApproval binding: ${input.binding}`,
      requestedSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "Decision",
            description: "Approve the bound proposal, request changes, or cancel.",
            oneOf: [
              { const: "approve", title: "Approve" },
              { const: "request_changes", title: "Request changes" },
              { const: "cancel", title: "Cancel" }
            ],
            default: "approve"
          },
          notes: {
            type: "string",
            title: "Notes",
            description: "Optional changes, exceptions, or verification notes.",
            maxLength: MAX_TEXT_LENGTH
          }
        },
        required: ["decision"]
      }
    };
  }

  const questions = input.questions ?? [];
  if (!questions.length) throw new Error("clarification elicitation requires at least one question");
  assertUnique(questions.map((question) => question.id), "clarification question IDs must be unique");
  return {
    mode: "form",
    message: input.message,
    requestedSchema: {
      type: "object",
      properties: Object.fromEntries(questions.map((question) => [question.id, questionSchema(question)])),
      required: questions.filter((question) => question.required).map((question) => question.id)
    }
  };
}

export function fallbackWorkflowElicitation(
  input: WorkflowElicitationInput,
  reason: string
): WorkflowElicitationOutcome {
  return {
    kind: input.kind,
    status: "fallback_required",
    ...(input.binding ? { binding: input.binding } : {}),
    fallback: `${reason}. Ask the same concise question once in chat; do not retry the form.`
  };
}

export function normalizeWorkflowElicitation(
  input: WorkflowElicitationInput,
  elicited: ElicitResult
): WorkflowElicitationOutcome {
  if (elicited.action === "decline") {
    return { kind: input.kind, status: "declined", ...(input.binding ? { binding: input.binding } : {}) };
  }
  if (elicited.action === "cancel") {
    return { kind: input.kind, status: "cancelled", ...(input.binding ? { binding: input.binding } : {}) };
  }
  const answers = elicited.content ?? {};
  if (input.kind === "clarification") {
    return { kind: input.kind, status: "answered", answers };
  }
  const decision = answers.decision;
  const status = decision === "approve"
    ? "approved"
    : decision === "request_changes"
      ? "changes_requested"
      : "cancelled";
  return {
    kind: input.kind,
    status,
    ...(input.binding ? { binding: input.binding } : {}),
    answers
  };
}
