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

/**
 * Media Service for AWS S3 file upload and management
 */
export class MediaService {
  private s3Client: S3Client;
  private db: MongoClient;
  private media: Collection<MediaMetadata>;
  private bucketName: string;

  constructor(db: MongoClient) {
    this.db = db;
    this.media = db.db('RealTimeChatAiApp').collection<MediaMetadata>('media');
    this.bucketName = process.env.S3_BUCKET_NAME || 'secure-realtime-chat-media-dev';

    this.s3Client = new S3Client({
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
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
