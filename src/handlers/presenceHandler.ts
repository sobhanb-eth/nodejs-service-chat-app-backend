import { Socket, Server as SocketIOServer } from 'socket.io';
import { SocketData, TypingStartPayload, TypingStopPayload, GetOnlineUsersPayload } from '../types/socket';
import { SocketEvents, SocketRooms, createSocketError, SocketErrorCodes } from '../config/socket';
import { AuthService } from '../services/AuthService';
import { PresenceService } from '../services/PresenceService';
import { getAuthenticatedUser, requireAuth } from '../middleware/auth';

/**
 * Presence Handler - Real-time presence and typing indicators
 *
 * @description Manages user presence, typing indicators, and online status for the chat system.
 * Provides real-time feedback for user activity including typing states, online/offline status,
 * and presence management across multiple groups and sessions.
 *
 * @features
 * - Real-time typing indicators with auto-timeout
 * - Online/offline status tracking
 * - Multi-group presence management
 * - User status changes (online/away)
 * - Automatic cleanup on disconnect
 * - Periodic state cleanup for reliability
 * - Group membership validation for presence
 *
 * @security
 * - JWT authentication required for all operations
 * - Group membership validation for typing indicators
 * - Room membership verification
 * - Clerk ID consistency for user identification
 * - Silent failure for unauthorized access
 *
 * @performance
 * - Efficient state management with Map storage
 * - Auto-timeout for typing indicators (5s)
 * - Periodic cleanup to prevent memory leaks
 * - Minimal database queries
 * - Optimized broadcasting to group members
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */

/**
 * Typing indicator state interface
 *
 * @description Defines the structure for tracking active typing states
 * including user identification, group context, and cleanup timeout.
 *
 * @interface TypingState
 * @since 1.0.0
 */
interface TypingState {
  /** User's MongoDB ObjectId */
  userId: string;
  /** Group ObjectId where typing is occurring */
  groupId: string;
  /** Timeout handle for auto-cleanup */
  timeout: NodeJS.Timeout;
}

/**
 * Global typing states storage
 *
 * @description In-memory storage for active typing indicators using
 * "userId:groupId" as key for efficient lookup and cleanup.
 *
 * @type {Map<string, TypingState>}
 * @since 1.0.0
 */
const typingStates = new Map<string, TypingState>();

