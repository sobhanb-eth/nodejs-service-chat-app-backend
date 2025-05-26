/**
 * Local Database Types for Node.js Service
 * Copied from shared types to avoid import issues
 */

import { ObjectId } from 'mongodb';

// Base Entity
export interface BaseEntity {
  _id?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// User Entity
export interface User extends BaseEntity {
  clerkId: string;
  email: string;
  firstName: string;
  lastName: string;
  username?: string;
  profileImageUrl?: string;
  isActive: boolean;
  lastSeen?: Date;
}

// Group Entity
export interface Group extends BaseEntity {
  name: string;
  description?: string;
  ownerId: string; // Clerk user ID as string
  members: GroupMember[];
  isPrivate: boolean;
  isActive: boolean;
}

// Group Member
export interface GroupMember {
  userId: string; // Clerk user ID as string
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

// Message Entity
export interface Message extends BaseEntity {
  groupId: ObjectId;
  senderId: string; // Clerk user ID as string
  content: string;
  type: 'text' | 'image' | 'file' | 'system';
  isDeleted: boolean;
  readBy: MessageRead[];
}

// Message Read Receipt
export interface MessageRead {
  userId: string; // Clerk user ID as string
  readAt: Date;
}

// Session Entity
export interface Session extends BaseEntity {
  userId: string; // Clerk user ID as string
  socketId: string;
  status: 'online' | 'away' | 'offline';
  lastActivity: Date;
  deviceType: 'mobile' | 'web' | 'desktop';
}

// Collection Names
export const Collections = {
  USERS: 'users',
  GROUPS: 'groups',
  MESSAGES: 'messages',
  SESSIONS: 'sessions'
} as const;

export type CollectionName = typeof Collections[keyof typeof Collections];
