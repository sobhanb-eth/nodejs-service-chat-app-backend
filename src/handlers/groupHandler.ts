import { Socket, Server as SocketIOServer } from 'socket.io';
import { ObjectId } from 'mongodb';
import { SocketData, JoinGroupPayload, LeaveGroupPayload } from '../types/socket';
import { SocketEvents, SocketRooms, createSocketError, SocketErrorCodes } from '../config/socket';
import { AuthService } from '../services/AuthService';
import { PresenceService } from '../services/PresenceService';
import { database } from '../config/database';
import { getAuthenticatedUser, requireAuth } from '../middleware/auth';

/**
 * Group Handler - Group management and membership operations
 *
 * @description Manages group-related socket events including joining, leaving,
 * and member management. Handles real-time group presence, membership validation,
 * and group room management for the chat system.
 *
 * @features
 * - Group room joining and leaving
 * - Membership validation and access control
 * - Real-time presence tracking in groups
 * - Online member status updates
 * - Group member information retrieval
 * - Multi-session group presence support
 * - Secure group access validation
 *
 * @security
 * - JWT authentication required for all operations
 * - Group membership validation before access
 * - Clerk ID consistency for user identification
 * - ObjectId validation for group references
 * - Access control for group operations
 *
 * @performance
 * - Efficient room management
 * - Optimized member queries with aggregation
 * - Minimal database operations
 * - Real-time presence updates
 * - Batch online status retrieval
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */

/**
 * Initialize group event handlers for a socket connection
 *
 * @description Sets up all group-related socket event listeners including
 * join/leave operations and member management. Handles group room management
 * and real-time presence updates for group members.
 *
 * @param {SocketIOServer} io - Socket.io server instance for broadcasting
 * @param {Socket} socket - Individual client socket connection
 * @param {AuthService} authService - Service for authentication and group membership
 * @param {PresenceService} presenceService - Service for user presence tracking
 *
 * @events
 * - `join_group` - Join a group room and receive group data
 * - `leave_group` - Leave a group room and update presence
 * - `get_group_members` - Retrieve group member list with online status
 *
 * @emits
 * - `group_joined` - Successful group join with group data
 * - `group_left` - Successful group leave confirmation
 * - `group_members` - Group member list with online status
 * - `group_error` - Error responses for group operations
 *
 * @broadcasts
 * - `user_online` - User online status to group members
 * - `user_offline` - User offline status to group members
 *
 * @example
 * ```typescript
 * // Initialize group handlers for a new socket connection
 * handleGroupEvents(io, socket, authService, presenceService);
 * ```
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export function handleGroupEvents(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  authService: AuthService,
  presenceService: PresenceService
) {
  /**
   * JOIN_GROUP Event Handler
   *
   * @description Handles user joining a group room with comprehensive validation,
   * membership verification, and real-time presence updates.
   *
   * @flow
   * 1. Authenticate user and validate JWT token
   * 2. Extract and validate payload (groupId)
   * 3. Validate ObjectId format for groupId
   * 4. Verify user is member of target group
   * 5. Retrieve group details from database
   * 6. Join socket to group room
   * 7. Get online members in group
   * 8. Send success response with group data
   * 9. Broadcast user online status to group
   *
   * @security
   * - JWT authentication required
   * - Group membership validation
   * - ObjectId format validation
   * - Access control for group joining
   * - Clerk ID consistency for user identification
   *
   * @performance
   * - Efficient membership validation
   * - Single database query for group data
   * - Optimized online member retrieval
   * - Real-time room joining
   *
   * @payload {JoinGroupPayload}
   * - groupId: ObjectId of group to join
   *
   * @emits GROUP_JOINED - Success response with group data and online members
   * @emits GROUP_ERROR - Error response for validation failures
   * @broadcasts USER_ONLINE - User online status to group members
   */
  socket.on(SocketEvents.JOIN_GROUP, async (payload: JoinGroupPayload) => {
    try {
      // Step 1: Authentication validation
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      // Step 2: Extract authenticated user data
      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;

      // Step 3: Payload validation - ensure groupId is provided
      if (!groupId) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required field: groupId'
        ));
        return;
      }

      // Step 4: ObjectId format validation
      if (!ObjectId.isValid(groupId)) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Invalid groupId format'
        ));
        return;
      }

      // Step 5: Group membership validation
      // Uses Clerk ID for consistent user identification across services
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      // Step 6: Retrieve group details from database
      const group = await database.groups.findOne({
        _id: new ObjectId(groupId),
        isActive: true, // Only allow joining active groups
      });

      if (!group) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.GROUP_NOT_FOUND,
          'Group not found'
        ));
        return;
      }

      // Step 7: Join the group room and track membership
      await socket.join(SocketRooms.group(groupId));
      socket.data.joinedGroups.add(groupId);

      // Step 8: Get online members currently in this group
      const onlineUsers = await presenceService.getOnlineUsers(groupId);
      const onlineMembers = onlineUsers.map(user => user.userId);

      // Step 9a: Send success response to the joining user
      socket.emit(SocketEvents.GROUP_JOINED, {
        groupId,
        group,
        onlineMembers,
      });

      // Step 9b: Broadcast user online status to other group members
      // Excludes the joining user to avoid self-notification
      socket.to(SocketRooms.group(groupId)).emit(SocketEvents.USER_ONLINE, {
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

      console.log(`✅ User joined group: ${userId} -> ${groupId} (${group.name})`);
    } catch (error) {
      console.error('❌ Error joining group:', error);
      socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
        SocketErrorCodes.INTERNAL_ERROR,
        'Failed to join group'
      ));
    }
  });

  // Handle leave group
  socket.on(SocketEvents.LEAVE_GROUP, async (payload: LeaveGroupPayload) => {
    try {
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      const { userId } = getAuthenticatedUser(socket);
      const { groupId } = payload;

      // Validate payload
      if (!groupId) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required field: groupId'
        ));
        return;
      }

      // Leave the group room
      await socket.leave(SocketRooms.group(groupId));
      socket.data.joinedGroups.delete(groupId);

      // Emit success to the user
      socket.emit(SocketEvents.GROUP_LEFT, {
        groupId,
      });

      // Check if user is still online in other sessions for this group
      const userSessions = await presenceService.getUserSessions(userId);
      const stillInGroup = userSessions.some(session => {
        // This would require tracking which groups each session has joined
        // For now, we'll assume if user has other sessions, they might still be in the group
        return session.socketId !== socket.id;
      });

      if (!stillInGroup) {
        // Notify other group members that user left
        socket.to(SocketRooms.group(groupId)).emit(SocketEvents.USER_OFFLINE, {
          userId,
        });
      }

      console.log(`✅ User left group: ${userId} -> ${groupId}`);
    } catch (error) {
      console.error('❌ Error leaving group:', error);
      socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
        SocketErrorCodes.INTERNAL_ERROR,
        'Failed to leave group'
      ));
    }
  });

  // Handle get group members
  socket.on('get_group_members', async (payload: { groupId: string }) => {
    try {
      if (!requireAuth(socket)) {
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;

      // Validate payload
      if (!groupId || !ObjectId.isValid(groupId)) {
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        return;
      }

      // Get group with member details
      const group = await database.groups.aggregate([
        {
          $match: {
            _id: new ObjectId(groupId),
            isActive: true,
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'members.userId',
            foreignField: '_id',
            as: 'memberUsers',
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            members: {
              $map: {
                input: '$members',
                as: 'member',
                in: {
                  $mergeObjects: [
                    '$$member',
                    {
                      user: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: '$memberUsers',
                              cond: { $eq: ['$$this._id', '$$member.userId'] },
                            },
                          },
                          0,
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ]).toArray();

      if (group.length > 0) {
        // Get online status for members
        const onlineUsers = await presenceService.getOnlineUsers(groupId);
        const onlineUserIds = new Set(onlineUsers.map(user => user.userId));

        const membersWithStatus = group[0].members.map((member: any) => ({
          ...member,
          isOnline: onlineUserIds.has(member.userId.toString()),
        }));

        socket.emit('group_members', {
          groupId,
          members: membersWithStatus,
        });
      }
    } catch (error) {
      console.error('❌ Error getting group members:', error);
    }
  });
}