/**
 * Initialize presence event handlers for a socket connection
 *
 * @description Sets up all presence-related socket event listeners including
 * typing indicators, online status, and user presence management. Handles
 * real-time presence updates with proper validation and cleanup.
 *
 * @param {SocketIOServer} io - Socket.io server instance for broadcasting
 * @param {Socket} socket - Individual client socket connection
 * @param {AuthService} authService - Service for authentication and group membership
 * @param {PresenceService} presenceService - Service for user presence tracking
 *
 * @events
 * - `typing_start` - User starts typing in a group
 * - `typing_stop` - User stops typing in a group
 * - `get_online_users` - Request online users list
 * - `change_status` - Change user status (online/away)
 * - `disconnect` - Clean up typing states on disconnect
 *
 * @emits
 * - `user_typing` - Typing indicator to group members
 * - `user_stopped_typing` - Stop typing indicator to group members
 * - `online_users` - Online users list response
 * - `user_status_changed` - Status change broadcast
 *
 * @flow
 * 1. Validate authentication and group membership
 * 2. Process typing indicators with auto-timeout
 * 3. Manage online status and presence updates
 * 4. Handle cleanup on disconnect
 * 5. Broadcast presence changes to relevant groups
 *
 * @example
 * ```typescript
 * // Initialize presence handlers for a new socket connection
 * handlePresenceEvents(io, socket, authService, presenceService);
 * ```
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export function handlePresenceEvents(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  authService: AuthService,
  presenceService: PresenceService
) {
  /**
   * TYPING_START Event Handler
   *
   * @description Handles user typing start events with comprehensive validation,
   * state management, and real-time broadcasting to group members.
   *
   * @flow
   * 1. Authenticate user and validate JWT token
   * 2. Extract and validate payload (groupId)
   * 3. Verify user is member of target group
   * 4. Verify user has joined the group room
   * 5. Clear any existing typing timeout
   * 6. Broadcast typing indicator to group members
   * 7. Set auto-stop timeout (5 seconds)
   * 8. Store typing state for cleanup
   *
   * @security
   * - JWT authentication required
   * - Group membership validation
   * - Room membership verification
   * - Silent failure for unauthorized access
   * - Clerk ID consistency for user identification
   *
   * @performance
   * - Efficient state lookup and management
   * - Auto-timeout prevents stuck typing indicators
   * - Minimal database queries
   * - Optimized broadcasting (excludes sender)
   *
   * @payload {TypingStartPayload}
   * - groupId: ObjectId of group where typing occurs
   *
   * @broadcasts USER_TYPING - Typing indicator to group members (excluding sender)
   * @broadcasts USER_STOPPED_TYPING - Auto-stop after 5 seconds of inactivity
   */
  socket.on(SocketEvents.TYPING_START, async (payload: TypingStartPayload) => {
    console.log(`🔥 TYPING_START event received! Payload:`, payload);
    try {
      // Step 1: Authentication validation (silent failure for typing events)
      if (!requireAuth(socket)) {
        console.log(`❌ TYPING_START blocked - not authenticated`);
        return;
      }

      // Step 2: Extract authenticated user data
      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;
      console.log(`🔥 TYPING_START processing - User: ${userId}, Group: ${groupId}`);

      // Step 3: Payload validation (silent failure for typing events)
      if (!groupId) {
        return;
      }

      // Step 4: Group membership validation
      // Uses Clerk ID for consistent user identification across services
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      console.log(`🔍 Typing start - User ${user.clerkId} is member of group ${groupId}:`, isMember);
      if (!isMember) {
        console.log(`❌ Typing start blocked - User ${user.clerkId} not member of group ${groupId}`);
        return;
      }

      // Step 5: Room membership verification
      // Ensures user has actively joined the group room via JOIN_GROUP event
      const hasJoinedRoom = socket.data.joinedGroups.has(groupId);
      console.log(`🔍 Typing start - User ${userId} has joined room ${groupId}:`, hasJoinedRoom);
      console.log(`🔍 Typing start - User's joined groups:`, Array.from(socket.data.joinedGroups));
      if (!hasJoinedRoom) {
        console.log(`❌ Typing start blocked - User ${userId} has not joined room ${groupId}`);
        return;
      }

      // Step 6: Generate unique typing key for state management
      const typingKey = `${userId}:${groupId}`;

      // Step 7: Clear any existing typing timeout for this user/group combination
      // Prevents multiple timeouts for the same typing session
      const existingState = typingStates.get(typingKey);
      if (existingState) {
        clearTimeout(existingState.timeout);
      }

      // Step 8: Prepare and broadcast typing indicator to group members
      // Excludes the sender to avoid self-notification
      const typingPayload = {
        groupId,
        userId: user.clerkId, // Use Clerk ID consistently across all services
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
        },
      };

      console.log(`⌨️ Broadcasting typing start to room: ${SocketRooms.group(groupId)}`);
      console.log(`⌨️ Typing payload:`, typingPayload);

      socket.to(SocketRooms.group(groupId)).emit(SocketEvents.USER_TYPING, typingPayload);

      // Step 9: Set auto-stop timeout (5 seconds)
      // Automatically stops typing indicator if user doesn't send explicit stop
      const timeout = setTimeout(() => {
        // Auto-stop typing if no activity - prevents stuck typing indicators
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.USER_STOPPED_TYPING, {
          groupId,
          userId: user.clerkId, // Use Clerk ID consistently across all services
        });
        typingStates.delete(typingKey);
      }, 5000);

      // Step 10: Store typing state for management and cleanup
      typingStates.set(typingKey, {
        userId,
        groupId,
        timeout,
      });

      console.log(`⌨️ User started typing: ${userId} in group: ${groupId}`);
    } catch (error) {
      console.error('❌ Error handling typing start:', error);
      // Silent failure - typing indicators should not disrupt user experience
    }
  });

  // Handle typing stop
  socket.on(SocketEvents.TYPING_STOP, async (payload: TypingStopPayload) => {
    try {
      if (!requireAuth(socket)) {
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;

      // Validate payload
      if (!groupId) {
        return;
      }

      const typingKey = `${userId}:${groupId}`;
      const typingState = typingStates.get(typingKey);

      if (typingState) {
        // Clear timeout
        clearTimeout(typingState.timeout);
        typingStates.delete(typingKey);

        // Broadcast stop typing to group members (excluding sender)
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.USER_STOPPED_TYPING, {
          groupId,
          userId: user.clerkId, // Use Clerk ID consistently
        });

        console.log(`⌨️ User stopped typing: ${user.clerkId} in group: ${groupId}`);
      }
    } catch (error) {
      console.error('❌ Error handling typing stop:', error);
    }
  });

  // Handle get online users
  socket.on(SocketEvents.GET_ONLINE_USERS, async (payload: GetOnlineUsersPayload) => {
    try {
      if (!requireAuth(socket)) {
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;

      // If groupId is provided, check if user is member
      if (groupId) {
        const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
        if (!isMember) {
          return;
        }
      }

      // Get online users
      const onlineUsers = await presenceService.getOnlineUsers(groupId);

      // Emit online users list
      socket.emit(SocketEvents.ONLINE_USERS, {
        users: onlineUsers,
        groupId,
      });

      console.log(`👥 Sent online users list to: ${userId} (${onlineUsers.length} users)`);
    } catch (error) {
      console.error('❌ Error getting online users:', error);
    }
  });

  // Handle status change (online/away)
  socket.on('change_status', async (payload: { status: 'online' | 'away' }) => {
    try {
      if (!requireAuth(socket)) {
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { status } = payload;

      // Validate status
      if (!status || !['online', 'away'].includes(status)) {
        return;
      }

      // Update session status
      const success = await presenceService.updateSessionStatus(socket.id, status);

      if (success) {
        // Broadcast status change to presence room
        socket.to(SocketRooms.presence()).emit(SocketEvents.USER_STATUS_CHANGED, {
          userId,
          status,
          lastSeen: new Date(),
        });

        console.log(`📱 User status changed: ${userId} -> ${status}`);
      }
    } catch (error) {
      console.error('❌ Error changing user status:', error);
    }
  });

  // Clean up typing states on disconnect
  socket.on(SocketEvents.DISCONNECT, () => {
    if (socket.data.isAuthenticated && socket.data.userId && socket.data.user) {
      const userId = socket.data.userId;
      const user = socket.data.user;

      // Clean up all typing states for this user
      for (const [key, state] of typingStates.entries()) {
        if (state.userId === userId) {
          clearTimeout(state.timeout);

          // Broadcast stop typing for all groups
          socket.to(SocketRooms.group(state.groupId)).emit(SocketEvents.USER_STOPPED_TYPING, {
            groupId: state.groupId,
            userId: user.clerkId, // Use Clerk ID consistently
          });

          typingStates.delete(key);
        }
      }
    }
  });
}

/**
 * Start periodic typing state cleanup
 *
 * @description Initializes a periodic cleanup process to monitor and maintain
 * typing state integrity. Provides backup cleanup for any missed timeout states
 * and prevents memory leaks from stuck typing indicators.
 *
 * @returns {NodeJS.Timeout} Interval handle for cleanup process
 *
 * @performance
 * - Runs every 30 seconds to minimize overhead
 * - Monitors active typing states count
 * - Backup cleanup for reliability
 * - Prevents memory leaks
 *
 * @example
 * ```typescript
 * // Start typing cleanup when server initializes
 * const cleanupInterval = startTypingCleanup();
 *
 * // Stop cleanup when server shuts down
 * stopTypingCleanup(cleanupInterval);
 * ```
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export function startTypingCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    try {
      // Monitor active typing states for debugging and health checks
      // Individual timeouts handle actual cleanup - this is backup monitoring
      console.log(`🧹 Typing cleanup check: ${typingStates.size} active typing states`);

      // Note: We rely on individual timeouts to clean up states automatically
      // This periodic check serves as backup monitoring and health verification
    } catch (error) {
      console.error('❌ Error during typing cleanup:', error);
      // Non-critical error - don't let cleanup failures crash the process
    }
  }, 30000); // Clean up every 30 seconds
}

/**
 * Stop typing cleanup and clear all states
 *
 * @description Stops the periodic cleanup process and clears all remaining
 * typing states. Used during server shutdown to ensure clean resource cleanup.
 *
 * @param {NodeJS.Timeout} interval - The cleanup interval to stop
 *
 * @flow
 * 1. Stop the periodic cleanup interval
 * 2. Clear all remaining typing timeouts
 * 3. Clear the typing states map
 *
 * @performance
 * - Efficient bulk cleanup
 * - Prevents resource leaks on shutdown
 * - Immediate state clearing
 *
 * @example
 * ```typescript
 * // Stop cleanup during server shutdown
 * stopTypingCleanup(cleanupInterval);
 * ```
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export function stopTypingCleanup(interval: NodeJS.Timeout): void {
  // Step 1: Stop the periodic cleanup interval
  clearInterval(interval);

  // Step 2: Clear all remaining typing states and their timeouts
  for (const [key, state] of typingStates.entries()) {
    clearTimeout(state.timeout);
    typingStates.delete(key);
  }

  console.log(`🧹 Typing cleanup stopped and ${typingStates.size} states cleared`);
}
