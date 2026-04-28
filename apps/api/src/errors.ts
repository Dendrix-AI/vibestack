import type { FastifyReply } from 'fastify';

export type ApiError = {
  code: string;
  message: string;
  statusCode?: number;
  agentHint?: string;
  details?: Record<string, unknown>;
};

export class HttpError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly agentHint?: string;
  readonly details?: Record<string, unknown>;

  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.statusCode = error.statusCode ?? 500;
    this.agentHint = error.agentHint;
    this.details = error.details;
  }
}

export function sendError(reply: FastifyReply, error: ApiError): FastifyReply {
  return reply.status(error.statusCode ?? 500).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.agentHint ? { agentHint: error.agentHint } : {}),
      ...(error.details ? { details: error.details } : {})
    }
  });
}

export function notFound(message = 'Resource not found'): HttpError {
  return new HttpError({ code: 'NOT_FOUND', message, statusCode: 404 });
}

export function permissionDenied(message = 'You do not have permission to perform this action'): HttpError {
  return new HttpError({
    code: 'PERMISSION_DENIED',
    message,
    statusCode: 403,
    agentHint: 'Use a VibeStack user or API token with the required platform or team role.'
  });
}
