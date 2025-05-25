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

    // For now, skip authentication to get it working quickly
    // TODO: Add proper authentication later

    // Create the group
    const group = {
      _id: new ObjectId(),
      name: name.trim(),
      description: description?.trim() || '',
      ownerId: new ObjectId(creatorId),
      members: [{
        userId: new ObjectId(creatorId),
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
        ownerId: group.ownerId.toString(),
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
    const userObjectId = new ObjectId(userId as string);

    const allGroups = await database.groups.find({
      isActive: true,
      'members.userId': { $ne: userObjectId }
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

    const userObjectId = new ObjectId(userId);
    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Check if user is already a member
    if (group.members.some(member => member.userId.equals(userObjectId))) {
      return res.status(400).json({
        error: 'User is already a member of this group'
      });
    }

    // Add user to group
    const newMember = {
      userId: userObjectId,
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

    const userObjectId = new ObjectId(userId);
    const groupObjectId = new ObjectId(groupId);

    // Check if group exists
    const group = await database.groups.findOne({ _id: groupObjectId, isActive: true });
    if (!group) {
      return res.status(404).json({
        error: 'Group not found'
      });
    }

    // Check if user is the owner
    const userMember = group.members.find(member => member.userId.equals(userObjectId));
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
        $pull: { members: { userId: userObjectId } },
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
