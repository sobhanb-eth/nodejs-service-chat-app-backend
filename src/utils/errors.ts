/**
 * Custom error classes for the application
 */

export abstract class BaseError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.name = this.constructor.name;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request
 */
export class ValidationError extends BaseError {
  constructor(message: string = 'Validation failed', code: string = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

/**
 * 401 Unauthorized
 */
export class AuthenticationError extends BaseError {
  constructor(message: string = 'Authentication required', code: string = 'AUTHENTICATION_ERROR') {
    super(message, 401, code);
  }
}

/**
 * 403 Forbidden
 */
export class AuthorizationError extends BaseError {
  constructor(message: string = 'Access denied', code: string = 'AUTHORIZATION_ERROR') {
    super(message, 403, code);
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends BaseError {
  constructor(message: string = 'Resource not found', code: string = 'NOT_FOUND_ERROR') {
    super(message, 404, code);
  }
}

/**
 * 409 Conflict
 */
export class ConflictError extends BaseError {
  constructor(message: string = 'Resource conflict', code: string = 'CONFLICT_ERROR') {
    super(message, 409, code);
  }
}

/**
 * 422 Unprocessable Entity
 */
export class BusinessLogicError extends BaseError {
  constructor(message: string = 'Business logic error', code: string = 'BUSINESS_LOGIC_ERROR') {
    super(message, 422, code);
  }
}

/**
 * 429 Too Many Requests
 */
export class RateLimitError extends BaseError {
  constructor(message: string = 'Rate limit exceeded', code: string = 'RATE_LIMIT_ERROR') {
    super(message, 429, code);
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends BaseError {
  constructor(message: string = 'Internal server error', code: string = 'INTERNAL_SERVER_ERROR') {
    super(message, 500, code, false);
  }
}

/**
 * 502 Bad Gateway
 */
export class ExternalServiceError extends BaseError {
  constructor(message: string = 'External service error', code: string = 'EXTERNAL_SERVICE_ERROR') {
    super(message, 502, code);
  }
}

/**
 * 503 Service Unavailable
 */
export class ServiceUnavailableError extends BaseError {
  constructor(message: string = 'Service unavailable', code: string = 'SERVICE_UNAVAILABLE_ERROR') {
    super(message, 503, code);
  }
}

/**
 * Database-specific errors
 */
export class DatabaseError extends BaseError {
  constructor(message: string = 'Database operation failed', code: string = 'DATABASE_ERROR') {
    super(message, 500, code, false);
  }
}

export class DatabaseConnectionError extends DatabaseError {
  constructor(message: string = 'Database connection failed') {
    super(message, 'DATABASE_CONNECTION_ERROR');
  }
}

export class DatabaseValidationError extends DatabaseError {
  constructor(message: string = 'Database validation failed') {
    super(message, 'DATABASE_VALIDATION_ERROR');
  }
}

/**
 * File/Media-specific errors
 */
export class FileUploadError extends BaseError {
  constructor(message: string = 'File upload failed', code: string = 'FILE_UPLOAD_ERROR') {
    super(message, 400, code);
  }
}

export class FileSizeError extends FileUploadError {
  constructor(message: string = 'File size exceeds limit') {
    super(message, 'FILE_SIZE_ERROR');
  }
}

export class FileTypeError extends FileUploadError {
  constructor(message: string = 'File type not allowed') {
    super(message, 'FILE_TYPE_ERROR');
  }
}

/**
 * AI/ML-specific errors
 */
export class AIServiceError extends BaseError {
  constructor(message: string = 'AI service error', code: string = 'AI_SERVICE_ERROR') {
    super(message, 502, code);
  }
}

export class EmbeddingError extends AIServiceError {
  constructor(message: string = 'Failed to generate embeddings') {
    super(message, 'EMBEDDING_ERROR');
  }
}

export class SmartReplyError extends AIServiceError {
  constructor(message: string = 'Failed to generate smart replies') {
    super(message, 'SMART_REPLY_ERROR');
  }
}

/**
 * Encryption-specific errors
 */
export class EncryptionError extends BaseError {
  constructor(message: string = 'Encryption operation failed', code: string = 'ENCRYPTION_ERROR') {
    super(message, 500, code, false);
  }
}

export class DecryptionError extends EncryptionError {
  constructor(message: string = 'Decryption operation failed') {
    super(message, 'DECRYPTION_ERROR');
  }
}

/**
 * Socket.io-specific errors
 */
export class SocketError extends BaseError {
  constructor(message: string = 'Socket operation failed', code: string = 'SOCKET_ERROR') {
    super(message, 500, code);
  }
}

export class SocketAuthenticationError extends SocketError {
  constructor(message: string = 'Socket authentication failed') {
    super(message, 'SOCKET_AUTHENTICATION_ERROR');
  }
}

/**
 * Group/Room-specific errors
 */
export class GroupError extends BaseError {
  constructor(message: string = 'Group operation failed', code: string = 'GROUP_ERROR') {
    super(message, 400, code);
  }
}

export class GroupPermissionError extends GroupError {
  constructor(message: string = 'Insufficient group permissions') {
    super(message, 'GROUP_PERMISSION_ERROR');
  }
}

export class GroupNotFoundError extends GroupError {
  constructor(message: string = 'Group not found') {
    super(message, 'GROUP_NOT_FOUND_ERROR');
  }
}

/**
 * Message-specific errors
 */
export class MessageError extends BaseError {
  constructor(message: string = 'Message operation failed', code: string = 'MESSAGE_ERROR') {
    super(message, 400, code);
  }
}

export class MessageNotFoundError extends MessageError {
  constructor(message: string = 'Message not found') {
    super(message, 'MESSAGE_NOT_FOUND_ERROR');
  }
}

export class MessagePermissionError extends MessageError {
  constructor(message: string = 'Insufficient message permissions') {
    super(message, 'MESSAGE_PERMISSION_ERROR');
  }
}

/**
 * Error response interface
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    path?: string;
    details?: any;
  };
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: BaseError | Error,
  path?: string,
  details?: any
): ErrorResponse {
  const isBaseError = error instanceof BaseError;
  
  return {
    success: false,
    error: {
      code: isBaseError ? error.code : 'UNKNOWN_ERROR',
      message: error.message,
      statusCode: isBaseError ? error.statusCode : 500,
      timestamp: new Date().toISOString(),
      path,
      details,
    },
  };
}

/**
 * Check if error is operational (expected) or programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
}
