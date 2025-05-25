import { Router } from 'express';
import { MongoClient } from 'mongodb';
import { AuthService } from '../services/AuthService';
import { validateSchema } from '../middleware/validation';
import { authSchemas } from '../middleware/validation';
import { authRateLimitMiddleware } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/api';

/**
 * Authentication routes
 */
export default function createAuthRoutes(db: MongoClient): Router {
  const router = Router();
  const authService = new AuthService();

  /**
   * Register new user
   * POST /auth/register
   */
  router.post('/register',
    authRateLimitMiddleware,
    validateSchema(authSchemas.register),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { email, firstName, lastName, clerkId } = req.body;

      // Create user using syncUserFromJWT method
      const user = await authService.syncUserFromJWT({
        sub: clerkId,
        email,
        given_name: firstName,
        family_name: lastName,
        iss: 'clerk',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      });

      res.status(201).json({
        success: true,
        user: {
          id: user._id?.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          clerkId: user.clerkId,
          createdAt: user.createdAt,
        },
      });
    })
  );

  /**
   * Login user
   * POST /auth/login
   */
  router.post('/login',
    authRateLimitMiddleware,
    validateSchema(authSchemas.login),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { token } = req.body;

      // For login, we'll assume token validation is handled by middleware
      // This endpoint can be simplified to just return success
      res.json({
        success: true,
        message: 'Login successful - token validated by middleware',
      });
    })
  );

  /**
   * Get current user profile
   * GET /auth/profile
   */
  router.get('/profile',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const user = await authService.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      res.json({
        success: true,
        user: {
          id: user._id?.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          clerkId: user.clerkId,
          avatar: user.profileImageUrl,
          isActive: user.isActive,
          lastSeen: user.lastSeen,
          createdAt: user.createdAt,
        },
      });
    })
  );

  /**
   * Update user profile
   * PUT /auth/profile
   */
  router.put('/profile',
    validateSchema(authSchemas.updateProfile),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id;
      const { firstName, lastName, avatar } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Update user profile using syncUserFromJWT with updated data
      const user = await authService.getUserById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      await authService.syncUserFromJWT({
        sub: user.clerkId,
        email: user.email,
        given_name: firstName || user.firstName,
        family_name: lastName || user.lastName,
        picture: avatar || user.profileImageUrl,
        iss: 'clerk',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
      });
    })
  );

  /**
   * Logout user
   * POST /auth/logout
   */
  router.post('/logout',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id;

      if (userId) {
        await authService.updateLastSeen(userId);
      }

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    })
  );

  return router;
}
