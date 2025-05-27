import { Socket, Server as SocketIOServer } from 'socket.io';
import { SocketData, SendMessagePayload, MarkMessageReadPayload, RequestSmartRepliesPayload, RequestTypingSuggestionsPayload, RateAISuggestionPayload } from '../types/socket';
import { SocketEvents, SocketRooms, createSocketError, SocketErrorCodes } from '../config/socket';
import { MessageService } from '../services/MessageService';
import { AuthService } from '../services/AuthService';
import { AIService } from '../services/AIService';
import { getAuthenticatedUser, requireAuth } from '../middleware/auth';

/**
 * Handle message-related socket events including AI features
 */
export function handleMessageEvents(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  messageService: MessageService,
  authService: AuthService,
  aiService: AIService
) {
  // Handle send message
  socket.on(SocketEvents.SEND_MESSAGE, async (payload: SendMessagePayload) => {
    try {
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId, content, type, tempId } = payload;

      // Validate payload
      if (!groupId || !content || !type) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required fields: groupId, content, type'
        ));
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      // Validate content length
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

  // Handle mark message as read
  socket.on(SocketEvents.MARK_MESSAGE_READ, async (payload: MarkMessageReadPayload) => {
    try {
      if (!requireAuth(socket)) {
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { messageId, groupId } = payload;

      // Validate payload
      if (!messageId || !groupId) {
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        return;
      }

      // Mark message as read - Use Clerk ID for consistent identification
      const success = await messageService.markMessageAsRead(messageId, user.clerkId);

      if (success) {
        const readAt = new Date();

        // Broadcast read receipt to group members
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.MESSAGE_READ, {
          messageId,
          groupId,
          readBy: user.clerkId, // Use Clerk ID consistently
          readAt,
        });

        console.log(`✅ Message marked as read: ${messageId} by user: ${user.clerkId}`);
      }
    } catch (error) {
      console.error('❌ Error marking message as read:', error);
    }
  });

  // Handle bulk mark messages as read (for when user opens a group)
  socket.on('mark_messages_read', async (payload: { groupId: string; messageIds: string[] }) => {
    try {
      if (!requireAuth(socket)) {
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId, messageIds } = payload;

      // Validate payload
      if (!groupId || !Array.isArray(messageIds) || messageIds.length === 0) {
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        return;
      }

      // Mark messages as read - Use Clerk ID for consistent identification
      const markedAsRead = await messageService.markMessagesAsRead(messageIds, user.clerkId);

      if (markedAsRead.length > 0) {
        const readAt = new Date();

        // Broadcast bulk read receipt to group members
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.MESSAGES_READ, {
          groupId,
          messageIds: markedAsRead,
          readBy: user.clerkId, // Use Clerk ID consistently
          readAt,
        });

        console.log(`✅ ${markedAsRead.length} messages marked as read in group: ${groupId} by user: ${user.clerkId}`);
      }
    } catch (error) {
      console.error('❌ Error marking messages as read:', error);
    }
  });

  // Handle delete message
  socket.on('delete_message', async (payload: { messageId: string; groupId: string }) => {
    try {
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { messageId, groupId } = payload;

      // Validate payload
      if (!messageId || !groupId) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required fields: messageId, groupId'
        ));
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.MESSAGE_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      // Delete message (only sender can delete their own messages) - Use Clerk ID for consistent identification
      const success = await messageService.deleteMessage(messageId, user.clerkId);

      if (success) {
        // Broadcast message deletion to group members
        io.to(SocketRooms.group(groupId)).emit(SocketEvents.MESSAGE_DELETED, {
          messageId,
          groupId,
          deletedBy: user.clerkId, // Use Clerk ID consistently
        });

        console.log(`✅ Message deleted: ${messageId} by user: ${user.clerkId}`);
      } else {
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
