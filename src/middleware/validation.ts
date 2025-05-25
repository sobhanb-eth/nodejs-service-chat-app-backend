import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../utils/errors';
import { appLogger } from '../utils/logger';

/**
 * Validation middleware factory
 */
export function validateSchema<T>(schema: ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req[source];
      const validatedData = schema.parse(data);

      // Replace the original data with validated data
      (req as any)[source] = validatedData;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);

        appLogger.warn('Validation failed', {
          source,
          path: req.path,
          errors: errorMessages,
          userId: (req as any).user?.id,
        });

        throw new ValidationError(`Validation failed: ${errorMessages.join(', ')}`);
      }

      next(error);
    }
  };
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  // MongoDB ObjectId validation
  objectId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format'),

  // Pagination validation
  pagination: z.object({
    limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 50),
    offset: z.string().optional().transform(val => val ? parseInt(val, 10) : 0),
    before: z.string().optional(),
    after: z.string().optional(),
  }),

  // Sort validation
  sort: z.object({
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  }),

  // Search validation
  search: z.object({
    q: z.string().min(1).max(100).optional(),
    type: z.string().optional(),
    status: z.string().optional(),
  }),
};

/**
 * Group validation schemas
 */
export const groupSchemas = {
  create: z.object({
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(500).trim().optional(),
    isPrivate: z.boolean().optional().default(false),
  }),

  update: z.object({
    name: z.string().min(1).max(100).trim().optional(),
    description: z.string().max(500).trim().optional(),
    isPrivate: z.boolean().optional(),
  }),

  transferOwnership: z.object({
    newOwnerId: commonSchemas.objectId,
  }),

  addMember: z.object({
    userId: commonSchemas.objectId,
    role: z.enum(['member', 'admin']).optional().default('member'),
  }),

  removeMember: z.object({
    userId: commonSchemas.objectId,
  }),
};

/**
 * Message validation schemas
 */
export const messageSchemas = {
  create: z.object({
    groupId: commonSchemas.objectId,
    content: z.string().min(1).max(4000).trim(),
    type: z.enum(['text', 'image', 'file', 'system']).optional().default('text'),
    tempId: z.string().optional(),
  }),

  update: z.object({
    content: z.string().min(1).max(4000).trim(),
  }),

  smartReply: z.object({
    messageContent: z.string().min(1).max(4000),
    groupId: commonSchemas.objectId,
  }),

  markRead: z.object({
    messageIds: z.array(commonSchemas.objectId).min(1).max(100),
  }),
};

/**
 * Media validation schemas
 */
export const mediaSchemas = {
  upload: z.object({
    messageId: commonSchemas.objectId.optional(),
    groupId: commonSchemas.objectId.optional(),
  }),

  update: z.object({
    filename: z.string().min(1).max(255).optional(),
    description: z.string().max(500).optional(),
  }),
};

/**
 * AI validation schemas
 */
export const aiSchemas = {
  analyze: z.object({
    content: z.string().min(1).max(4000),
  }),

  contextualResponse: z.object({
    query: z.string().min(1).max(1000),
    groupId: commonSchemas.objectId,
    maxTokens: z.number().min(10).max(500).optional().default(150),
  }),

  moderate: z.object({
    content: z.string().min(1).max(4000),
  }),

  smartReply: z.object({
    messageContent: z.string().min(1).max(4000),
    groupId: commonSchemas.objectId,
  }),

  sentiment: z.object({
    content: z.string().min(1).max(4000),
  }),

  search: z.object({
    query: z.string().min(1).max(1000),
    groupId: commonSchemas.objectId,
    limit: z.number().min(1).max(50).optional().default(10),
  }),

  summarize: z.object({
    groupId: commonSchemas.objectId,
    timeRange: z.enum(['1h', '6h', '12h', '24h', '7d', '30d']).optional().default('24h'),
  }),

  topics: z.object({
    groupId: commonSchemas.objectId,
    count: z.number().min(1).max(20).optional().default(5),
  }),

  translate: z.object({
    content: z.string().min(1).max(4000),
    targetLanguage: z.string().min(2).max(10),
    sourceLanguage: z.string().min(2).max(10).optional(),
  }),

  detectLanguage: z.object({
    content: z.string().min(1).max(4000),
  }),
};

/**
 * Auth validation schemas
 */
export const authSchemas = {
  register: z.object({
    email: z.string().email(),
    firstName: z.string().min(1).max(50).trim(),
    lastName: z.string().min(1).max(50).trim(),
    clerkId: z.string().min(1),
  }),

  login: z.object({
    token: z.string().min(1),
  }),

  updateProfile: z.object({
    firstName: z.string().min(1).max(50).trim().optional(),
    lastName: z.string().min(1).max(50).trim().optional(),
    avatar: z.string().url().optional(),
  }),
};

/**
 * Socket validation schemas
 */
export const socketSchemas = {
  auth: z.object({
    token: z.string().min(1),
  }),

  joinGroup: z.object({
    groupId: commonSchemas.objectId,
  }),

  leaveGroup: z.object({
    groupId: commonSchemas.objectId,
  }),

  sendMessage: z.object({
    groupId: commonSchemas.objectId,
    content: z.string().min(1).max(4000).trim(),
    type: z.enum(['text', 'image', 'file']).optional().default('text'),
    tempId: z.string().optional(),
  }),

  typing: z.object({
    groupId: commonSchemas.objectId,
    isTyping: z.boolean(),
  }),
};

/**
 * File validation
 */
export function validateFile(req: Request, res: Response, next: NextFunction) {
  const file = req.file;

  if (!file) {
    return next(new ValidationError('File is required'));
  }

  // Check file size (10MB limit)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return next(new ValidationError('File size exceeds 10MB limit'));
  }

  // Check file type
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'application/pdf',
    'text/plain',
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return next(new ValidationError('File type not allowed'));
  }

  // Log file upload attempt
  appLogger.file('File validation passed', file.originalname, file.size, {
    mimetype: file.mimetype,
    userId: (req as any).user?.id,
  });

  next();
}

/**
 * Sanitize input middleware
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction) {
  // Recursively sanitize object
  function sanitize(obj: any): any {
    if (typeof obj === 'string') {
      // Remove potential XSS patterns
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }

    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }

    return obj;
  }

  // Sanitize request body
  if (req.body) {
    req.body = sanitize(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitize(req.query);
  }

  next();
}

/**
 * General validation middleware (applied to all routes)
 */
export function validationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Apply input sanitization
  sanitizeInput(req, res, next);
}
