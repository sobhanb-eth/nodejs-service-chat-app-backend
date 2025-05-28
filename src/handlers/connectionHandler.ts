import { Socket, Server as SocketIOServer } from 'socket.io';
import { SocketData, AuthenticationSuccessPayload } from '../types/socket';
import { SocketEvents, SocketRooms } from '../config/socket';
import { PresenceService } from '../services/PresenceService';
import { AuthService } from '../services/AuthService';
import { getAuthenticatedUser, updateSocketActivity } from '../middleware/auth';
import { database } from '../config/database';
import { ObjectId } from 'mongodb';

/**
 * Connection Handler - Socket lifecycle and authentication management
 *
 * @description Manages the complete socket connection lifecycle including authentication,
 * room management, presence tracking, and graceful disconnection. Handles user sessions,
 * group memberships, and real-time presence updates for the chat system.
 *
 * @features
 * - Socket authentication with JWT validation
 * - Automatic room joining for user groups
 * - Real-time presence tracking and updates
 * - Session management with activity monitoring
 * - Graceful disconnection and cleanup
 * - Error handling and recovery
 * - Activity-based session updates
 * - Multi-device session support
 *
 * @security
 * - JWT token validation for authentication
 * - Clerk ID consistency for user identification
 * - Secure room access based on group membership
 * - Session isolation and cleanup
 * - Error message sanitization
 *
 * @performance
 * - Efficient room management
 * - Periodic activity updates (30s intervals)
 * - Optimized presence broadcasting
 * - Minimal database queries
 * - Connection pooling support
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */

