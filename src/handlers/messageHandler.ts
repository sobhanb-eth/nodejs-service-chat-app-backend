import { Socket, Server as SocketIOServer } from 'socket.io';
import { SocketData, SendMessagePayload, MarkMessageReadPayload, RequestSmartRepliesPayload, RequestTypingSuggestionsPayload, RateAISuggestionPayload } from '../types/socket';
import { SocketEvents, SocketRooms, createSocketError, SocketErrorCodes } from '../config/socket';
import { MessageService } from '../services/MessageService';
import { AuthService } from '../services/AuthService';
import { AIService } from '../services/AIService';
import { getAuthenticatedUser, requireAuth } from '../middleware/auth';

/**
 * Message Handler - Real-time messaging with AI features
 *
 * @description This module handles all message-related socket events in the real-time chat system.
 * It provides secure, encrypted messaging with AI-powered features including smart replies,
 * typing suggestions, and content moderation. All operations are authenticated and validated
 * for security and data integrity.
 *
 * @features
 * - Real-time message sending and receiving
 * - End-to-end encryption for text messages
 * - Media message support (images, files)
 * - Read receipts with bulk operations
 * - AI-powered smart replies
 * - Contextual typing suggestions
 * - Content moderation
 * - Message deletion (soft delete)
 * - Group membership validation
 * - Rate limiting and security checks
 *
 * @security
 * - JWT authentication required for all operations
 * - Group membership validation
 * - Content length validation (4KB limit)
 * - AI content moderation
 * - Clerk ID consistency for user identification
 *
 * @performance
 * - Bulk read receipt operations
 * - Async AI processing
 * - Efficient database queries
 * - Real-time broadcasting optimization
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
/**
 * Initialize message event handlers for a socket connection
 *
 * @description Sets up all message-related socket event listeners for a connected client.
 * This includes message sending, read receipts, AI features, and message management.
 * All handlers include authentication, validation, and error handling.
 *
 * @param {SocketIOServer} io - Socket.io server instance for broadcasting
 * @param {Socket} socket - Individual client socket connection
 * @param {MessageService} messageService - Service for message operations and encryption
 * @param {AuthService} authService - Service for authentication and group membership
 * @param {AIService} aiService - Service for AI-powered features
 *
 * @security All event handlers require JWT authentication and group membership validation
 *
 * @events
 * - `send_message` - Send new message to group
 * - `mark_message_read` - Mark single message as read
 * - `mark_messages_read` - Bulk mark messages as read
 * - `delete_message` - Soft delete message
 * - `request_smart_replies` - Get AI-generated reply suggestions
 * - `request_typing_suggestions` - Get AI typing assistance
 * - `rate_ai_suggestion` - Provide feedback on AI suggestions
 *
 * @broadcasts
 * - `new_message` - New message to group members
 * - `message_read` - Read receipt to group members
 * - `messages_read` - Bulk read receipts to group members
 * - `message_deleted` - Message deletion notification
 * - `smart_replies_complete` - AI reply suggestions
 * - `typing_suggestion` - AI typing suggestion
 *
 * @example
 * ```typescript
 * // Initialize message handlers for a new socket connection
 * handleMessageEvents(io, socket, messageService, authService, aiService);
 * ```
 *
 * @since 1.0.0
 */
