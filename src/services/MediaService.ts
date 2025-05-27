import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MongoClient, ObjectId, Collection } from 'mongodb';
import sharp from 'sharp';
import { createHash } from 'crypto';

interface MediaMetadata {
  _id?: ObjectId;
  messageId?: string;
  uploaderId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  s3Bucket: string;
  url?: string;
  thumbnailUrl?: string;
  isProcessed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProfilePictureMetadata {
  _id?: ObjectId;
  userId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  s3Bucket: string;
  url: string;
  thumbnailUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMediaMetadata {
  _id?: ObjectId;
  messageId?: string;
  groupId: string;
  uploaderId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  s3Bucket: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Media Service for AWS S3 file upload and management
 */
export class MediaService {
  private s3Client: S3Client;
  private db: MongoClient;
  private media: Collection<MediaMetadata>;
  private profilePictures: Collection<ProfilePictureMetadata>;
  private chatMedia: Collection<ChatMediaMetadata>;
  private bucketName: string;

  constructor(db: MongoClient) {
    this.db = db;
    this.media = db.db('RealTimeChatAiApp').collection<MediaMetadata>('media');
    this.profilePictures = db.db('RealTimeChatAiApp').collection<ProfilePictureMetadata>('profile_pictures');
    this.chatMedia = db.db('RealTimeChatAiApp').collection<ChatMediaMetadata>('chat_media');
    this.bucketName = process.env.S3_BUCKET_NAME || 'secure-realtime-chat-media-dev';

    // Validate AWS credentials
    this.validateAWSCredentials();

    this.s3Client = new S3Client({
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      // Add retry configuration for better reliability
      maxAttempts: 3,
      retryMode: 'adaptive',
      // Force path style for compatibility
      forcePathStyle: false,
      // Use virtual hosted style
      useAccelerateEndpoint: false,
    });

    console.log(`🔧 MediaService initialized with bucket: ${this.bucketName}`);
    console.log(`🔧 AWS Region: ${process.env.AWS_DEFAULT_REGION || 'us-east-1'}`);
    console.log(`🔧 AWS Access Key ID: ${process.env.AWS_ACCESS_KEY_ID?.substring(0, 8)}...`);
  }

  /**
   * Validate AWS credentials format and completeness
   */
  private validateAWSCredentials(): void {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_DEFAULT_REGION;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials not found in environment variables');
    }

    // AWS Access Key ID format: 20 characters, starts with AKIA or ASIA
    if (!/^(AKIA|ASIA)[A-Z0-9]{16}$/.test(accessKeyId)) {
      throw new Error('Invalid AWS Access Key ID format');
    }

    // AWS Secret Access Key format: 40 characters, base64-like
    if (secretAccessKey.length !== 40) {
      console.error(`❌ AWS Secret Access Key length is ${secretAccessKey.length}, expected 40 characters`);
      console.error(`❌ Current secret key: ${secretAccessKey}`);
      throw new Error(`Invalid AWS Secret Access Key: expected 40 characters, got ${secretAccessKey.length}`);
    }

    if (!region) {
      throw new Error('AWS region not found in environment variables');
    }

    console.log('✅ AWS credentials validation passed');
  }

  /**
   * Upload profile picture with optimized processing
   */
  async uploadProfilePicture(
    file: Express.Multer.File,
    userId: string
  ): Promise<{ profileImageUrl: string; thumbnailUrl: string }> {
    try {
      // Validate file
      const validation = this.validateProfilePicture(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Generate unique filename for profile picture
      const timestamp = Date.now();
      const hash = createHash('md5').update(file.buffer).digest('hex').substring(0, 8);
      const filename = `profile-${userId}-${timestamp}-${hash}.jpg`;

      // S3 keys for profile pictures
      const profileKey = `profile-pictures/${userId}/${filename}`;
      const thumbnailKey = `profile-pictures/${userId}/thumb-${filename}`;

      // Process main profile image (500x500, high quality)
      const profileBuffer = await sharp(file.buffer)
        .resize(500, 500, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({
          quality: 90,
          progressive: true,
          mozjpeg: true
        })
        .toBuffer();

      // Process thumbnail (150x150, good quality)
      const thumbnailBuffer = await sharp(file.buffer)
        .resize(150, 150, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({
          quality: 85,
          progressive: true,
          mozjpeg: true
        })
        .toBuffer();

      // Upload main profile picture to S3
      const profileUploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: profileKey,
        Body: profileBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=86400', // 24 hours
        Metadata: {
          originalName: file.originalname,
          userId: userId,
          type: 'profile-picture',
          uploadDate: new Date().toISOString(),
        },
      });

      await this.s3Client.send(profileUploadCommand);

      // Upload thumbnail to S3
      const thumbnailUploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=86400', // 24 hours
        Metadata: {
          originalName: file.originalname,
          userId: userId,
          type: 'profile-thumbnail',
          uploadDate: new Date().toISOString(),
        },
      });

      await this.s3Client.send(thumbnailUploadCommand);

      // Generate long-lived signed URLs (24 hours)
      const profileUrl = await this.getSignedUrl(profileKey, 86400);
      const thumbnailUrl = await this.getSignedUrl(thumbnailKey, 86400);

      // Deactivate previous profile pictures
      await this.profilePictures.updateMany(
        { userId, isActive: true },
        { $set: { isActive: false, updatedAt: new Date() } }
      );

      // Save new profile picture metadata
      const profilePictureMetadata: ProfilePictureMetadata = {
        _id: new ObjectId(),
        userId,
        filename,
        originalFilename: file.originalname,
        mimeType: 'image/jpeg',
        size: profileBuffer.length,
        s3Key: profileKey,
        s3Bucket: this.bucketName,
        url: profileUrl,
        thumbnailUrl,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.profilePictures.insertOne(profilePictureMetadata);

      // Clean up old profile pictures (keep only last 3)
      await this.cleanupOldProfilePictures(userId);

      return {
        profileImageUrl: profileUrl,
        thumbnailUrl
      };

    } catch (error) {
      console.error('Error uploading profile picture:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to upload profile picture');
    }
  }

  /**
   * Get current profile picture for user
   */
  async getCurrentProfilePicture(userId: string): Promise<{ profileImageUrl: string; thumbnailUrl: string } | null> {
    try {
      const profilePicture = await this.profilePictures.findOne(
        { userId, isActive: true },
        { sort: { createdAt: -1 } }
      );

      if (!profilePicture) {
        return null;
      }

      // Check if URLs need refreshing (if older than 12 hours)
      const urlAge = Date.now() - profilePicture.updatedAt.getTime();
      if (urlAge > 12 * 60 * 60 * 1000) { // 12 hours
        // Refresh URLs
        const profileUrl = await this.getSignedUrl(profilePicture.s3Key, 86400);
        const thumbnailKey = profilePicture.s3Key.replace('profile-pictures/', 'profile-pictures/').replace(profilePicture.filename, `thumb-${profilePicture.filename}`);
        const thumbnailUrl = await this.getSignedUrl(thumbnailKey, 86400);

        // Update database
        await this.profilePictures.updateOne(
          { _id: profilePicture._id },
          {
            $set: {
              url: profileUrl,
              thumbnailUrl,
              updatedAt: new Date()
            }
          }
        );

        return { profileImageUrl: profileUrl, thumbnailUrl };
      }

      return {
        profileImageUrl: profilePicture.url,
        thumbnailUrl: profilePicture.thumbnailUrl
      };

    } catch (error) {
      console.error('Error getting current profile picture:', error);
      return null;
    }
  }

  /**
   * Delete profile picture
   */
  async deleteProfilePicture(userId: string): Promise<boolean> {
    try {
      const profilePicture = await this.profilePictures.findOne(
        { userId, isActive: true }
      );

      if (!profilePicture) {
        return false;
      }

      // Delete from S3
      const deleteProfileCommand = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: profilePicture.s3Key,
      });
      await this.s3Client.send(deleteProfileCommand);

      // Delete thumbnail from S3
      const thumbnailKey = profilePicture.s3Key.replace(profilePicture.filename, `thumb-${profilePicture.filename}`);
      const deleteThumbnailCommand = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: thumbnailKey,
      });
      await this.s3Client.send(deleteThumbnailCommand);

