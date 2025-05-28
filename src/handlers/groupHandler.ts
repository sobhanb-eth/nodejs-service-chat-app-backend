import { Socket, Server as SocketIOServer } from 'socket.io';
import { ObjectId } from 'mongodb';
import { SocketData, JoinGroupPayload, LeaveGroupPayload } from '../types/socket';
import { SocketEvents, SocketRooms, createSocketError, SocketErrorCodes } from '../config/socket';
import { AuthService } from '../services/AuthService';
import { PresenceService } from '../services/PresenceService';
import { database } from '../config/database';
import { getAuthenticatedUser, requireAuth } from '../middleware/auth';

/**
 * Handle group-related socket events
 */
export function handleGroupEvents(
  io: SocketIOServer,
  socket: Socket<any, any, any, SocketData>,
  authService: AuthService,
  presenceService: PresenceService
) {
  // Handle join group
  socket.on(SocketEvents.JOIN_GROUP, async (payload: JoinGroupPayload) => {
    try {
      if (!requireAuth(socket)) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication required'
        ));
        return;
      }

      const { userId, user } = getAuthenticatedUser(socket);
      const { groupId } = payload;

      // Validate payload
      if (!groupId) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Missing required field: groupId'
        ));
        return;
      }

      // Validate ObjectId
      if (!ObjectId.isValid(groupId)) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.VALIDATION_ERROR,
          'Invalid groupId format'
        ));
        return;
      }

      // Check if user is member of the group (use Clerk ID for membership check)
      const isMember = await authService.isUserGroupMember(user.clerkId, groupId);
      if (!isMember) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.ACCESS_DENIED,
          'You are not a member of this group'
        ));
        return;
      }

      // Get group details
      const group = await database.groups.findOne({
        _id: new ObjectId(groupId),
        isActive: true,
      });

      if (!group) {
        socket.emit(SocketEvents.GROUP_ERROR, createSocketError(
          SocketErrorCodes.GROUP_NOT_FOUND,
          'Group not found'
        ));
        return;
      }

      // Join the group room
      await socket.join(SocketRooms.group(groupId));
      socket.data.joinedGroups.add(groupId);

      // Get online members in this group
      const onlineUsers = await presenceService.getOnlineUsers(groupId);
      const onlineMembers = onlineUsers.map(user => user.userId);

      // Emit success to the user
      socket.emit(SocketEvents.GROUP_JOINED, {
        groupId,
        group,
        onlineMembers,
      });

      // Notify other group members that user joined (for presence)
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
