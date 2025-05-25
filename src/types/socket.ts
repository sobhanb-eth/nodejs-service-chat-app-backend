import { User, Message, Group } from './database';

/**
 * Socket.io event payload types for type safety
 */

// Authentication events
export interface AuthenticatePayload {
  token: string;
}

export interface AuthenticationSuccessPayload {
  user: User;
  sessionId: string;
}

export interface AuthenticationErrorPayload {
  error: string;
  code: string;
}

// Group events
export interface JoinGroupPayload {
  groupId: string;
}

export interface LeaveGroupPayload {
  groupId: string;
}

export interface GroupJoinedPayload {
  groupId: string;
  group: Group;
  onlineMembers: string[]; // User IDs
}

export interface GroupLeftPayload {
  groupId: string;
}

// Message events
export interface SendMessagePayload {
  groupId: string;
  content: string;
  type: 'text' | 'image' | 'file';
  tempId?: string; // Client-side temporary ID for optimistic updates
}

export interface MessageSentPayload {
  message: Message;
  tempId?: string;
}

export interface NewMessagePayload {
  message: Message;
  sender: User;
}

export interface MessageDeletedPayload {
  messageId: string;
  groupId: string;
  deletedBy: string;
}

// Read receipt events
export interface MarkMessageReadPayload {
  messageId: string;
  groupId: string;
}

export interface MessageReadPayload {
  messageId: string;
  groupId: string;
  readBy: string; // User ID
  readAt: Date;
}

export interface MessagesReadPayload {
  groupId: string;
  messageIds: string[];
  readBy: string; // User ID
  readAt: Date;
}

// Typing indicator events
export interface TypingStartPayload {
  groupId: string;
}

export interface TypingStopPayload {
  groupId: string;
}

export interface UserTypingPayload {
  groupId: string;
  userId: string;
  user: Pick<User, '_id' | 'firstName' | 'lastName' | 'username'>;
}

export interface UserStoppedTypingPayload {
  groupId: string;
  userId: string;
}

// Presence events
export interface UserOnlinePayload {
  userId: string;
  user: Pick<User, '_id' | 'firstName' | 'lastName' | 'username' | 'profileImageUrl'>;
  status: 'online' | 'away';
}

export interface UserOfflinePayload {
  userId: string;
}

export interface UserStatusChangedPayload {
  userId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen?: Date;
}

export interface GetOnlineUsersPayload {
  groupId?: string; // If provided, get online users for specific group
}

export interface OnlineUsersPayload {
  users: Array<{
    userId: string;
    user: Pick<User, '_id' | 'firstName' | 'lastName' | 'username' | 'profileImageUrl'>;
    status: 'online' | 'away';
    lastActivity: Date;
  }>;
  groupId?: string;
}

// Error events
export interface ErrorPayload {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
}

export interface ValidationErrorPayload {
  field: string;
  message: string;
  value?: any;
}

export interface RateLimitErrorPayload {
  message: string;
  retryAfter: number; // Seconds
}

// AI Feature Payloads
export interface RequestSmartRepliesPayload {
  messageContent: string;
  groupId: string;
  contextMessages?: string[]; // Recent message history for context
}

export interface RequestTypingSuggestionsPayload {
  partialText: string;
  groupId: string;
  cursorPosition?: number;
}

export interface RateAISuggestionPayload {
  suggestionId: string;
  rating: 'helpful' | 'not_helpful' | 'inappropriate';
  feedback?: string;
}

export interface SmartReplyStreamPayload {
  requestId: string;
  chunk: string;
  isComplete: boolean;
}

export interface SmartRepliesCompletePayload {
  requestId: string;
  suggestions: string[];
  confidence: number;
  processingTime: number;
}

export interface TypingSuggestionPayload {
  requestId: string;
  suggestion: string;
  confidence: number;
}

/**
 * Socket.io server-to-client events interface
 */
export interface ServerToClientEvents {
  // Authentication
  authentication_success: (payload: AuthenticationSuccessPayload) => void;
  authentication_error: (payload: AuthenticationErrorPayload) => void;

  // Groups
  group_joined: (payload: GroupJoinedPayload) => void;
  group_left: (payload: GroupLeftPayload) => void;
  group_error: (payload: ErrorPayload) => void;

  // Messages
  message_sent: (payload: MessageSentPayload) => void;
  new_message: (payload: NewMessagePayload) => void;
  message_error: (payload: ErrorPayload) => void;
  message_deleted: (payload: MessageDeletedPayload) => void;

  // AI Features (Real-time responses)
  smart_reply_stream: (payload: SmartReplyStreamPayload) => void;
  smart_replies_complete: (payload: SmartRepliesCompletePayload) => void;
  typing_suggestion: (payload: TypingSuggestionPayload) => void;
  ai_error: (payload: ErrorPayload) => void;

  // Read receipts
  message_read: (payload: MessageReadPayload) => void;
  messages_read: (payload: MessagesReadPayload) => void;

  // Typing indicators
  user_typing: (payload: UserTypingPayload) => void;
  user_stopped_typing: (payload: UserStoppedTypingPayload) => void;

  // Presence
  user_online: (payload: UserOnlinePayload) => void;
  user_offline: (payload: UserOfflinePayload) => void;
  user_status_changed: (payload: UserStatusChangedPayload) => void;
  online_users: (payload: OnlineUsersPayload) => void;

  // Errors
  error: (payload: ErrorPayload) => void;
  validation_error: (payload: ValidationErrorPayload) => void;
  rate_limit_error: (payload: RateLimitErrorPayload) => void;
}

/**
 * Socket.io client-to-server events interface
 */
export interface ClientToServerEvents {
  // Authentication
  authenticate: (payload: AuthenticatePayload) => void;

  // Groups
  join_group: (payload: JoinGroupPayload) => void;
  leave_group: (payload: LeaveGroupPayload) => void;

  // Messages
  send_message: (payload: SendMessagePayload) => void;
  mark_message_read: (payload: MarkMessageReadPayload) => void;

  // AI Features (Real-time)
  request_smart_replies: (payload: RequestSmartRepliesPayload) => void;
  request_typing_suggestions: (payload: RequestTypingSuggestionsPayload) => void;
  rate_ai_suggestion: (payload: RateAISuggestionPayload) => void;

  // Typing indicators
  typing_start: (payload: TypingStartPayload) => void;
  typing_stop: (payload: TypingStopPayload) => void;

  // Presence
  get_online_users: (payload: GetOnlineUsersPayload) => void;
}

/**
 * Socket.io inter-server events interface (for scaling)
 */
export interface InterServerEvents {
  ping: () => void;
}

/**
 * Socket data interface (attached to each socket)
 */
export interface SocketData {
  userId?: string;
  user?: User;
  sessionId?: string;
  isAuthenticated: boolean;
  joinedGroups: Set<string>;
  lastActivity: Date;
  deviceType: 'mobile' | 'web' | 'desktop';
}
