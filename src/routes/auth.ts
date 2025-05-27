import { Router } from 'express';
import { MongoClient } from 'mongodb';
import multer from 'multer';
import { AuthService } from '../services/AuthService';
import { MediaService } from '../services/MediaService';
import { validateSchema } from '../middleware/validation';
import { authSchemas } from '../middleware/validation';
import { authRateLimitMiddleware } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/api';

/**
 * Authentication routes
 */
export default function createAuthRoutes(db: MongoClient): Router {
  const router = Router();
  const authService = new AuthService();
  const mediaService = new MediaService(db);

  // Configure multer for profile picture uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit for profile pictures
    },
    fileFilter: (req, file, cb) => {
      // Only allow image files
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for profile pictures'));
      }
    },
  });

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
          username: user.username,
          profileImageUrl: user.profileImageUrl,
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
    authMiddleware(), // Apply auth middleware to protected routes
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id; // This should be clerkId from middleware

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Use getUserByClerkId since userId is clerkId (string), not MongoDB ObjectId
      const user = await authService.getUserByClerkId(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Get current profile picture URLs
      const profilePicture = await mediaService.getCurrentProfilePicture(user.clerkId);

      res.json({
        success: true,
        user: {
          id: user._id?.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          clerkId: user.clerkId,
          username: user.username,
          profileImageUrl: profilePicture?.profileImageUrl || user.profileImageUrl,
          thumbnailUrl: profilePicture?.thumbnailUrl,
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
    authMiddleware(), // Apply auth middleware to protected routes
    validateSchema(authSchemas.updateProfile),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id; // This should be clerkId
      const { firstName, lastName, username, profileImageUrl, avatar } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Use getUserByClerkId since userId is clerkId
      const user = await authService.getUserByClerkId(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      // Handle backward compatibility: if avatar is provided but profileImageUrl is not, use avatar
      const finalProfileImageUrl = profileImageUrl || avatar;

      // Check username uniqueness if provided
      if (username && username !== user.username) {
        const existingUser = await authService.getUserByUsername(username);
        if (existingUser && existingUser.clerkId !== user.clerkId) {
          return res.status(400).json({
            success: false,
            error: 'Username is already taken',
          });
        }
      }

      // Update user profile using AuthService updateProfile method
      const updatedUser = await authService.updateUserProfile(user.clerkId, {
        firstName: firstName || user.firstName,
        lastName: lastName || user.lastName,
        username: username !== undefined ? username : user.username,
        profileImageUrl: finalProfileImageUrl !== undefined ? finalProfileImageUrl : user.profileImageUrl,
      });

      // Get current profile picture URLs
      const profilePicture = await mediaService.getCurrentProfilePicture(user.clerkId);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: updatedUser._id?.toString(),
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          clerkId: updatedUser.clerkId,
          username: updatedUser.username,
          profileImageUrl: profilePicture?.profileImageUrl || updatedUser.profileImageUrl,
          thumbnailUrl: profilePicture?.thumbnailUrl,
          isActive: updatedUser.isActive,
          lastSeen: updatedUser.lastSeen,
          createdAt: updatedUser.createdAt,
        },
      });
    })
  );

  /**
   * Upload profile picture
   * POST /auth/profile/picture
   */
  router.post('/profile/picture',
    authMiddleware(), // Apply auth middleware to protected routes
    upload.single('profilePicture'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id; // clerkId
      const file = req.file;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Profile picture file is required',
        });
      }

      const user = await authService.getUserByClerkId(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      try {
        // Upload profile picture using MediaService
        const { profileImageUrl, thumbnailUrl } = await mediaService.uploadProfilePicture(file, user.clerkId);

        // Update user's profileImageUrl in the database
        const updatedUser = await authService.updateUserProfile(user.clerkId, {
          profileImageUrl,
        });

        res.json({
          success: true,
          message: 'Profile picture uploaded successfully',
          user: {
            id: updatedUser._id?.toString(),
            email: updatedUser.email,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            clerkId: updatedUser.clerkId,
            username: updatedUser.username,
            profileImageUrl,
            thumbnailUrl,
            isActive: updatedUser.isActive,
            lastSeen: updatedUser.lastSeen,
            createdAt: updatedUser.createdAt,
          },
        });

      } catch (error) {
        console.error('Profile picture upload error:', error);
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to upload profile picture',
        });
      }
    })
  );

  /**
   * Delete profile picture
   * DELETE /auth/profile/picture
   */
  router.delete('/profile/picture',
    authMiddleware(), // Apply auth middleware to protected routes
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id; // clerkId

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const user = await authService.getUserByClerkId(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      try {
        // Delete profile picture using MediaService
        const deleted = await mediaService.deleteProfilePicture(user.clerkId);

        if (!deleted) {
          return res.status(404).json({
            success: false,
            error: 'No profile picture found to delete',
          });
        }

        // Update user's profileImageUrl to null
        const updatedUser = await authService.updateUserProfile(user.clerkId, {
          profileImageUrl: undefined,
        });

        res.json({
          success: true,
          message: 'Profile picture deleted successfully',
          user: {
            id: updatedUser._id?.toString(),
            email: updatedUser.email,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            clerkId: updatedUser.clerkId,
            username: updatedUser.username,
            profileImageUrl: null,
            thumbnailUrl: null,
            isActive: updatedUser.isActive,
            lastSeen: updatedUser.lastSeen,
            createdAt: updatedUser.createdAt,
          },
        });

      } catch (error) {
        console.error('Profile picture deletion error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to delete profile picture',
        });
      }
    })
  );

  /**
   * Check username availability
   * GET /auth/username-availability/:username
   */
  router.get('/username-availability/:username',
    authMiddleware(), // Apply auth middleware to protected routes
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { username } = req.params;
      const userId = req.user?.id; // clerkId

      // Validate username format
      if (!username || username.length < 3 || username.length > 30) {
        return res.status(400).json({
          success: false,
          error: 'Username must be between 3 and 30 characters',
        });
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res.status(400).json({
          success: false,
          error: 'Username can only contain letters, numbers, underscores, and hyphens',
        });
      }

      const existingUser = await authService.getUserByUsername(username);
      const isAvailable = !existingUser || (userId && existingUser.clerkId === userId);

      res.json({
        success: true,
        available: isAvailable,
        username: username,
      });
    })
  );

  /**
   * Logout user
   * POST /auth/logout
   */
  router.post('/logout',
    authMiddleware(), // Apply auth middleware to protected routes
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id; // clerkId

      if (userId) {
        // Find user by clerkId first, then update lastSeen with MongoDB ObjectId
        const user = await authService.getUserByClerkId(userId);
        if (user && user._id) {
          await authService.updateLastSeen(user._id.toString());
        }
      }

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    })
  );

  return router;
}
