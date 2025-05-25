import { Request, Response, NextFunction } from 'express';
import { BaseError, createErrorResponse, isOperationalError } from '../utils/errors';
import { appLogger } from '../utils/logger';
import { serverConfig } from '../config/app';

/**
 * Global error handling middleware
 */
export function errorHandler(
  error: Error | BaseError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log the error
  appLogger.error('Request error', error, {
    method: req.method,
    path: req.path,
    query: req.query,
    body: serverConfig.isDevelopment ? req.body : '[REDACTED]',
    userId: (req as any).user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Don't handle if response already sent
  if (res.headersSent) {
    return next(error);
  }

  // Create error response
  const errorResponse = createErrorResponse(
    error,
    req.path,
    serverConfig.isDevelopment ? { stack: error.stack } : undefined
  );

  // Send error response
  res.status(errorResponse.error.statusCode).json(errorResponse);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler<T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<any>
) {
  return (req: T, res: U, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  const errorResponse = createErrorResponse(
    new Error(`Route ${req.method} ${req.path} not found`),
    req.path
  );

  errorResponse.error.statusCode = 404;
  errorResponse.error.code = 'ROUTE_NOT_FOUND';

  res.status(404).json(errorResponse);
}

/**
 * Validation error handler
 */
export function validationErrorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error.name === 'ValidationError' || error.type === 'entity.parse.failed') {
    const errorResponse = createErrorResponse(
      new Error('Invalid request data'),
      req.path,
      serverConfig.isDevelopment ? error.details : undefined
    );

    errorResponse.error.statusCode = 400;
    errorResponse.error.code = 'VALIDATION_ERROR';

    res.status(400).json(errorResponse);
    return;
  }

  next(error);
}

/**
 * CORS error handler
 */
export function corsErrorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error.message && error.message.includes('CORS')) {
    const errorResponse = createErrorResponse(
      new Error('CORS policy violation'),
      req.path
    );

    errorResponse.error.statusCode = 403;
    errorResponse.error.code = 'CORS_ERROR';

    res.status(403).json(errorResponse);
    return;
  }

  next(error);
}

/**
 * Rate limit error handler
 */
export function rateLimitErrorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error.type === 'rate-limit') {
    const errorResponse = createErrorResponse(
      new Error('Rate limit exceeded'),
      req.path
    );

    errorResponse.error.statusCode = 429;
    errorResponse.error.code = 'RATE_LIMIT_EXCEEDED';

    res.status(429).json(errorResponse);
    return;
  }

  next(error);
}

/**
 * Process termination handler for unhandled errors
 */
export function setupProcessErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    appLogger.error('Uncaught Exception - Server will terminate', error, { fatal: true });

    // Give time for logs to be written
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    appLogger.error('Unhandled Promise Rejection', reason, {
      promise: promise.toString(),
      fatal: !isOperationalError(reason)
    });

    // Only exit for non-operational errors
    if (!isOperationalError(reason)) {
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    }
  });

  process.on('SIGTERM', () => {
    appLogger.info('SIGTERM received - Server shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    appLogger.info('SIGINT received - Server shutting down gracefully');
    process.exit(0);
  });
}
