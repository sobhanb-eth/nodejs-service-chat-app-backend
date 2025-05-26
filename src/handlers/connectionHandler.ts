import { Socket, Server as SocketIOServer } from 'socket.io';
import { SocketData, AuthenticationSuccessPayload } from '../types/socket';
import { SocketEvents, SocketRooms } from '../config/socket';
import { PresenceService } from '../services/PresenceService';
import { AuthService } from '../services/AuthService';
import { getAuthenticatedUser, updateSocketActivity } from '../middleware/auth';
import { database } from '../config/database';
import { ObjectId } from 'mongodb';

/**
 * Create test groups for development
 */
async function createTestGroupsForUser(userId: string): Promise<string[]> {
  try {
    // Check if user already has groups (userId is already a string - Clerk user ID)
    const existingGroups = await database.groups.find({
      'members.userId': userId,
      isActive: true
    }).toArray();

    if (existingGroups.length > 0) {
      console.log(`📋 User already has ${existingGroups.length} groups`);
      return existingGroups.map(g => g._id!.toString());
    }

    // Create test groups
    const testGroups = [
      { name: 'Team Alpha', description: 'Development team chat' },
      { name: 'Project Beta', description: 'Project discussion' },
      { name: 'Design Team', description: 'Design collaboration' }
    ];

    const groupIds: string[] = [];

    for (const groupData of testGroups) {
      const group = {
        _id: new ObjectId(),
        name: groupData.name,
        description: groupData.description,
        ownerId: userId, // Use string userId directly
        members: [{
          userId: userId, // Use string userId directly
          role: 'owner' as const,
          joinedAt: new Date()
        }],
        isPrivate: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await database.groups.insertOne(group);
      groupIds.push(group._id.toString());
      console.log(`✅ Created test group: ${group.name} (${group._id})`);
    }

    return groupIds;
  } catch (error) {
    console.error('❌ Error creating test groups:', error);
    return [];
  }
}

/**
 * Handle socket connection events
 */
export function handleConnection(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  presenceService: PresenceService,
  authService: AuthService
) {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Handle authentication
  socket.on(SocketEvents.AUTHENTICATE, async (payload) => {
    try {
      if (!socket.data.isAuthenticated) {
        socket.emit(SocketEvents.AUTHENTICATION_ERROR, {
          error: 'Socket not authenticated',
          code: 'AUTHENTICATION_FAILED',
        });
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);

      // Create session for presence tracking
      const session = await presenceService.createSession(
        userId,
        socket.id,
        socket.data.deviceType
      );

      socket.data.sessionId = session._id?.toString();

      // Join user's personal room for private notifications
      await socket.join(SocketRooms.user(userId));

      // Join presence room for online status updates
      await socket.join(SocketRooms.presence());

      // Get user's groups and join their rooms
      let userGroups = await authService.getUserGroups(userId);

      // Create test groups if user has none (development only)
      if (userGroups.length === 0) {
        console.log('🧪 Creating test groups for new user...');
        const testGroupIds = await createTestGroupsForUser(userId);
        userGroups = testGroupIds;
      }

      for (const groupId of userGroups) {
        await socket.join(SocketRooms.group(groupId));
        socket.data.joinedGroups.add(groupId);
      }

      // Notify successful authentication
      const authSuccessPayload: AuthenticationSuccessPayload = {
        user,
        sessionId: session._id?.toString() || '',
      };

      socket.emit(SocketEvents.AUTHENTICATION_SUCCESS, authSuccessPayload);

      // Send user's groups to client
      const groupsData = await Promise.all(userGroups.map(async (groupId) => {
        const group = await database.groups.findOne({ _id: new ObjectId(groupId) });
        return group ? {
          id: group._id!.toString(),
          name: group.name,
          description: group.description,
          memberCount: group.members.length,
          lastMessage: null, // TODO: Get last message
          type: 'group'
        } : null;
      }));

      const validGroups = groupsData.filter(g => g !== null);
      socket.emit('user_groups', validGroups);
      console.log(`📋 Sent ${validGroups.length} groups to client`);

      // Broadcast user online status to presence room
      socket.to(SocketRooms.presence()).emit(SocketEvents.USER_ONLINE, {
        userId,
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

  // Handle disconnection
  socket.on(SocketEvents.DISCONNECT, async (reason) => {
    try {
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);

      if (socket.data.isAuthenticated && socket.data.userId) {
        const { userId, user } = getAuthenticatedUser(socket);

        // Remove session
        await presenceService.removeSessionBySocketId(socket.id);

        // Check if user has other active sessions
        const isStillOnline = await presenceService.isUserOnline(userId);

        if (!isStillOnline) {
          // Broadcast user offline status
          socket.to(SocketRooms.presence()).emit(SocketEvents.USER_OFFLINE, {
            userId,
          });

          // Update user's last seen
          await authService.updateLastSeen(userId);
        }

        console.log(`✅ Cleaned up session for user: ${user.email} (${socket.id})`);
      }
    } catch (error) {
      console.error('❌ Disconnect cleanup error:', error);
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
    if (socket.data.isAuthenticated) {
      try {
        await presenceService.updateSessionActivity(socket.id);
      } catch (error) {
        console.error('❌ Error updating session activity:', error);
      }
    }
  }, 30000); // Update every 30 seconds

  // Clean up interval on disconnect
  socket.on(SocketEvents.DISCONNECT, () => {
    clearInterval(activityInterval);
  });
}

/**
 * Handle socket errors globally
 */
export function handleSocketError(
  socket: Socket<any, any, any, SocketData>,
  error: Error
) {
  console.error(`❌ Socket error: ${socket.id}`, error);

  try {
    const errorPayload = JSON.parse(error.message);
    socket.emit(SocketEvents.ERROR, errorPayload);
  } catch {
    socket.emit(SocketEvents.ERROR, {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      timestamp: new Date(),
    });
  }

  // Disconnect socket on authentication errors
  if (error.message.includes('AUTHENTICATION_FAILED') ||
      error.message.includes('INVALID_TOKEN') ||
      error.message.includes('TOKEN_EXPIRED')) {
    socket.disconnect(true);
  }
}
