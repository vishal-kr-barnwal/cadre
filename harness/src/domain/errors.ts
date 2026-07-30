export interface SerializedCadreError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class CadreError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CadreError";
    this.code = code;
    this.details = details;
  }
}

export function serializeCadreError(error: unknown): SerializedCadreError {
  if (error instanceof CadreError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    };
  }
  return {
    code: "CADRE_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
