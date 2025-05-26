import { ObjectId } from 'mongodb';
import { database } from '../config/database';
import { Message, MessageRead, User } from '../types/database';
import { EncryptionService } from './EncryptionService';
import { AIService } from './AIService';

/**
 * Message creation payload
 */
export interface CreateMessagePayload {
  groupId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'file' | 'system';
}

/**
 * Enhanced Message service with encryption and AI features
 */
export class MessageService {
  private encryptionService: EncryptionService;
  private aiService: AIService;

  constructor(aiService: AIService) {
    this.encryptionService = new EncryptionService();
    this.aiService = aiService;
  }
  /**
   * Create a new message with encryption and AI processing
   */
  async createMessage(payload: CreateMessagePayload): Promise<Message> {
    try {
      const { groupId, senderId, content, type } = payload;

      // Validate groupId as ObjectId, senderId is Clerk user ID string
      if (!ObjectId.isValid(groupId)) {
        throw new Error('Invalid groupId');
      }

      // Validate senderId as non-empty string (Clerk user ID)
      if (!senderId || typeof senderId !== 'string') {
        throw new Error('Invalid senderId');
      }

      // Validate content
      if (!content || content.trim().length === 0) {
        throw new Error('Message content cannot be empty');
      }

      if (content.length > 4000) { // 4KB limit
        throw new Error('Message content too long');
      }

      // Moderate content using AI
      const moderation = await this.aiService.moderateContent(content);
      if (!moderation.isAppropriate) {
        throw new Error(`Message rejected: ${moderation.reason}`);
      }

      // Encrypt message content
      const encryptedContent = this.encryptionService.encryptGroupMessage(content.trim(), groupId);

      const message: Omit<Message, '_id'> = {
        groupId: new ObjectId(groupId),
        senderId: senderId, // Use string senderId directly
        content: encryptedContent,
        type,
        isDeleted: false,
        readBy: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await database.messages.insertOne(message as Message);
      const createdMessage = await database.messages.findOne({ _id: result.insertedId });

      if (!createdMessage) {
        throw new Error('Failed to create message');
      }

      // Store message with vector embedding for AI features (async)
      this.aiService.storeMessageWithEmbedding(createdMessage).catch(error => {
        console.error('Error storing message embedding:', error);
      });

      console.log(`✅ Created encrypted message: ${createdMessage._id} in group: ${groupId}`);
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

      // Decrypt message contents
      const decryptedMessages = messages.map(message => {
        try {
          const decryptedContent = this.encryptionService.decryptGroupMessage(message.content, groupId);
          return { ...message, content: decryptedContent };
        } catch (error) {
          console.error('Error decrypting message:', error);
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