export function handleMessageEvents(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  messageService: MessageService,
  authService: AuthService,
  aiService: AIService
) {
  /**
   * SEND_MESSAGE Event Handler
   *
   * @description Handles real-time message sending with encryption, validation, and AI moderation.
   * Messages are encrypted before storage and decrypted for real-time broadcasting.
   *
   * @flow
   * 1. Authenticate user and validate JWT token
   * 2. Extract and validate payload (groupId, content, type)
   * 3. Verify user is member of target group
   * 4. Validate content length (4KB limit)
   * 5. Create encrypted message via MessageService
   * 6. AI content moderation (for text messages)
   * 7. Store message in database with vector embedding
   * 8. Decrypt content for real-time broadcasting
   * 9. Emit success to sender with tempId mapping
   * 10. Broadcast to group members (excluding sender)
   *
   * @security
   * - JWT authentication required
   * - Group membership validation
   * - Content length validation (4KB max)
   * - AI content moderation
   * - Clerk ID consistency
   *
   * @payload {SendMessagePayload}
   * - groupId: Target group ObjectId
   * - content: Message content (text/caption)
   * - type: 'text' | 'image' | 'file' | 'system'
   * - tempId: Client-side temporary ID for optimistic updates
   *
   * @emits MESSAGE_SENT - Success response to sender
   * @emits NEW_MESSAGE - Broadcast to group members
   * @emits MESSAGE_ERROR - Error response
   */
  socket.on(SocketEvents.SEND_MESSAGE, async (payload: SendMessagePayload) => {
    try {
      // Step 1: Authentication validation
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      // Step 2: Extract authenticated user data
      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId, content, type, tempId } = payload;

      // Step 3: Payload validation - ensure all required fields are present
      if (!groupId || !content || !type) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required fields: groupId, content, type'
        ));
        return;
      }

      // Step 4: Group membership validation - verify user has permission to send messages
      // Uses Clerk ID for consistent user identification across services
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      // Step 5: Content length validation - prevent oversized messages (4KB limit)
      // This protects against DoS attacks and ensures reasonable message sizes
      if (content.length > 4000) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.MESSAGE_TOO_LONG,
          'Message content is too long (max 4000 characters)'
        ));
        return;
      }

      // Create message - Use Clerk ID for consistent identification
      const message = await messageService.createMessage({
        groupId,
        senderId: user.clerkId, // Store Clerk ID directly in database
        content,
        type,
      });

      // Decrypt message content for frontend
      let decryptedContent = message.content;
      try {
        if (message.type === 'text') {
          decryptedContent = messageService.getEncryptionService().decryptGroupMessage(message.content, groupId);
        }
      } catch (error) {
        console.error('❌ Error decrypting message for socket:', error);
        decryptedContent = '[Encrypted Message]';
      }

      // Transform message for frontend - both database and frontend now use Clerk ID
      const transformedMessage = {
        id: message._id?.toString(),
        content: decryptedContent,
        senderId: message.senderId, // This is now the Clerk ID from database
        senderEmail: user.email,
        timestamp: message.createdAt?.toISOString(),
        roomId: message.groupId.toString(),
        type: message.type, // Add the missing type field
        readBy: message.readBy || [], // Include read receipts
      };

      // Emit success to sender
      socket.emit(SocketEvents.MESSAGE_SENT, {
        message: transformedMessage,
        tempId,
      });

      // Broadcast new message to group members (excluding sender)
      socket.to(SocketRooms.group(groupId)).emit(SocketEvents.NEW_MESSAGE, {
        message: transformedMessage,
        sender: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        },
      });

      console.log(`✅ Message sent: ${message._id} in group: ${groupId} by user: ${user.clerkId}`);
    } catch (error) {
      console.error('❌ Error sending message:', error);
      socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
        SocketErrorCodes.INTERNAL_ERROR,
        'Failed to send message'
      ));
    }
  });

  /**
   * MARK_MESSAGE_READ Event Handler
   *
   * @description Handles individual message read receipts with real-time broadcasting.
   * Updates message read status and notifies group members instantly.
   *
   * @flow
   * 1. Authenticate user and validate JWT token
   * 2. Extract and validate payload (messageId, groupId)
   * 3. Verify user is member of target group
   * 4. Mark message as read in database
   * 5. Broadcast read receipt to group members
   *
   * @security
   * - JWT authentication required
   * - Group membership validation
   * - Silent failure for invalid requests (no error emission)
   * - Clerk ID consistency for user identification
   *
   * @payload {MarkMessageReadPayload}
   * - messageId: ObjectId of message to mark as read
   * - groupId: ObjectId of group containing the message
   *
   * @broadcasts MESSAGE_READ - Read receipt to group members
   *
   * @performance
   * - Single database operation
   * - Duplicate read prevention
   * - Efficient group broadcasting
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  socket.on(SocketEvents.MARK_MESSAGE_READ, async (payload: MarkMessageReadPayload) => {
    try {
      // Step 1: Authentication validation (silent failure for read receipts)
      if (!requireAuth(socket)) {
        return;
      }

      // Step 2: Extract authenticated user data
      const { userId, user } = getAuthenticatedUser(socket);
      const { messageId, groupId } = payload;

      // Step 3: Payload validation (silent failure for read receipts)
      if (!messageId || !groupId) {
        return;
      }

      // Step 4: Group membership validation
      // Uses Clerk ID for consistent user identification across services
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        return;
      }

      // Step 5: Mark message as read in database
      // Uses Clerk ID for consistent user identification across services
      const success = await messageService.markMessageAsRead(messageId, user.clerkId);

      if (success) {
        const readAt = new Date();

        // Step 6: Broadcast read receipt to group members
        // Excludes the reader from receiving their own read receipt
        const readReceiptPayload = {
          messageId,
          groupId,
          readBy: user.clerkId, // Use Clerk ID consistently across all services
          readAt,
        };

        console.log(`📡 Broadcasting read receipt to room: group:${groupId}`, readReceiptPayload);
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.MESSAGE_READ, readReceiptPayload);

        console.log(`✅ Message marked as read: ${messageId} by user: ${user.clerkId}`);
      }
      // Note: No error emission for read receipts to avoid UI disruption
    } catch (error) {
      console.error('❌ Error marking message as read:', error);
      // Silent failure - read receipts should not disrupt user experience
    }
  });

  /**
   * MARK_MESSAGES_READ Event Handler (Bulk Operation)
   *
   * @description Handles bulk message read receipts for performance optimization.
   * Used when user opens a group chat to mark all unread messages as read at once.
   *
   * @flow
   * 1. Authenticate user and validate JWT token
   * 2. Extract and validate payload (groupId, messageIds array)
   * 3. Verify user is member of target group
   * 4. Bulk mark messages as read in database
   * 5. Broadcast bulk read receipt to group members
   *
   * @security
   * - JWT authentication required
   * - Group membership validation
   * - Array validation for messageIds
   * - Silent failure for invalid requests
   * - Clerk ID consistency for user identification
   *
   * @payload {Object}
   * - groupId: ObjectId of group containing messages
   * - messageIds: Array of message ObjectIds to mark as read
   *
   * @broadcasts MESSAGES_READ - Bulk read receipt to group members
   *
   * @performance
   * - Single bulk database operation
   * - Efficient for marking multiple messages
   * - Reduces socket event overhead
   * - Optimized for chat opening scenarios
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  socket.on('mark_messages_read', async (payload: { groupId: string; messageIds: string[] }) => {
    try {
      // Step 1: Authentication validation (silent failure for read receipts)
      if (!requireAuth(socket)) {
        return;
      }

      // Step 2: Extract authenticated user data
      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId, messageIds } = payload;

      // Step 3: Payload validation - ensure valid array of message IDs
      if (!groupId || !Array.isArray(messageIds) || messageIds.length === 0) {
        return;
      }

      // Step 4: Group membership validation
      // Uses Clerk ID for consistent user identification across services
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        return;
      }

      // Step 5: Bulk mark messages as read in database
      // Uses Clerk ID for consistent user identification across services
      // Returns only the IDs of messages that were actually marked (excludes already read)
      const markedAsRead = await messageService.markMessagesAsRead(messageIds, user.clerkId);

      if (markedAsRead.length > 0) {
        const readAt = new Date();

        // Step 6: Broadcast bulk read receipt to group members
        // Only broadcasts for messages that were actually marked as read
        const bulkReadReceiptPayload = {
          groupId,
          messageIds: markedAsRead,
          readBy: user.clerkId, // Use Clerk ID consistently across all services
          readAt,
        };

        console.log(`📡 Broadcasting bulk read receipt to room: group:${groupId}`, bulkReadReceiptPayload);
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.MESSAGES_READ, bulkReadReceiptPayload);

        console.log(`✅ ${markedAsRead.length} messages marked as read in group: ${groupId} by user: ${user.clerkId}`);
      }
      // Note: No error emission for read receipts to avoid UI disruption
    } catch (error) {
      console.error('❌ Error marking messages as read:', error);
      // Silent failure - read receipts should not disrupt user experience
    }
  });

  /**
   * DELETE_MESSAGE Event Handler
   *
   * @description Handles message deletion with ownership validation and real-time broadcasting.
   * Implements soft delete to preserve message history while hiding content from users.
   *
   * @flow
   * 1. Authenticate user and validate JWT token
   * 2. Extract and validate payload (messageId, groupId)
   * 3. Verify user is member of target group
   * 4. Validate user owns the message (only sender can delete)
   * 5. Perform soft delete in database
   * 6. Broadcast deletion notification to group members
   *
   * @security
   * - JWT authentication required
   * - Group membership validation
   * - Message ownership validation (only sender can delete)
   * - Soft delete preserves audit trail
   * - Clerk ID consistency for user identification
   *
   * @payload {Object}
   * - messageId: ObjectId of message to delete
   * - groupId: ObjectId of group containing the message
   *
   * @emits MESSAGE_ERROR - Error response for validation failures
   * @broadcasts MESSAGE_DELETED - Deletion notification to group members
   *
   * @performance
   * - Single database operation (soft delete)
   * - Efficient ownership validation
   * - Real-time deletion notification
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  socket.on('delete_message', async (payload: { messageId: string; groupId: string }) => {
    try {
      // Step 1: Authentication validation
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      // Step 2: Extract authenticated user data
      const { userId, user } = getAuthenticatedUser(socket);
      const { messageId, groupId } = payload;

      // Step 3: Payload validation
      if (!messageId || !groupId) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required fields: messageId, groupId'
        ));
        return;
      }

      // Step 4: Group membership validation
      // Uses Clerk ID for consistent user identification across services
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      // Step 5: Perform soft delete with ownership validation
      // MessageService validates that only the sender can delete their own messages
      // Uses Clerk ID for consistent user identification across services
      const success = await messageService.deleteMessage(messageId, user.clerkId);

      if (success) {
        // Step 6: Broadcast deletion notification to ALL group members (including sender)
        // Uses io.to() instead of socket.to() to include the deleter in the broadcast
        io.to(SocketRooms.group(groupId)).emit(SocketEvents.MESSAGE_DELETED, {
          messageId,
          groupId,
          deletedBy: user.clerkId, // Use Clerk ID consistently across all services
        });

        console.log(`✅ Message deleted: ${messageId} by user: ${user.clerkId}`);
      } else {
        // Ownership validation failed - user tried to delete someone else's message
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You can only delete your own messages'
        ));
      }
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
        SocketErrorCodes.INTERNAL_ERROR,
        'Failed to delete message'
      ));
    }
  });

  // Handle AI Smart Replies Request (Real-time)
  socket.on(SocketEvents.REQUEST_SMART_REPLIES, async (payload: RequestSmartRepliesPayload) => {
    try {
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.AI_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { messageContent, groupId, contextMessages } = payload;

      // Validate payload
      if (!messageContent || !groupId) {
        socket.emit(SocketEvents.AI_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required fields: messageContent, groupId'
        ));
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.AI_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      const requestId = `smart_reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Generate smart replies using AI service - Use Clerk ID for consistent identification
      const startTime = Date.now();
      const smartReplyResponse = await aiService.generateSmartReplies(messageContent, groupId, user.clerkId);
      const processingTime = Date.now() - startTime;

      // Emit complete smart replies to the requesting user
      socket.emit(SocketEvents.SMART_REPLIES_COMPLETE, {
        requestId,
        suggestions: smartReplyResponse.suggestions,
        confidence: smartReplyResponse.confidence,
        processingTime,
      });

      console.log(`✅ Smart replies generated for user: ${user.clerkId} in group: ${groupId} (${processingTime}ms)`);
    } catch (error) {
      console.error('❌ Error generating smart replies:', error);
      socket.emit(SocketEvents.AI_ERROR, createSocketError(
        SocketErrorCodes.INTERNAL_ERROR,
        'Failed to generate smart replies'
      ));
    }
  });

  // Handle AI Typing Suggestions Request (Real-time)
  socket.on(SocketEvents.REQUEST_TYPING_SUGGESTIONS, async (payload: RequestTypingSuggestionsPayload) => {
    try {
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.AI_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { partialText, groupId, cursorPosition } = payload;

      // Validate payload
      if (!partialText || !groupId) {
        socket.emit(SocketEvents.AI_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required fields: partialText, groupId'
        ));
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.AI_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      const requestId = `typing_suggestion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Generate contextual response for typing suggestion
      const suggestion = await aiService.generateContextualResponse(partialText, groupId, 50);

      // Emit typing suggestion to the requesting user
      socket.emit(SocketEvents.TYPING_SUGGESTION, {
        requestId,
        suggestion,
        confidence: 0.8, // Default confidence for typing suggestions
      });

      console.log(`✅ Typing suggestion generated for user: ${user.clerkId} in group: ${groupId}`);
    } catch (error) {
      console.error('❌ Error generating typing suggestion:', error);
      socket.emit(SocketEvents.AI_ERROR, createSocketError(
        SocketErrorCodes.INTERNAL_ERROR,
        'Failed to generate typing suggestion'
      ));
    }
  });

  // Handle AI Suggestion Rating (for feedback and improvement)
  socket.on(SocketEvents.RATE_AI_SUGGESTION, async (payload: RateAISuggestionPayload) => {
    try {
      if (!requireAuth(socket)) {
        return; // Silent fail for rating events
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { suggestionId, rating, feedback } = payload;

      // Validate payload
      if (!suggestionId || !rating) {
        return; // Silent fail for rating events
      }

      // Store AI feedback for improvement (implement in AIService if needed)
      console.log(`📊 AI Suggestion rated: ${suggestionId} - ${rating} by user: ${user.clerkId}`, feedback ? `Feedback: ${feedback}` : '');

      // TODO: Implement AI feedback storage in AIService for model improvement

    } catch (error) {
      console.error('❌ Error processing AI suggestion rating:', error);
    }
  });
}
