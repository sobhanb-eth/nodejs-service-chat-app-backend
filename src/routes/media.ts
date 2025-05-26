import { Router } from 'express';
import multer from 'multer';
import { MongoClient } from 'mongodb';
import { MediaService } from '../services/MediaService';
import { GroupService } from '../services/GroupService';
import { uploadRateLimitMiddleware } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/api';

/**
 * Media routes
 */
export default function createMediaRoutes(db: MongoClient): Router {
  const router = Router();

  // Initialize services
  const mediaService = new MediaService(db);
  const groupService = new GroupService(db);

  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      // Allow only images as per requirements
      const allowedImageTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ];

      if (allowedImageTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP)'));
      }
    },
  });

  /**
   * Upload media file
   * POST /media/upload
   */
  router.post('/upload',
    uploadRateLimitMiddleware,
    upload.single('file'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id;
      const { groupId } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided',
        });
      }

      // Check if user is member of group (if groupId provided)
      if (groupId) {
        const isMember = await groupService.isUserMember(groupId, userId);
        if (!isMember) {
          return res.status(403).json({
            success: false,
            error: 'Access denied',
          });
        }
      }

      const result = await mediaService.uploadFile(req.file, userId, groupId);

      res.status(201).json({
        success: true,
        media: {
          id: result._id?.toString(),
          filename: result.filename,
          originalName: result.originalFilename,
          mimeType: result.mimeType,
          size: result.size,
          url: result.url,
          thumbnailUrl: result.thumbnailUrl,
          uploadedAt: result.createdAt,
        },
      });
    })
  );

  /**
   * Get media file
   * GET /media/:mediaId
   */
  router.get('/:mediaId',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { mediaId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const media = await mediaService.getMediaById(mediaId);

      if (!media) {
        return res.status(404).json({
          success: false,
          error: 'Media not found',
        });
      }

      // Check access permissions
      if (media.messageId) {
        // For now, allow access if user is the uploader
        if (media.uploaderId !== userId) {
          return res.status(403).json({
            success: false,
            error: 'Access denied',
          });
        }
      } else if (media.uploaderId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      res.json({
        success: true,
        media: {
          id: media._id?.toString(),
          filename: media.filename,
          originalName: media.originalFilename,
          mimeType: media.mimeType,
          size: media.size,
          url: media.url,
          thumbnailUrl: media.thumbnailUrl,
          uploadedAt: media.createdAt,
        },
      });
    })
  );

  /**
   * Download media file
   * GET /media/:mediaId/download
   */
  router.get('/:mediaId/download',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { mediaId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const media = await mediaService.getMediaById(mediaId);

      if (!media) {
        return res.status(404).json({
          success: false,
          error: 'Media not found',
        });
      }

      // Check access permissions
      if (media.uploaderId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      // For now, return the signed URL instead of streaming
      const signedUrl = await mediaService.getSignedUrl(media.s3Key);

      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${media.originalFilename}"`);

      // Redirect to signed URL
      res.redirect(signedUrl);
    })
  );

  /**
   * Delete media file
   * DELETE /media/:mediaId
   */
  router.delete('/:mediaId',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { mediaId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const success = await mediaService.deleteMedia(mediaId, userId);

      if (success) {
        res.json({
          success: true,
          message: 'Media deleted successfully',
        });
      } else {
        res.status(403).json({
          success: false,
          error: 'Permission denied or media not found',
        });
      }
    })
  );

  /**
   * Get user's media files
   * GET /media/user/files
   */
  router.get('/user/files',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.id;
      const { limit = 20, offset = 0 } = req.query as any;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const media = await mediaService.getUserMedia(userId, parseInt(limit));

      res.json({
        success: true,
        media: media.map(item => ({
          id: item._id?.toString(),
          filename: item.filename,
          originalName: item.originalFilename,
          mimeType: item.mimeType,
          size: item.size,
          url: item.url,
          thumbnailUrl: item.thumbnailUrl,
          uploadedAt: item.createdAt,
        })),
      });
    })
  );

  return router;
}
