import { MongoClient, ObjectId, Collection } from 'mongodb';
import { Group, GroupMember, User } from '../types/database';

/**
 * Comprehensive Group Service with all functionality from .NET service
 */
export class GroupService {
  private db: MongoClient;
  private groups: Collection<Group>;
  private users: Collection<User>;

  constructor(db: MongoClient) {
    this.db = db;
    this.groups = db.db('RealTimeChatAiApp').collection<Group>('groups');
    this.users = db.db('RealTimeChatAiApp').collection<User>('users');
  }

  /**
   * Create a new group with owner permissions
   */
  async createGroup(name: string, description: string, ownerId: string): Promise<Group> {
    const group: Group = {
      _id: new ObjectId(),
      name: name.trim(),
      description: description?.trim() || '',
      ownerId: ownerId, // Store Clerk user ID as string
      members: [{
        userId: ownerId, // Store Clerk user ID as string
        role: 'owner',
        joinedAt: new Date()
      }],
      isPrivate: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.groups.insertOne(group);
    return group;
  }

  /**
   * Get group by ID with member validation
   */
  async getGroupById(groupId: string, requestingUserId?: string): Promise<Group | null> {
    const group = await this.groups.findOne({
      _id: new ObjectId(groupId),
      isActive: true
    });

    if (!group) return null;

    // If requesting user is provided, check if they're a member
    if (requestingUserId) {
      const isMember = group.members.some(m =>
        m.userId.toString() === requestingUserId
      );
      if (!isMember && group.isPrivate) {
        return null; // Private group, user not a member
      }
    }

    return group;
  }

  /**
   * Get all groups (public) or user's groups
   */
  async getGroups(userId?: string): Promise<Group[]> {
    if (userId) {
      // Get groups where user is a member
      return await this.groups.find({
        'members.userId': new ObjectId(userId),
        isActive: true
      }).toArray();
    } else {
      // Get all public groups
      return await this.groups.find({
        isPrivate: false,
        isActive: true
      }).toArray();
    }
  }

  /**
   * Get groups user is NOT a member of (for joining)
   */
  async getAvailableGroups(userId: string): Promise<Group[]> {
    return await this.groups.find({
      'members.userId': { $ne: new ObjectId(userId) },
      isPrivate: false,
      isActive: true
    }).toArray();
  }

  /**
   * Add member to group with permission checks
   */
  async addMember(groupId: string, userId: string, addedByUserId: string, role: 'member' | 'admin' = 'member'): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    // Check if adding user has permission
    const addingMember = group.members.find(m => m.userId.toString() === addedByUserId);
    if (!addingMember || (addingMember.role !== 'owner' && addingMember.role !== 'admin')) {
      return false;
    }

    // Check if user is already a member
    const existingMember = group.members.find(m => m.userId.toString() === userId);
    if (existingMember) return false;

    // Add new member
    const newMember: GroupMember = {
      userId: userId, // Use string userId directly
      role,
      joinedAt: new Date()
    };

    await this.groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $push: { members: newMember },
        $set: { updatedAt: new Date() }
      }
    );

    return true;
  }

  /**
   * Remove member from group with permission checks
   */
  async removeMember(groupId: string, userId: string, removedByUserId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    // Check if removing user has permission
    const removingMember = group.members.find(m => m.userId.toString() === removedByUserId);
    if (!removingMember || (removingMember.role !== 'owner' && removingMember.role !== 'admin')) {
      return false;
    }

    // Can't remove owner
    const memberToRemove = group.members.find(m => m.userId.toString() === userId);
    if (!memberToRemove || memberToRemove.role === 'owner') {
      return false;
    }

    await this.groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $pull: { members: { userId: userId } }, // Use string userId directly
        $set: { updatedAt: new Date() }
      }
    );

    return true;
  }

  /**
   * Join group (self-join for public groups)
   */
  async joinGroup(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group || group.isPrivate) return false;

    // Check if already a member
    const existingMember = group.members.find(m => m.userId.toString() === userId);
    if (existingMember) return false;

    return await this.addMember(groupId, userId, userId, 'member');
  }

  /**
   * Leave group with owner transfer validation
   */
  async leaveGroup(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    const member = group.members.find(m => m.userId.toString() === userId);
    if (!member) return false;

    // Owner cannot leave without transferring ownership
    if (member.role === 'owner' && group.members.length > 1) {
      return false; // Must transfer ownership first
    }

    // If owner is leaving and they're the only member, delete the group
    if (member.role === 'owner' && group.members.length === 1) {
      return await this.deleteGroup(groupId, userId);
    }

    await this.groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $pull: { members: { userId: userId } }, // Use string userId directly
        $set: { updatedAt: new Date() }
      }
    );

    return true;
  }

  /**
   * Transfer group ownership
   */
  async transferOwnership(groupId: string, currentOwnerId: string, newOwnerId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    // Verify current owner
    const currentOwner = group.members.find(m =>
      m.userId.toString() === currentOwnerId && m.role === 'owner'
    );
    if (!currentOwner) return false;

    // Verify new owner is a member
    const newOwner = group.members.find(m => m.userId.toString() === newOwnerId);
    if (!newOwner) return false;

    // Update roles
    await this.groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $set: {
          'members.$[currentOwner].role': 'admin',
          'members.$[newOwner].role': 'owner',
          ownerId: newOwnerId, // Use string userId directly
          updatedAt: new Date()
        }
      },
      {
        arrayFilters: [
          { 'currentOwner.userId': currentOwnerId }, // Use string userId directly
          { 'newOwner.userId': newOwnerId } // Use string userId directly
        ]
      }
    );

    return true;
  }

  /**
   * Delete group (owner only)
   */
  async deleteGroup(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    // Only owner can delete
    const member = group.members.find(m => m.userId.toString() === userId);
    if (!member || member.role !== 'owner') return false;

    await this.groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $set: {
          isActive: false,
          updatedAt: new Date()
        }
      }
    );

    return true;
  }

  /**
   * Update group settings (owner/admin only)
   */
  async updateGroup(groupId: string, updates: Partial<Pick<Group, 'name' | 'description' | 'isPrivate'>>, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    // Check permissions
    const member = group.members.find(m => m.userId.toString() === userId);
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return false;
    }

    const updateData: any = { updatedAt: new Date() };
    if (updates.name) updateData.name = updates.name.trim();
    if (updates.description !== undefined) updateData.description = updates.description.trim();
    if (updates.isPrivate !== undefined) updateData.isPrivate = updates.isPrivate;

    await this.groups.updateOne(
      { _id: new ObjectId(groupId) },
      { $set: updateData }
    );

    return true;
  }

  /**
   * Check if user is member of group
   */
  async isUserMember(groupId: string, userId: string): Promise<boolean> {
    const group = await this.getGroupById(groupId);
    if (!group) return false;

    return group.members.some(m => m.userId.toString() === userId);
  }

  /**
   * Get user's role in group
   */
  async getUserRole(groupId: string, userId: string): Promise<string | null> {
    const group = await this.getGroupById(groupId);
    if (!group) return null;

    const member = group.members.find(m => m.userId.toString() === userId);
    return member?.role || null;
  }
}