/**
 * Initialize connection event handlers for a socket
 *
 * @description Sets up all connection-related event listeners including authentication,
 * disconnection, and error handling. Manages the complete socket lifecycle from
 * connection to cleanup with proper session and presence management.
 *
 * @param {SocketIOServer} io - Socket.io server instance for broadcasting
 * @param {Socket} socket - Individual client socket connection
 * @param {PresenceService} presenceService - Service for user presence and session tracking
 * @param {AuthService} authService - Service for authentication and group membership
 *
 * @events
 * - `authenticate` - Handle user authentication and room joining
 * - `disconnect` - Handle disconnection and cleanup
 * - `connect_error` - Handle connection errors
 *
 * @broadcasts
 * - `authentication_success` - Successful authentication response
 * - `authentication_error` - Authentication failure response
 * - `user_groups` - User's group memberships
 * - `user_online` - User online status to presence room
 * - `user_offline` - User offline status to presence room
 * - `error` - General error responses
 *
 * @flow
 * 1. Socket connects and receives connection event
 * 2. Client sends authentication payload with JWT
 * 3. Validate authentication and create session
 * 4. Join user's personal room and group rooms
 * 5. Broadcast online status and send group data
 * 6. Monitor activity and update session periodically
 * 7. Handle disconnection with proper cleanup
 *
 * @example
 * ```typescript
 * // Initialize connection handlers for a new socket
 * handleConnection(io, socket, presenceService, authService);
 * ```
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export function handleConnection(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  presenceService: PresenceService,
  authService: AuthService
) {
  console.log(`🔌 Socket connected: ${socket.id}`);

  /**
   * AUTHENTICATE Event Handler
   *
   * @description Handles user authentication and complete session setup including
   * room joining, presence tracking, and group membership synchronization.
   *
   * @flow
   * 1. Validate socket authentication status
   * 2. Extract authenticated user data
   * 3. Create presence session for activity tracking
   * 4. Join user's personal and presence rooms
   * 5. Join all user's group rooms
   * 6. Send authentication success and group data
   * 7. Broadcast online status to other users
   *
   * @security
   * - Pre-authenticated socket required (JWT validated in middleware)
   * - Clerk ID consistency for all operations
   * - Secure room access based on group membership
   *
   * @performance
   * - Batch room joining operations
   * - Efficient group data retrieval
   * - Minimal database queries
   */
  socket.on(SocketEvents.AUTHENTICATE, async (payload) => {
    try {
      // Step 1: Validate socket authentication status
      // Authentication must be completed in middleware before this event
      if (!socket.data.isAuthenticated) {
        socket.emit(SocketEvents.AUTHENTICATION_ERROR, {
          error: 'Socket not authenticated',
          code: 'AUTHENTICATION_FAILED',
        });
        return;
      }

      // Step 2: Extract authenticated user data from socket
      const { userId, user } = getAuthenticatedUser(socket);

      // Step 3: Create presence session for activity tracking
      // Uses Clerk ID for consistent user identification across services
      const session = await presenceService.createSession(
        user.clerkId,
        socket.id,
        socket.data.deviceType
      );

      socket.data.sessionId = session._id?.toString();

      // Step 4a: Join user's personal room for private notifications
      // Uses Clerk ID for consistent room naming across services
      await socket.join(SocketRooms.user(user.clerkId));

      // Step 4b: Join global presence room for online status updates
      await socket.join(SocketRooms.presence());

      // Step 5: Get user's groups and join their rooms
      // Uses Clerk ID since groups store Clerk user IDs for membership
      const userGroups = await authService.getUserGroups(user.clerkId);

      for (const groupId of userGroups) {
        await socket.join(SocketRooms.group(groupId));
        socket.data.joinedGroups.add(groupId);
      }

      // Step 6a: Send authentication success response to client
      const authSuccessPayload: AuthenticationSuccessPayload = {
        user,
        sessionId: session._id?.toString() || '',
      };

      socket.emit(SocketEvents.AUTHENTICATION_SUCCESS, authSuccessPayload);

      // Step 6b: Prepare and send user's group data to client
      // Retrieves group information for all groups the user is a member of
      const groupsData = await Promise.all(userGroups.map(async (groupId) => {
        const group = await database.groups.findOne({ _id: new ObjectId(groupId) });
        return group ? {
          id: group._id!.toString(),
          name: group.name,
          description: group.description,
          memberCount: group.members.length,
          lastMessage: null, // TODO: Get last message for better UX
          type: 'group'
        } : null;
      }));

      const validGroups = groupsData.filter(g => g !== null);
      socket.emit('user_groups', validGroups);
      console.log(`📋 Sent ${validGroups.length} groups to client`);

      // Step 7: Broadcast user online status to other users in presence room
      // Excludes the current socket to avoid self-notification
      // Uses Clerk ID for consistent user identification
      socket.to(SocketRooms.presence()).emit(SocketEvents.USER_ONLINE, {
        userId: user.clerkId,
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        },
        status: 'online',
      });

      console.log(`✅ Socket authenticated and joined rooms: ${socket.id} (${user.email})`);
    } catch (error) {
      console.error('❌ Authentication error:', error);
      socket.emit(SocketEvents.AUTHENTICATION_ERROR, {
        error: 'Authentication failed',
        code: 'AUTHENTICATION_FAILED',
      });
    }
  });

  /**
   * DISCONNECT Event Handler
   *
   * @description Handles socket disconnection with comprehensive cleanup including
   * session removal, presence updates, and offline status broadcasting.
   *
   * @flow
   * 1. Log disconnection with reason
   * 2. Validate authenticated session exists
   * 3. Remove session from presence service
   * 4. Check if user has other active sessions
   * 5. Broadcast offline status if no other sessions
   * 6. Update user's last seen timestamp
   * 7. Clean up resources and intervals
   *
   * @security
   * - Only processes authenticated sessions
   * - Secure session cleanup
   * - Proper resource deallocation
   *
   * @performance
   * - Efficient session lookup and removal
   * - Minimal database operations
   * - Graceful error handling
   */
  socket.on(SocketEvents.DISCONNECT, async (reason) => {
    try {
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);

      // Step 1: Validate authenticated session exists before cleanup
      if (socket.data.isAuthenticated && socket.data.userId) {
        const { userId, user } = getAuthenticatedUser(socket);

        // Step 2: Remove session from presence tracking
        await presenceService.removeSessionBySocketId(socket.id);

        // Step 3: Check if user has other active sessions (multi-device support)
        // Uses Clerk ID for consistent user identification across services
        const isStillOnline = await presenceService.isUserOnline(user.clerkId);

        if (!isStillOnline) {
          // Step 4: Broadcast user offline status to other users
          // Only broadcasts if user has no other active sessions
          // Uses Clerk ID for consistent user identification
          socket.to(SocketRooms.presence()).emit(SocketEvents.USER_OFFLINE, {
            userId: user.clerkId,
          });

          // Step 5: Update user's last seen timestamp in database
          // Uses MongoDB ObjectId for database operations
          await authService.updateLastSeen(userId);
        }

        console.log(`✅ Cleaned up session for user: ${user.email} (${socket.id})`);
      }
    } catch (error) {
      console.error('❌ Disconnect cleanup error:', error);
      // Non-critical error - don't let cleanup failures crash the process
    }
  });

  // Handle connection errors
  socket.on(SocketEvents.CONNECT_ERROR, (error) => {
    console.error(`❌ Socket connection error: ${socket.id}`, error);
  });

  // Activity tracking middleware for all events
  const originalEmit = socket.emit;
  socket.emit = function (...args) {
    updateSocketActivity(socket);
    return originalEmit.apply(this, args);
  };

  const originalOn = socket.on;
  socket.on = function (event, listener) {
    const wrappedListener = (...args: any[]) => {
      updateSocketActivity(socket);

      // Update session activity in database periodically
      if (socket.data.isAuthenticated) {
        presenceService.updateSessionActivity(socket.id).catch(console.error);
      }

      return listener.apply(this, args);
    };

    return originalOn.call(this, event, wrappedListener);
  };

  // Periodic activity update
  const activityInterval = setInterval(async () => {
    try {
      if (socket.data.isAuthenticated && socket.connected) {
        await presenceService.updateSessionActivity(socket.id);
      }
    } catch (error) {
      console.error('❌ Error updating session activity:', error);
      // Don't let this error crash the process
    }
  }, 30000); // Update every 30 seconds

  // Clean up interval on disconnect
  socket.on(SocketEvents.DISCONNECT, () => {
    clearInterval(activityInterval);
  });
}

