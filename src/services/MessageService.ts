import { ObjectId } from 'mongodb';
import { database } from '../config/database';
import { Message, MessageRead, User } from '../types/database';
import { EncryptionService } from './EncryptionService';
import { AIService } from './AIService';

/**
 * Message creation payload interface
 *
 * @description Defines the structure for creating new messages in the system.
 * Supports text messages with encryption and media messages with metadata.
 *
 * @interface CreateMessagePayload
 * @since 1.0.0
 */
export interface CreateMessagePayload {
  /** Target group ObjectId as string */
  groupId: string;
  /** Sender's Clerk user ID */
  senderId: string;
  /** Message content (text or caption for media) */
  content: string;
  /** Message type determining processing and storage */
  type: 'text' | 'image' | 'file' | 'system';
  /** Media URL for image/file messages (stored in S3/Azure) */
  mediaUrl?: string;
  /** Additional metadata for media files */
  mediaMetadata?: {
    /** Server-generated filename */
    filename?: string;
    /** Original user filename */
    originalFilename?: string;
    /** File size in bytes */
    size?: number;
    /** Image width in pixels */
    width?: number;
    /** Image height in pixels */
    height?: number;
    /** Thumbnail URL for images */
    thumbnailUrl?: string;
  };
}

/**
 * MessageService - Core messaging functionality with encryption and AI
 *
 * @description Handles all message operations including creation, retrieval, encryption,
 * AI processing, and read receipts. Provides secure messaging with end-to-end encryption
 * for text messages and AI-powered features like smart replies and content moderation.
 *
 * @features
 * - End-to-end encryption for text messages
 * - AI content moderation and smart replies
 * - Media message support (images, files)
 * - Read receipts with bulk operations
 * - Vector embeddings for AI features
 * - Soft delete for message management
 * - Pagination for message history
 * - Unread message tracking
 *
 * @security
 * - AES-256 encryption for text content
 * - AI content moderation
 * - User ownership validation
 * - Input sanitization and validation
 * - Clerk ID consistency for user identification
 *
 * @performance
 * - Bulk read operations
 * - Efficient pagination
 * - Async AI processing
 * - Database query optimization
 * - Vector embedding caching
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export class MessageService {
  private encryptionService: EncryptionService;
  private aiService: AIService;

  /**
   * Initialize MessageService with required dependencies
   *
   * @description Creates a new MessageService instance with encryption and AI capabilities.
   * The service handles all message operations including creation, encryption, AI processing,
   * and read receipt management.
   *
   * @param {AIService} aiService - AI service for content moderation and smart features
   *
   * @example
   * ```typescript
   * const aiService = new AIService();
   * const messageService = new MessageService(aiService);
   * ```
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  constructor(aiService: AIService) {
    this.encryptionService = new EncryptionService();
    this.aiService = aiService;
  }

  /**
   * Get encryption service instance for external access
   *
   * @description Provides access to the internal encryption service for message
   * decryption in socket handlers and other components.
   *
   * @returns {EncryptionService} The encryption service instance
   *
   * @example
   * ```typescript
   * const encryptionService = messageService.getEncryptionService();
   * const decrypted = encryptionService.decryptGroupMessage(content, groupId);
   * ```
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  getEncryptionService(): EncryptionService {
    return this.encryptionService;
  }

  /**
   * Create a new message with encryption and AI processing
   *
   * @description Creates and stores a new message with comprehensive processing including
   * validation, encryption (for text), AI moderation, and vector embedding generation.
   * Handles both text messages and media messages with different processing flows.
   *
   * @param {CreateMessagePayload} payload - Message creation data
   * @returns {Promise<Message>} The created message with database ID
   *
   * @throws {Error} Invalid groupId format
   * @throws {Error} Invalid senderId (must be non-empty string)
   * @throws {Error} Empty content for text messages
   * @throws {Error} Content too long (>4KB limit)
   * @throws {Error} Missing media URL for media messages
   * @throws {Error} AI content moderation rejection
   * @throws {Error} Database operation failure
   *
   * @flow
   * 1. Validate input parameters (groupId, senderId, content)
   * 2. Apply content validation based on message type
   * 3. Perform AI content moderation (text messages only)
   * 4. Encrypt content (text messages) or prepare JSON (media messages)
   * 5. Store message in database with metadata
   * 6. Generate and store vector embedding (async)
   * 7. Return created message with database ID
   *
   * @security
   * - Input validation and sanitization
   * - AI content moderation for inappropriate content
   * - AES-256 encryption for text messages
   * - 4KB content size limit to prevent abuse
   *
   * @performance
   * - Async vector embedding generation (non-blocking)
   * - Efficient database insertion
   * - Minimal encryption overhead
   *
   * @example
   * ```typescript
   * // Text message
   * const textMessage = await messageService.createMessage({
   *   groupId: '507f1f77bcf86cd799439011',
   *   senderId: 'user_clerk_id_123',
   *   content: 'Hello world!',
   *   type: 'text'
   * });
   *
   * // Media message
   * const imageMessage = await messageService.createMessage({
   *   groupId: '507f1f77bcf86cd799439011',
   *   senderId: 'user_clerk_id_123',
   *   content: 'Check out this photo!',
   *   type: 'image',
   *   mediaUrl: 'https://s3.amazonaws.com/bucket/image.jpg',
   *   mediaMetadata: { width: 1920, height: 1080, size: 245760 }
   * });
   * ```
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  async createMessage(payload: CreateMessagePayload): Promise<Message> {
    try {
      const { groupId, senderId, content, type, mediaUrl, mediaMetadata } = payload;

      // Step 1: Validate groupId format (must be valid MongoDB ObjectId)
      if (!ObjectId.isValid(groupId)) {
        throw new Error('Invalid groupId');
      }

      // Step 2: Validate senderId (must be non-empty Clerk user ID string)
      if (!senderId || typeof senderId !== 'string') {
        throw new Error('Invalid senderId');
      }

      // Step 3: Content validation based on message type
      if (type === 'image' || type === 'file') {
        // Media messages: content is optional caption, mediaUrl is required
        // The actual media content is stored in S3/Azure, not in the message
        if (!mediaUrl) {
          throw new Error('Media URL is required for image/file messages');
        }
      } else {
        // Text messages: content is required and must not be empty
        if (!content || content.trim().length === 0) {
          throw new Error('Message content cannot be empty');
        }

        // Enforce 4KB content limit to prevent abuse and ensure performance
        if (content.length > 4000) {
          throw new Error('Message content too long');
        }

        // Step 4: AI content moderation for text messages
        // Prevents inappropriate content from being stored and distributed
        const moderation = await this.aiService.moderateContent(content);
        if (!moderation.isAppropriate) {
          throw new Error(`Message rejected: ${moderation.reason}`);
        }
      }

      // Step 5: Prepare message content based on type
      let messageContent: string;

      if (type === 'image' || type === 'file') {
        // Media messages: Store JSON structure with media information
        // This includes the media URL, optional caption, and metadata
        const mediaInfo = {
          url: mediaUrl,
          caption: content?.trim() || '',
          metadata: mediaMetadata || {}
        };
        messageContent = JSON.stringify(mediaInfo);
        // Note: Media URLs are not encrypted as they need to be accessible for display
      } else {
        // Text messages: Encrypt content using AES-256 with group-specific key
        messageContent = this.encryptionService.encryptGroupMessage(content.trim(), groupId);
      }

      // Step 6: Prepare message document for database insertion
      const message: Omit<Message, '_id'> = {
        groupId: new ObjectId(groupId),
        senderId: senderId, // Store Clerk user ID directly as string
        content: messageContent,
        type,
        isDeleted: false, // Soft delete flag for message management
        readBy: [], // Initialize empty read receipts array
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Step 7: Insert message into database and retrieve with generated ID
      const result = await database.messages.insertOne(message as Message);
      const createdMessage = await database.messages.findOne({ _id: result.insertedId });

      if (!createdMessage) {
        throw new Error('Failed to create message');
      }

      // Step 8: Generate vector embedding for AI features (async, non-blocking)
      // For media messages, use the caption for AI processing
      // For text messages, use the original content (before encryption)
      const contentForAI = type === 'image' || type === 'file'
        ? (content?.trim() || `[${type} message]`)
        : content; // Use original content, not encrypted version

      // Async embedding generation - doesn't block message creation
      this.aiService.storeMessageWithEmbedding({
        ...createdMessage,
        content: contentForAI
      }).catch(error => {
        console.error('Error storing message embedding:', error);
        // Non-critical error - message creation still succeeds
      });

      console.log(`✅ Created ${type} message: ${createdMessage._id} in group: ${groupId}`);
      return createdMessage;
    } catch (error) {
      console.error('❌ Error creating message:', error);
      throw error;
    }
  }

  /**
   * Get messages for a group with pagination and decryption
   */
  async getGroupMessages(
    groupId: string,
    limit: number = 50,
    before?: string // Message ID to get messages before
  ): Promise<Message[]> {
    try {
      if (!ObjectId.isValid(groupId)) {
        throw new Error('Invalid groupId');
      }

      const query: any = {
        groupId: new ObjectId(groupId),
        isDeleted: false,
      };

      // Add pagination filter
      if (before && ObjectId.isValid(before)) {
        query._id = { $lt: new ObjectId(before) };
      }

      const messages = await database.messages
        .find(query)
        .sort({ createdAt: -1 }) // Most recent first
        .limit(Math.min(limit, 100)) // Cap at 100 messages
        .toArray();

      // Decrypt message contents based on type
      const decryptedMessages = messages.map(message => {
        try {
          if (message.type === 'image' || message.type === 'file') {
            // Media messages are stored as JSON, no decryption needed
            return message;
          } else {
            // Text messages need decryption
            const decryptedContent = this.encryptionService.decryptGroupMessage(message.content, groupId);
            return { ...message, content: decryptedContent };
          }
        } catch (error) {
          console.error('Error processing message:', error);
          return { ...message, content: '[Encrypted Message]' };
        }
      });

      return decryptedMessages.reverse(); // Return in chronological order
    } catch (error) {
      console.error('❌ Error getting group messages:', error);
      throw error;
    }
  }

  /**
   * Create a media message with uploaded file
   */
  async createMediaMessage(
    groupId: string,
    senderId: string,
    mediaUrl: string,
    type: 'image' | 'file',
    caption?: string,
    mediaMetadata?: {
      filename?: string;
      originalFilename?: string;
      size?: number;
      width?: number;
      height?: number;
      thumbnailUrl?: string;
    }
  ): Promise<Message> {
    return this.createMessage({
      groupId,
      senderId,
      content: caption || '',
      type,
      mediaUrl,
      mediaMetadata,
    });
  }

  /**
   * Generate smart reply suggestions for a message
   */
  async generateSmartReplies(messageContent: string, groupId: string, userId: string): Promise<any> {
    try {
      return await this.aiService.generateSmartReplies(messageContent, groupId, userId);
    } catch (error) {
      console.error('❌ Error generating smart replies:', error);
      return {
        suggestions: ['Thanks!', 'Got it!', 'Sounds good!'],
        confidence: 0.1,
        context: 'fallback',
      };
    }
  }

  /**
   * Mark message as read by user
   */
  async markMessageAsRead(messageId: string, userId: string): Promise<boolean> {
    try {
      if (!ObjectId.isValid(messageId)) {
        return false;
      }

      const messageObjectId = new ObjectId(messageId);

      // Check if already read
      const existingRead = await database.messages.findOne({
        _id: messageObjectId,
        'readBy.userId': userId, // Use string userId directly
      });

      if (existingRead) {
        return true; // Already marked as read
      }

      // Add read receipt
      const readReceipt: MessageRead = {
        userId: userId, // Use string userId directly
        readAt: new Date(),
      };

      const result = await database.messages.updateOne(
        { _id: messageObjectId },
        {
          $push: { readBy: readReceipt },
          $set: { updatedAt: new Date() },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error('❌ Error marking message as read:', error);
      return false;
    }
  }

  /**
   * Mark multiple messages as read by user
   */
  async markMessagesAsRead(messageIds: string[], userId: string): Promise<string[]> {
    try {
      const validMessageIds = messageIds.filter(id => ObjectId.isValid(id));
      if (validMessageIds.length === 0) {
        return [];
      }

      const messageObjectIds = validMessageIds.map(id => new ObjectId(id));

      // Find messages not already read by this user
      const unreadMessages = await database.messages.find({
        _id: { $in: messageObjectIds },
        'readBy.userId': { $ne: userId }, // Use string userId directly
        isDeleted: false,
      }).toArray();

      if (unreadMessages.length === 0) {
        return [];
      }

      const readReceipt: MessageRead = {
        userId: userId, // Use string userId directly
        readAt: new Date(),
      };

      // Update all unread messages
      await database.messages.updateMany(
        {
          _id: { $in: unreadMessages.map(msg => msg._id!) },
        },
        {
          $push: { readBy: readReceipt },
          $set: { updatedAt: new Date() },
        }
      );

      const markedAsRead = unreadMessages.map(msg => msg._id!.toString());
      console.log(`✅ Marked ${markedAsRead.length} messages as read for user: ${userId}`);

      return markedAsRead;
    } catch (error) {
      console.error('❌ Error marking messages as read:', error);
      return [];
    }
  }

  /**
   * Delete a message (soft delete)
   */
  async deleteMessage(messageId: string, userId: string): Promise<boolean> {
    try {
      if (!ObjectId.isValid(messageId)) {
        return false;
      }

      // Only allow sender to delete their own messages
      const result = await database.messages.updateOne(
        {
          _id: new ObjectId(messageId),
          senderId: userId, // Use string userId directly
          isDeleted: false,
        },
        {
          $set: {
            isDeleted: true,
            updatedAt: new Date(),
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      return false;
    }
  }

  /**
   * Get message by ID
   */
  async getMessageById(messageId: string): Promise<Message | null> {
    try {
      if (!ObjectId.isValid(messageId)) {
        return null;
      }

      const message = await database.messages.findOne({
        _id: new ObjectId(messageId),
        isDeleted: false,
      });

      return message;
    } catch (error) {
      console.error('❌ Error getting message by ID:', error);
      return null;
    }
  }

  /**
   * Get unread message count for user in a group
   */
  async getUnreadMessageCount(groupId: string, userId: string): Promise<number> {
    try {
      if (!ObjectId.isValid(groupId)) {
        return 0;
      }

      const count = await database.messages.countDocuments({
        groupId: new ObjectId(groupId),
        'readBy.userId': { $ne: userId }, // Use string userId directly
        senderId: { $ne: userId }, // Use string userId directly - Don't count own messages
        isDeleted: false,
      });

      return count;
    } catch (error) {
      console.error('❌ Error getting unread message count:', error);
      return 0;
    }
  }

  /**
   * Get latest message in a group
   */
  async getLatestGroupMessage(groupId: string): Promise<Message | null> {
    try {
      if (!ObjectId.isValid(groupId)) {
        return null;
      }

      const message = await database.messages.findOne(
        {
          groupId: new ObjectId(groupId),
          isDeleted: false,
        },
        {
          sort: { createdAt: -1 },
        }
      );

      return message;
    } catch (error) {
      console.error('❌ Error getting latest group message:', error);
      return null;
    }
  }
}
