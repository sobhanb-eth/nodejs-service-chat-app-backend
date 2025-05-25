import { Request } from 'express';
import { User } from './database';

/**
 * Extended Request interface with user authentication
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    clerkId: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  file?: Express.Multer.File;
}

/**
 * API Response types
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface GroupResponse {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  memberCount: number;
  isPrivate?: boolean;
  createdAt: Date;
}

export interface MessageResponse {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'file' | 'system';
  isDeleted: boolean;
  readBy: Array<{
    userId: string;
    readAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaResponse {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  url?: string;
  thumbnailUrl?: string;
  createdAt: Date;
}

export interface SmartReplyResponse {
  suggestions: string[];
  confidence: number;
  context: string;
}

export interface MessageAnalysisResponse {
  sentiment: 'positive' | 'negative' | 'neutral';
  topics: string[];
  confidence: number;
}

export interface ModerationResponse {
  isAppropriate: boolean;
  reason?: string;
  confidence: number;
}

/**
 * Request body types
 */
export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
  isPrivate?: boolean;
}

export interface TransferOwnershipRequest {
  newOwnerId: string;
}

export interface SmartReplyRequest {
  messageContent: string;
  groupId: string;
}

export interface AnalyzeMessageRequest {
  content: string;
}

export interface ContextualResponseRequest {
  query: string;
  groupId: string;
  maxTokens?: number;
}

export interface ModerateContentRequest {
  content: string;
}

/**
 * Socket.io event types
 */
export interface SocketAuthPayload {
  token: string;
}

export interface SocketMessagePayload {
  groupId: string;
  content: string;
  type: 'text' | 'image' | 'file';
  tempId?: string;
}

export interface SocketJoinGroupPayload {
  groupId: string;
}

export interface SocketLeaveGroupPayload {
  groupId: string;
}

export interface SocketTypingPayload {
  groupId: string;
  isTyping: boolean;
}

/**
 * Error types
 */
export class ApiError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND_ERROR');
    this.name = 'NotFoundError';
  }
}

/**
 * Utility types
 */
export type PaginationQuery = {
  limit?: string;
  before?: string;
  after?: string;
};

export type SortQuery = {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

export type FilterQuery = {
  search?: string;
  type?: string;
  status?: string;
};