/**
 * Global socket error handler
 *
 * @description Handles socket errors globally with proper error formatting,
 * client notification, and automatic disconnection for critical errors.
 * Provides centralized error handling for all socket operations.
 *
 * @param {Socket} socket - The socket that encountered the error
 * @param {Error} error - The error that occurred
 *
 * @flow
 * 1. Log error details for debugging
 * 2. Parse error message if JSON formatted
 * 3. Send formatted error to client
 * 4. Disconnect socket for authentication errors
 *
 * @security
 * - Sanitizes error messages before sending to client
 * - Automatic disconnection for authentication failures
 * - Prevents sensitive error details from leaking
 *
 * @performance
 * - Minimal error processing overhead
 * - Efficient error categorization
 * - Graceful error recovery
 *
 * @example
 * ```typescript
 * // Handle socket error globally
 * handleSocketError(socket, new Error('AUTHENTICATION_FAILED'));
 * ```
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export function handleSocketError(
  socket: Socket<any, any, any, SocketData>,
  error: Error
) {
  console.error(`❌ Socket error: ${socket.id}`, error);

  try {
    // Step 1: Attempt to parse structured error message
    const errorPayload = JSON.parse(error.message);
    socket.emit(SocketEvents.ERROR, errorPayload);
  } catch {
    // Step 2: Fallback to generic error format for unstructured errors
    socket.emit(SocketEvents.ERROR, {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      timestamp: new Date(),
    });
  }

  // Step 3: Disconnect socket for critical authentication errors
  // Prevents unauthorized access and forces re-authentication
  if (error.message.includes('AUTHENTICATION_FAILED') ||
      error.message.includes('INVALID_TOKEN') ||
      error.message.includes('TOKEN_EXPIRED')) {
    socket.disconnect(true);
  }
}
