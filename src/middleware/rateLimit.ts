import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { rateLimitConfig } from '../config/app';
import { appLogger } from '../utils/logger';
import { RateLimitError } from '../utils/errors';

/**
 * Create rate limit store (in-memory for development, Redis for production)
 */
const createStore = () => {
  // For production, you would use Redis store
  // return new RedisStore({ ... });

  // For development, use memory store
  return new Map();
};

/**
 * Custom rate limit handler
 */
const rateLimitHandler = (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const ip = req.ip;

  appLogger.security('Rate limit exceeded', 'medium', {
    userId,
    ip,
    path: req.path,
    method: req.method,
    userAgent: req.get('User-Agent'),
  });

  throw new RateLimitError('Too many requests from this IP, please try again later.');
};

/**
 * Skip rate limiting for certain conditions
 */
const skipRateLimit = (req: Request): boolean => {
  // Skip for health checks
  if (req.path.startsWith('/health')) {
    return true;
  }

  // Skip for trusted IPs in development
  if (process.env.NODE_ENV === 'development') {
    const trustedIPs = ['127.0.0.1', '::1', 'localhost'];
    return trustedIPs.includes(req.ip);
  }

  return false;
};

/**
 * Generate rate limit key
 */
const keyGenerator = (req: Request): string => {
  const userId = (req as any).user?.id;

  // Use user ID if authenticated, otherwise use IP
  return userId ? `user:${userId}` : `ip:${req.ip}`;
};

/**
 * Standard rate limiting middleware
 */
export const rateLimitMiddleware = rateLimit({
  windowMs: rateLimitConfig.windowMs,
  max: rateLimitConfig.maxRequests,
  message: rateLimitConfig.message,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
  keyGenerator,
  handler: rateLimitHandler,
});

/**
 * Strict rate limiting for authentication endpoints
 */
export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `auth:${req.ip}`,
  handler: rateLimitHandler,
});

/**
 * Lenient rate limiting for file uploads
 */
export const uploadRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute
  message: 'Too many file uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: rateLimitHandler,
  skip: (req: Request) => {
    // Skip if no file in request
    return !req.file && !req.files;
  },
});

/**
 * AI operations rate limiting
 */
export const aiRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 AI requests per minute
  message: 'Too many AI requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: rateLimitHandler,
});

/**
 * Message sending rate limiting
 */
export const messageRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 messages per minute
  message: 'Too many messages sent, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: rateLimitHandler,
});

/**
 * Group operations rate limiting
 */
export const groupRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 group operations per minute
  message: 'Too many group operations, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: rateLimitHandler,
});

/**
 * Create custom rate limiter
 */
export function createCustomRateLimit(options: {
  windowMs: number;
  max: number;
  message: string;
  keyPrefix?: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: options.message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as any).user?.id;
      const key = userId ? `user:${userId}` : `ip:${req.ip}`;
      return options.keyPrefix ? `${options.keyPrefix}:${key}` : key;
    },
    handler: rateLimitHandler,
  });
}
