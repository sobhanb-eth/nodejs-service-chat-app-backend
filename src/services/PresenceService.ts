import { ObjectId } from 'mongodb';
import { database } from '../config/database';
import { Session, User } from '../types/database';
import { config } from '../config/environment';

/**
 * Online user information
 */
export interface OnlineUser {
  userId: string;
  user: Pick<User, '_id' | 'firstName' | 'lastName' | 'username' | 'profileImageUrl'>;
  status: 'online' | 'away';
  lastActivity: Date;
  deviceType: 'mobile' | 'web' | 'desktop';
}

/**
 * Presence service for tracking online users and sessions
 */
export class PresenceService {
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Create or update user session
   */
  async createSession(
    userId: string,
    socketId: string,
    deviceType: 'mobile' | 'web' | 'desktop'
  ): Promise<Session> {
    try {
      // userId is now a Clerk user ID string, not MongoDB ObjectId
      if (!userId || typeof userId !== 'string') {
        throw new Error('Invalid userId');
      }

      const now = new Date();

      // Remove any existing session for this socket
      await this.removeSessionBySocketId(socketId);

      const session: Omit<Session, '_id'> = {
        userId: userId, // Use string userId directly
        socketId,
        status: 'online',
        lastActivity: now,
        deviceType,
        createdAt: now,
        updatedAt: now,
      };

      const result = await database.sessions.insertOne(session as Session);
      const createdSession = await database.sessions.findOne({ _id: result.insertedId });

      if (!createdSession) {
        throw new Error('Failed to create session');
      }

      // Update user's last seen (find by clerkId since userId is Clerk user ID)
      await database.users.updateOne(
        { clerkId: userId },
        {
          $set: {
            lastSeen: now,
            updatedAt: now,
          },
        }
      );

      console.log(`✅ Created session for user: ${userId} (${socketId})`);
      return createdSession;
    } catch (error) {
      console.error('❌ Error creating session:', error);
      throw error;
    }
  }

  /**
   * Remove session by socket ID
   */
  async removeSessionBySocketId(socketId: string): Promise<boolean> {
    try {
      const session = await database.sessions.findOne({ socketId });

      if (session) {
        // Update user's last seen before removing session (find by clerkId since userId is Clerk user ID)
        await database.users.updateOne(
          { clerkId: session.userId },
          {
            $set: {
              lastSeen: new Date(),
              updatedAt: new Date(),
            },
          }
        );
      }

      const result = await database.sessions.deleteOne({ socketId });

      if (result.deletedCount > 0) {
        console.log(`✅ Removed session: ${socketId}`);
      }

      return result.deletedCount > 0;
    } catch (error) {
      console.error('❌ Error removing session:', error);
      return false;
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(socketId: string): Promise<void> {
    try {
      await database.sessions.updateOne(
        { socketId },
        {
          $set: {
            lastActivity: new Date(),
            updatedAt: new Date(),
          },
        }
      );
    } catch (error) {
      console.error('❌ Error updating session activity:', error);
      // Don't throw error for this operation
    }
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    socketId: string,
    status: 'online' | 'away' | 'offline'
  ): Promise<boolean> {
    try {
      const result = await database.sessions.updateOne(
        { socketId },
        {
          $set: {
            status,
            lastActivity: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error('❌ Error updating session status:', error);
      return false;
    }
  }

  /**
   * Get online users (all or for specific group)
   */
  async getOnlineUsers(groupId?: string): Promise<OnlineUser[]> {
    try {
      const pipeline: any[] = [
        // Match active sessions
        {
          $match: {
            status: { $in: ['online', 'away'] },
            lastActivity: {
              $gte: new Date(Date.now() - config.session.timeout),
            },
          },
        },
        // Group by userId to get latest session per user
        {
          $group: {
            _id: '$userId',
            latestSession: { $first: '$$ROOT' },
          },
        },
        // Lookup user information (join by clerkId since sessions store Clerk user IDs)
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: 'clerkId',
            as: 'user',
          },
        },
        // Unwind user array
        {
          $unwind: '$user',
        },
        // Match active users
        {
          $match: {
            'user.isActive': true,
          },
        },
      ];

      // If groupId is provided, filter by group membership
      if (groupId && ObjectId.isValid(groupId)) {
        pipeline.push({
          $lookup: {
            from: 'groups',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  _id: new ObjectId(groupId),
                  isActive: true,
                  'members.userId': { $eq: '$$userId' },
                },
              },
            ],
            as: 'groupMembership',
          },
        });

        pipeline.push({
          $match: {
            groupMembership: { $ne: [] },
          },
        });
      }

      // Project final result
      pipeline.push({
        $project: {
          userId: { $toString: '$_id' },
          user: {
            _id: '$user._id',
            firstName: '$user.firstName',
            lastName: '$user.lastName',
            username: '$user.username',
            profileImageUrl: '$user.profileImageUrl',
          },
          status: '$latestSession.status',
          lastActivity: '$latestSession.lastActivity',
          deviceType: '$latestSession.deviceType',
        },
      });

      const onlineUsers = await database.sessions.aggregate(pipeline).toArray();
      return onlineUsers as OnlineUser[];
    } catch (error) {
      console.error('❌ Error getting online users:', error);
      return [];
    }
  }

  /**
   * Check if user is online
   */
  async isUserOnline(userId: string): Promise<boolean> {
    try {
      const session = await database.sessions.findOne({
        userId: userId, // Use string userId directly
        status: { $in: ['online', 'away'] },
        lastActivity: {
          $gte: new Date(Date.now() - config.session.timeout),
        },
      });

      return !!session;
    } catch (error) {
      console.error('❌ Error checking if user is online:', error);
      return false;
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    try {
      const sessions = await database.sessions.find({
        userId: userId, // Use string userId directly
        lastActivity: {
          $gte: new Date(Date.now() - config.session.timeout),
        },
      }).toArray();

      return sessions;
    } catch (error) {
      console.error('❌ Error getting user sessions:', error);
      return [];
    }
  }

  /**
   * Start cleanup interval for expired sessions
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        const cutoffTime = new Date(Date.now() - config.session.timeout);

        const result = await database.sessions.deleteMany({
          lastActivity: { $lt: cutoffTime },
        });

        if (result.deletedCount > 0) {
          console.log(`🧹 Cleaned up ${result.deletedCount} expired sessions`);
        }
      } catch (error) {
        console.error('❌ Error during session cleanup:', error);
      }
    }, config.session.cleanupInterval);
  }

  /**
   * Stop cleanup interval
   */
  public stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
