import { Router } from 'express';
import { MongoClient } from 'mongodb';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { validationMiddleware } from '../middleware/validation';
import { errorHandler } from '../middleware/errorHandler';

// Import route modules
import createAuthRoutes from './auth';
import groupRoutes from './groups';
import createMessageRoutes from './messages';
import createMediaRoutes from './media';
import createAIRoutes from './ai';
import healthRoutes from './health';

/**
 * Main router configuration
 */
export function createRoutes(db: MongoClient): Router {
  const router = Router();

  // Health check routes (no auth required)
  router.use('/health', healthRoutes);

  // Authentication routes (no auth required for login/register)
  router.use('/auth', createAuthRoutes(db));

  // Apply global middleware for protected routes
  router.use(rateLimitMiddleware);
  router.use(authMiddleware());
  router.use(validationMiddleware);

  // Protected API routes
  router.use('/groups', groupRoutes); // Direct router export
  router.use('/messages', createMessageRoutes(db)); // Factory function
  router.use('/media', createMediaRoutes(db)); // Factory function
  router.use('/ai', createAIRoutes(db)); // Factory function

  // Error handling middleware (must be last)
  router.use(errorHandler);

  return router;
}

/**
 * API versioning
 */
export function createVersionedRoutes(db: MongoClient): Router {
  const router = Router();

  // API v1
  router.use('/v1', createRoutes(db));

  // Default to v1
  router.use('/', createRoutes(db));

  return router;
}
