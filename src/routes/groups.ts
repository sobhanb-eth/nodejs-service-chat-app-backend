import express from 'express';
import { ObjectId } from 'mongodb';
import { database } from '../config/database';

const router = express.Router();

/**
 * Create a new group
 * POST /api/groups
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, creatorId } = req.body;

    // Validate input
    if (!name || !creatorId) {
      return res.status(400).json({
        error: 'Name and creatorId are required'
      });
    }

    // Authentication is handled by middleware

    // Create the group
    const group = {
      _id: new ObjectId(),
      name: name.trim(),
      description: description?.trim() || '',
      ownerId: creatorId, // Store Clerk user ID as string
      members: [{
        userId: creatorId, // Store Clerk user ID as string
        role: 'owner' as const,
        joinedAt: new Date()
      }],
      isPrivate: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await database.groups.insertOne(group);

    console.log(`✅ Created new group: ${group.name} (${group._id}) by user: ${creatorId}`);

    res.status(201).json({
      success: true,
      group: {
        id: group._id.toString(),
        name: group.name,
        description: group.description,
        ownerId: group.ownerId, // Already a string
        memberCount: group.members.length,
        createdAt: group.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Error creating group:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Get user's groups (groups they are members of)
 * GET /api/groups/my-groups?userId=xxx
 */
router.get('/my-groups', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    const userIdString = userId as string;

    // Get all groups where user is a member
    const userGroups = await database.groups.find({
      isActive: true,
      'members.userId': userIdString
    }).toArray();

    const groupsData = userGroups.map(group => ({
      id: group._id!.toString(),
      name: group.name,
      description: group.description,
      ownerId: group.ownerId,
      memberCount: group.members.length,
      isPrivate: group.isPrivate,
      createdAt: group.createdAt,
      userRole: group.members.find(m => m.userId === userIdString)?.role || 'member'
    }));

    res.json({
      success: true,
      groups: groupsData
    });

  } catch (error) {
    console.error('❌ Error getting user groups:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Get all groups (for discovery)
 * GET /api/groups/discover
 */
router.get('/discover', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    // Get all active groups that the user is NOT a member of
    const userIdString = userId as string;

    const allGroups = await database.groups.find({
      isActive: true,
      'members.userId': { $ne: userIdString }
    }).toArray();

    const groupsForDiscovery = allGroups.map(group => ({
      id: group._id!.toString(),
      name: group.name,
      description: group.description,
      memberCount: group.members.length,
      isPrivate: group.isPrivate,
      createdAt: group.createdAt
    }));

    res.json({
      success: true,
      groups: groupsForDiscovery
    });

  } catch (error) {
    console.error('❌ Error getting groups for discovery:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Join a group
 * POST /api/groups/:groupId/join
 */
router.post('/:groupId/join', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    const userIdString = userId;
    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Check if user is already a member
    if (group.members.some(member => member.userId === userIdString)) {
      return res.status(400).json({
        error: 'User is already a member of this group'
      });
    }

    // Add user to group
    const newMember = {
      userId: userIdString, // Store as string
      role: 'member' as const,
      joinedAt: new Date()
    };

    await database.groups.updateOne(
      { _id: groupObjectId },
      {
        $push: { members: newMember },
        $set: { updatedAt: new Date() }
      }
    );

    console.log(`✅ User ${userId} joined group ${groupId}`);

    res.json({
      success: true,
      message: 'Successfully joined group'
    });

  } catch (error) {
    console.error('❌ Error joining group:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Leave a group
 * POST /api/groups/:groupId/leave
 */
router.post('/:groupId/leave', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    const userIdString = userId;
    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Check if user is the owner
    const userMember = group.members.find(member => member.userId === userIdString);
    if (!userMember) {
      return res.status(400).json({
        error: 'User is not a member of this group'
      });
    }

    if (userMember.role === 'owner') {
      return res.status(400).json({
        error: 'Owner cannot leave group without transferring ownership'
      });
    }

    // Remove user from group
    await database.groups.updateOne(
      { _id: groupObjectId },
      {
        $pull: { members: { userId: userIdString } },
        $set: { updatedAt: new Date() }
      }
    );

    console.log(`✅ User ${userId} left group ${groupId}`);

    res.json({
      success: true,
      message: 'Successfully left group'
    });

  } catch (error) {
    console.error('❌ Error leaving group:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Transfer ownership of a group
 * POST /api/groups/:groupId/transfer-ownership
 */
router.post('/:groupId/transfer-ownership', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { currentOwnerId, newOwnerId } = req.body;

    if (!currentOwnerId || !newOwnerId) {
      return res.status(400).json({
        error: 'currentOwnerId and newOwnerId are required'
      });
    }

    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Verify current user is the owner
    if (group.ownerId !== currentOwnerId) {
      return res.status(403).json({
        error: 'Only the current owner can transfer ownership'
      });
    }

    // Check if new owner is a member of the group
    const newOwnerMember = group.members.find(member => member.userId === newOwnerId);
    if (!newOwnerMember) {
      return res.status(400).json({
        error: 'New owner must be a member of the group'
      });
    }

    // Update group ownership and member roles
    await database.groups.updateOne(
      { _id: groupObjectId },
      {
        $set: {
          ownerId: newOwnerId,
          updatedAt: new Date(),
          'members.$[currentOwner].role': 'member',
          'members.$[newOwner].role': 'owner'
        }
      },
      {
        arrayFilters: [
          { 'currentOwner.userId': currentOwnerId },
          { 'newOwner.userId': newOwnerId }
        ]
      }
    );

    console.log(`✅ Ownership transferred from ${currentOwnerId} to ${newOwnerId} for group ${groupId}`);

    res.json({
      success: true,
      message: 'Ownership transferred successfully'
    });

  } catch (error) {
    console.error('❌ Error transferring ownership:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Delete a group (owner only)
 * DELETE /api/groups/:groupId
 */
router.delete('/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Verify user is the owner
    if (group.ownerId !== userId) {
      return res.status(403).json({
        error: 'Only the group owner can delete the group'
      });
    }

    // Soft delete the group
    await database.groups.updateOne(
      { _id: groupObjectId },
      {
        $set: {
          isActive: false,
          updatedAt: new Date()
        }
      }
    );

    console.log(`✅ Group ${groupId} deleted by owner ${userId}`);

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting group:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Get group members with user details
 * GET /api/groups/:groupId/members
 */
router.get('/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'userId is required'
      });
    }

    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Check if user is a member of the group
    const userMember = group.members.find(member => member.userId === userId as string);
    if (!userMember) {
      return res.status(403).json({
        error: 'You must be a member of the group to view members'
      });
    }

    // Get user details for all members
    const memberUserIds = group.members.map(member => member.userId);
    const users = await database.users.find({
      clerkId: { $in: memberUserIds },
      isActive: true
    }).toArray();

    // Combine member data with user details
    const membersData = group.members.map(member => {
      const userDetails = users.find(user => user.clerkId === member.userId);
      return {
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        name: userDetails?.firstName || '',
        email: userDetails?.email || '',
        username: userDetails?.username || '',
        profileImageUrl: userDetails?.profileImageUrl || null
      };
    });

    res.json({
      success: true,
      members: membersData,
      groupInfo: {
        id: group._id!.toString(),
        name: group.name,
        ownerId: group.ownerId,
        memberCount: group.members.length
      }
    });

  } catch (error) {
    console.error('❌ Error getting group members:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
