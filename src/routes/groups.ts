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

export default router;