      // Mark as inactive in database
      await this.profilePictures.updateOne(
        { _id: profilePicture._id },
        { $set: { isActive: false, updatedAt: new Date() } }
      );

      return true;

    } catch (error) {
      console.error('Error deleting profile picture:', error);
      return false;
    }
  }

  /**
   * Validate profile picture file
   */
  validateProfilePicture(file: Express.Multer.File): { valid: boolean; error?: string } {
    const maxSize = 5 * 1024 * 1024; // 5MB for profile pictures
    const allowedImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];

    if (file.size > maxSize) {
      return { valid: false, error: 'Profile picture size exceeds 5MB limit' };
    }

    if (!allowedImageTypes.includes(file.mimetype)) {
      return { valid: false, error: 'Only JPEG, PNG, and WebP images are allowed for profile pictures' };
    }

    // Additional checks for image dimensions
    return { valid: true };
  }

  /**
   * Clean up old profile pictures (keep only last 3)
   */
  async cleanupOldProfilePictures(userId: string): Promise<void> {
    try {
      const oldPictures = await this.profilePictures
        .find({ userId, isActive: false })
        .sort({ createdAt: -1 })
        .skip(3) // Keep 3 most recent inactive pictures
        .toArray();

      for (const picture of oldPictures) {
        // Delete from S3
        const deleteProfileCommand = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: picture.s3Key,
        });
        await this.s3Client.send(deleteProfileCommand);

        // Delete thumbnail
        const thumbnailKey = picture.s3Key.replace(picture.filename, `thumb-${picture.filename}`);
        const deleteThumbnailCommand = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: thumbnailKey,
        });
        await this.s3Client.send(deleteThumbnailCommand);

        // Delete from database
        await this.profilePictures.deleteOne({ _id: picture._id });
      }
    } catch (error) {
      console.error('Error cleaning up old profile pictures:', error);
    }
  }

  /**
   * Upload chat media (images) to S3 with optimization
   */
  async uploadChatMedia(
    file: Express.Multer.File,
    uploaderId: string,
    groupId: string
  ): Promise<ChatMediaMetadata> {
    try {
      // Validate file
      const validation = this.validateChatMedia(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Generate unique filename
      const timestamp = Date.now();
      const hash = createHash('md5').update(file.buffer).digest('hex').substring(0, 8);
      const extension = file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
      const filename = `chat-${uploaderId}-${timestamp}-${hash}.${extension}`;
      const s3Key = `chat-media/${groupId}/${filename}`;
      const thumbnailKey = `chat-media/${groupId}/thumb-${filename}`;

      let processedBuffer = file.buffer;
      let thumbnailBuffer: Buffer | null = null;
      let width: number | undefined;
      let height: number | undefined;

      // Process image with Sharp
      if (file.mimetype.startsWith('image/')) {
        const image = sharp(file.buffer);
        const metadata = await image.metadata();

        width = metadata.width;
        height = metadata.height;

        // Compress and resize main image (max 1920x1080)
        processedBuffer = await image
          .resize(1920, 1080, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({
            quality: 85,
            progressive: true,
            mozjpeg: true
          })
          .toBuffer();

        // Generate thumbnail (300x300)
        thumbnailBuffer = await image
          .resize(300, 300, {
            fit: 'cover',
            position: 'center'
          })
          .jpeg({
            quality: 75,
            progressive: true
          })
          .toBuffer();
      }

      // Upload main image to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: processedBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=86400', // 24 hours
        Metadata: {
          originalName: file.originalname,
          uploaderId: uploaderId,
          groupId: groupId,
          type: 'chat-media',
          uploadDate: new Date().toISOString(),
        },
      });

      await this.s3Client.send(uploadCommand);

      // Upload thumbnail if generated
      let thumbnailUrl: string | undefined;
      if (thumbnailBuffer) {
        const thumbnailUploadCommand = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: thumbnailKey,
          Body: thumbnailBuffer,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=86400',
          Metadata: {
            originalName: file.originalname,
            uploaderId: uploaderId,
            groupId: groupId,
            type: 'chat-thumbnail',
            uploadDate: new Date().toISOString(),
          },
        });

        await this.s3Client.send(thumbnailUploadCommand);
        thumbnailUrl = await this.getSignedUrl(thumbnailKey, 86400);
      }

      // Generate signed URL for main image
      const url = await this.getSignedUrl(s3Key, 86400);

      // Save metadata to database
      const chatMediaMetadata: ChatMediaMetadata = {
        _id: new ObjectId(),
        groupId,
        uploaderId,
        filename,
        originalFilename: file.originalname,
        mimeType: 'image/jpeg',
        size: processedBuffer.length,
        s3Key,
        s3Bucket: this.bucketName,
        url,
        thumbnailUrl,
        width,
        height,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await this.chatMedia.insertOne(chatMediaMetadata);
      const createdMedia = await this.chatMedia.findOne({ _id: result.insertedId });

      if (!createdMedia) {
        throw new Error('Failed to save chat media metadata');
      }

      console.log(`✅ Chat media uploaded successfully: ${filename}`);
      return createdMedia;

    } catch (error) {
      console.error('Error uploading chat media:', error);
      throw error;
    }
  }

  /**
   * Validate chat media file
   */
  validateChatMedia(file: Express.Multer.File): { valid: boolean; error?: string } {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (file.size > maxSize) {
      return { valid: false, error: 'Image size exceeds 10MB limit' };
    }

    if (!allowedImageTypes.includes(file.mimetype)) {
      return { valid: false, error: 'Only image files are allowed (JPEG, PNG, GIF, WebP)' };
    }

    return { valid: true };
  }

  /**
   * Get chat media by group ID
   */
  async getChatMediaByGroup(groupId: string, limit: number = 50): Promise<ChatMediaMetadata[]> {
    return await this.chatMedia
      .find({ groupId, isActive: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Upload file to S3 with compression and thumbnail generation
   */
  async uploadFile(
    file: Express.Multer.File,
    uploaderId: string,
    messageId?: string
  ): Promise<MediaMetadata> {
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const hash = createHash('md5').update(file.buffer).digest('hex').substring(0, 8);
      const extension = file.originalname.split('.').pop() || '';
      const uniqueFilename = `${timestamp}-${hash}.${extension}`;
      const s3Key = `uploads/${uploaderId}/${uniqueFilename}`;

      let processedBuffer = file.buffer;
      let thumbnailBuffer: Buffer | null = null;

      // Process images
      if (file.mimetype.startsWith('image/')) {
        // Compress and resize main image
        processedBuffer = await sharp(file.buffer)
          .resize(1920, 1080, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: 85 })
          .toBuffer();

        // Generate thumbnail
        thumbnailBuffer = await sharp(file.buffer)
          .resize(300, 300, {
            fit: 'cover'
          })
          .jpeg({ quality: 70 })
          .toBuffer();
      }

      // Upload main file to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: processedBuffer,
        ContentType: file.mimetype,
        Metadata: {
          originalName: file.originalname,
          uploaderId: uploaderId,
          messageId: messageId || '',
        },
      });

      await this.s3Client.send(uploadCommand);

      // Upload thumbnail if exists
      let thumbnailKey: string | undefined;
      if (thumbnailBuffer) {
        thumbnailKey = `thumbnails/${uploaderId}/${uniqueFilename}`;
        const thumbnailCommand = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: thumbnailKey,
          Body: thumbnailBuffer,
          ContentType: 'image/jpeg',
        });
        await this.s3Client.send(thumbnailCommand);
      }

      // Generate signed URLs
      const url = await this.getSignedUrl(s3Key);
      const thumbnailUrl = thumbnailKey ? await this.getSignedUrl(thumbnailKey) : undefined;

      // Save metadata to database
      const mediaMetadata: MediaMetadata = {
        _id: new ObjectId(),
        messageId,
        uploaderId,
        filename: uniqueFilename,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        size: processedBuffer.length,
        s3Key,
        s3Bucket: this.bucketName,
        url,
        thumbnailUrl,
        isProcessed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.media.insertOne(mediaMetadata);
      return mediaMetadata;

    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error('Failed to upload file');
    }
  }

  /**
   * Get signed URL for S3 object
   */
  async getSignedUrl(s3Key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Get media metadata by ID
   */
  async getMediaById(mediaId: string): Promise<MediaMetadata | null> {
    return await this.media.findOne({ _id: new ObjectId(mediaId) });
  }

  /**
   * Get media by message ID
   */
  async getMediaByMessageId(messageId: string): Promise<MediaMetadata[]> {
    return await this.media.find({ messageId }).toArray();
  }

  /**
   * Delete media file and metadata
   */
  async deleteMedia(mediaId: string, userId: string): Promise<boolean> {
    try {
      const mediaDoc = await this.getMediaById(mediaId);
      if (!mediaDoc || mediaDoc.uploaderId !== userId) {
        return false; // Not found or not owner
      }

      // Delete from S3
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: mediaDoc.s3Key,
      });
      await this.s3Client.send(deleteCommand);

      // Delete thumbnail if exists
      if (mediaDoc.thumbnailUrl) {
        const thumbnailKey = mediaDoc.s3Key.replace('uploads/', 'thumbnails/');
        const deleteThumbnailCommand = new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: thumbnailKey,
        });
        await this.s3Client.send(deleteThumbnailCommand);
      }

      // Delete from database
      await this.media.deleteOne({ _id: new ObjectId(mediaId) });
      return true;

    } catch (error) {
      console.error('Error deleting media:', error);
      return false;
    }
  }

  /**
   * Refresh signed URLs for media
   */
  async refreshSignedUrls(mediaId: string): Promise<MediaMetadata | null> {
    const mediaDoc = await this.getMediaById(mediaId);
    if (!mediaDoc) return null;

    const url = await this.getSignedUrl(mediaDoc.s3Key);
    let thumbnailUrl: string | undefined;

    if (mediaDoc.thumbnailUrl) {
      const thumbnailKey = mediaDoc.s3Key.replace('uploads/', 'thumbnails/');
      thumbnailUrl = await this.getSignedUrl(thumbnailKey);
    }

    await this.media.updateOne(
      { _id: new ObjectId(mediaId) },
      {
        $set: {
          url,
          thumbnailUrl,
          updatedAt: new Date()
        }
      }
    );

    return { ...mediaDoc, url, thumbnailUrl };
  }

  /**
   * Get user's media files
   */
  async getUserMedia(userId: string, limit: number = 50): Promise<MediaMetadata[]> {
    return await this.media
      .find({ uploaderId: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Validate file type and size
   */
  validateFile(file: Express.Multer.File): { valid: boolean; error?: string } {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedImageTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (file.size > maxSize) {
      return { valid: false, error: 'Image size exceeds 10MB limit' };
    }

    if (!allowedImageTypes.includes(file.mimetype)) {
      return { valid: false, error: 'Only image files are allowed (JPEG, PNG, GIF, WebP)' };
    }

    return { valid: true };
  }

  /**
   * Clean up expired signed URLs (background task)
   */
  async cleanupExpiredUrls(): Promise<void> {
    const expiredMedia = await this.media
      .find({
        updatedAt: { $lt: new Date(Date.now() - 3600 * 1000) } // 1 hour old
      })
      .toArray();

    for (const media of expiredMedia) {
      await this.refreshSignedUrls(media._id!.toString());
    }
  }
}
