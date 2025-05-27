import { Router } from 'express';
import multer from 'multer';
import { MongoClient } from 'mongodb';
import { Server as SocketIOServer } from 'socket.io';
import { MediaService } from '../services/MediaService';
import { GroupService } from '../services/GroupService';
import { MessageService } from '../services/MessageService';
import { AIService } from '../services/AIService';
import { AuthService } from '../services/AuthService';
import { uploadRateLimitMiddleware } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/api';
import { SocketEvents, SocketRooms } from '../config/socket';

/**
 * Media routes
 */
export default function createMediaRoutes(db: MongoClient, io?: SocketIOServer): Router {
  const router = Router();

  // Initialize services
  const mediaService = new MediaService(db);
  const groupService = new GroupService(db);
  const aiService = new AIService(db);
  const messageService = new MessageService(aiService);
  const authService = new AuthService();

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
   * Upload chat media (images) for group messaging
   * POST /media/chat/upload
   */
  router.post('/chat/upload',
    uploadRateLimitMiddleware,
    upload.single('image'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.clerkId; // Use Clerk ID consistently
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
          error: 'No image file provided',
        });
      }

      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied - not a group member',
        });
      }

      try {
        const result = await mediaService.uploadChatMedia(req.file, userId, groupId);

        res.status(201).json({
          success: true,
          message: 'Image uploaded successfully',
          media: {
            id: result._id?.toString(),
            filename: result.filename,
            originalName: result.originalFilename,
            mimeType: result.mimeType,
            size: result.size,
            url: result.url,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            uploadedAt: result.createdAt,
          },
        });
      } catch (error) {
        console.error('Error uploading chat media:', error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to upload image',
        });
      }
    })
  );

  /**
   * Upload image and create message in one step
   * POST /media/chat/send
   */
  router.post('/chat/send',
    uploadRateLimitMiddleware,
    upload.single('image'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const userId = req.user?.clerkId; // Use Clerk ID consistently
      const { groupId, caption } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided',
        });
      }

      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied - not a group member',
        });
      }

      try {
        // Upload media to S3
        const mediaResult = await mediaService.uploadChatMedia(req.file, userId, groupId);

        // Create message with media
        const message = await messageService.createMediaMessage(
          groupId,
          userId,
          mediaResult.url,
          'image',
          caption,
          {
            filename: mediaResult.filename,
            originalFilename: mediaResult.originalFilename,
            size: mediaResult.size,
            width: mediaResult.width,
            height: mediaResult.height,
            thumbnailUrl: mediaResult.thumbnailUrl,
          }
        );

        // CRITICAL: Broadcast the message via Socket.io for real-time updates
        console.log('🔍 Socket.io instance available:', !!io);
        if (io) {
          console.log('🚀 Starting Socket.io broadcast for image message...');
          try {
            // Get user details for Socket.io message format
            console.log('🔍 Looking up user by Clerk ID:', userId);
            const user = await authService.getUserByClerkId(userId);
            console.log('👤 User lookup result:', user ? 'Found' : 'Not found');

            if (user) {
              // Transform message for frontend (same format as messageHandler.ts)
              const transformedMessage = {
                id: message._id?.toString(),
                content: message.content,
                senderId: message.senderId, // Clerk ID
                senderEmail: user.email,
                timestamp: message.createdAt?.toISOString(),
                roomId: message.groupId.toString(),
                type: message.type, // 'image'
              };

              // Broadcast new message to group members
              io.to(SocketRooms.group(groupId)).emit(SocketEvents.NEW_MESSAGE, {
                message: transformedMessage,
                sender: {
                  _id: user._id,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  username: user.username,
                  profileImageUrl: user.profileImageUrl,
                },
              });

              console.log(`✅ Image message broadcasted via Socket.io: ${message._id} in group: ${groupId}`);
            } else {
              console.warn('⚠️ User not found for Socket.io broadcast, userId:', userId);
            }
          } catch (socketError) {
            console.error('❌ Error broadcasting image message via Socket.io:', socketError);
            // Don't fail the request if Socket.io broadcast fails
          }
        } else {
          console.warn('⚠️ Socket.io instance not available for broadcasting');
        }

        res.status(201).json({
          success: true,
          message: 'Image message sent successfully',
          data: {
            messageId: message._id?.toString(),
            mediaId: mediaResult._id?.toString(),
            url: mediaResult.url,
            thumbnailUrl: mediaResult.thumbnailUrl,
            caption: caption || '',
            createdAt: message.createdAt,
          },
        });
      } catch (error) {
        console.error('Error sending image message:', error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to send image message',
        });
      }
    })
  );

  /**
   * Upload media file (legacy endpoint)
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
   * Get chat media for a group
   * GET /media/chat/group/:groupId
   */
  router.get('/chat/group/:groupId',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { groupId } = req.params;
      const userId = req.user?.clerkId; // Use Clerk ID consistently
      const limit = parseInt(req.query.limit as string) || 50;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied - not a group member',
        });
      }

      try {
        const mediaList = await mediaService.getChatMediaByGroup(groupId, limit);

        res.json({
          success: true,
          media: mediaList.map(media => ({
            id: media._id?.toString(),
            filename: media.filename,
            originalName: media.originalFilename,
            mimeType: media.mimeType,
            size: media.size,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            width: media.width,
            height: media.height,
            uploaderId: media.uploaderId,
            uploadedAt: media.createdAt,
          })),
        });
      } catch (error) {
        console.error('Error fetching chat media:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch media',
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
      const { limit = 20 } = req.query as any;

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
