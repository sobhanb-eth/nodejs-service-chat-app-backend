import { Socket, Server as SocketIOServer } from 'socket.io';
import { SocketData, TypingStartPayload, TypingStopPayload, GetOnlineUsersPayload } from '../types/socket';
import { SocketEvents, SocketRooms, createSocketError, SocketErrorCodes } from '../config/socket';
import { AuthService } from '../services/AuthService';
import { PresenceService } from '../services/PresenceService';
import { getAuthenticatedUser, requireAuth } from '../middleware/auth';

/**
 * Typing indicator state management
 */
interface TypingState {
  userId: string;
  groupId: string;
  timeout: NodeJS.Timeout;
}

const typingStates = new Map<string, TypingState>();

/**
 * Handle presence-related socket events (typing indicators, online status)
 */
export function handlePresenceEvents(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  authService: AuthService,
  presenceService: PresenceService
) {
  // Handle typing start
  socket.on(SocketEvents.TYPING_START, async (payload: TypingStartPayload) => {
    console.log(`🔥 TYPING_START event received! Payload:`, payload);
    try {
      if (!requireAuth(socket)) {
        console.log(`❌ TYPING_START blocked - not authenticated`);
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;
      console.log(`🔥 TYPING_START processing - User: ${userId}, Group: ${groupId}`);

      // Validate payload
      if (!groupId) {
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      console.log(`🔍 Typing start - User ${user.clerkId} is member of group ${groupId}:`, isMember);
      if (!isMember) {
        console.log(`❌ Typing start blocked - User ${user.clerkId} not member of group ${groupId}`);
        return;
      }

      // Check if user has joined this group room
      const hasJoinedRoom = socket.data.joinedGroups.has(groupId);
      console.log(`🔍 Typing start - User ${userId} has joined room ${groupId}:`, hasJoinedRoom);
      console.log(`🔍 Typing start - User's joined groups:`, Array.from(socket.data.joinedGroups));
      if (!hasJoinedRoom) {
        console.log(`❌ Typing start blocked - User ${userId} has not joined room ${groupId}`);
        return;
      }

      const typingKey = `${userId}:${groupId}`;

      // Clear existing typing timeout
      const existingState = typingStates.get(typingKey);
      if (existingState) {
        clearTimeout(existingState.timeout);
      }

      // Broadcast typing indicator to group members (excluding sender)
      const typingPayload = {
        groupId,
        userId: user.clerkId, // Use Clerk ID consistently
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

      // Set auto-stop timeout (5 seconds)
      const timeout = setTimeout(() => {
        // Auto-stop typing if no activity
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.USER_STOPPED_TYPING, {
          groupId,
          userId: user.clerkId, // Use Clerk ID consistently
        });
        typingStates.delete(typingKey);
      }, 5000);

      // Store typing state
      typingStates.set(typingKey, {
        userId,
        groupId,
        timeout,
      });

      console.log(`⌨️ User started typing: ${userId} in group: ${groupId}`);
    } catch (error) {
      console.error('❌ Error handling typing start:', error);
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
 * Clean up expired typing states periodically
 */
export function startTypingCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    try {
      // Clean up expired typing states
      // Note: We rely on the individual timeouts to clean up states
      // This is just a backup cleanup for any missed states
      console.log(`🧹 Typing cleanup check: ${typingStates.size} active typing states`);
    } catch (error) {
      console.error('❌ Error during typing cleanup:', error);
    }
  }, 30000); // Clean up every 30 seconds
}

/**
 * Stop typing cleanup interval
 */
export function stopTypingCleanup(interval: NodeJS.Timeout): void {
  clearInterval(interval);

  // Clear all remaining typing states
  for (const [key, state] of typingStates.entries()) {
    clearTimeout(state.timeout);
    typingStates.delete(key);
  }
}
