import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { config } from './environment';

/**
 * Socket.io server configuration
 */
export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.server.isDevelopment ? true : config.socketio.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: config.socketio.pingTimeout,
    pingInterval: config.socketio.pingInterval,
    maxHttpBufferSize: config.socketio.maxHttpBufferSize,
    allowEIO3: config.socketio.allowEIO3,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    cookie: false,
  });

  // Socket.io middleware for logging connections
  io.use((socket, next) => {
    console.log(`🔌 Socket connection attempt from: ${socket.handshake.address}`);
    next();
  });

  return io;
}

/**
 * Socket.io event names for type safety
 */
export const SocketEvents = {
  // Connection events
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',

  // Authentication events
  AUTHENTICATE: 'authenticate',
  AUTHENTICATION_SUCCESS: 'authentication_success',
  AUTHENTICATION_ERROR: 'authentication_error',

  // Group events
  JOIN_GROUP: 'join_group',
  LEAVE_GROUP: 'leave_group',
  GROUP_JOINED: 'group_joined',
  GROUP_LEFT: 'group_left',
  GROUP_ERROR: 'group_error',

  // Message events
  SEND_MESSAGE: 'send_message',
  MESSAGE_SENT: 'message_sent',
  NEW_MESSAGE: 'new_message',
  MESSAGE_ERROR: 'message_error',
  MESSAGE_DELETED: 'message_deleted',

  // Read receipt events
  MARK_MESSAGE_READ: 'mark_message_read',
  MESSAGE_READ: 'message_read',
  MESSAGES_READ: 'messages_read',

  // Typing indicator events
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  USER_TYPING: 'user_typing',
  USER_STOPPED_TYPING: 'user_stopped_typing',

  // Presence events
  USER_ONLINE: 'user_online',
  USER_OFFLINE: 'user_offline',
  USER_STATUS_CHANGED: 'user_status_changed',
  GET_ONLINE_USERS: 'get_online_users',
  ONLINE_USERS: 'online_users',

  // AI Feature events
  REQUEST_SMART_REPLIES: 'request_smart_replies',
  SMART_REPLY_STREAM: 'smart_reply_stream',
  SMART_REPLIES_COMPLETE: 'smart_replies_complete',
  REQUEST_TYPING_SUGGESTIONS: 'request_typing_suggestions',
  TYPING_SUGGESTION: 'typing_suggestion',
  RATE_AI_SUGGESTION: 'rate_ai_suggestion',
  AI_ERROR: 'ai_error',

  // Error events
  ERROR: 'error',
  VALIDATION_ERROR: 'validation_error',
  RATE_LIMIT_ERROR: 'rate_limit_error',
} as const;

export type SocketEventName = typeof SocketEvents[keyof typeof SocketEvents];

/**
 * Socket.io room naming conventions
 */
export const SocketRooms = {
  /**
   * Get group room name
   */
  group: (groupId: string): string => `group:${groupId}`,

  /**
   * Get user room name (for private notifications)
   */
  user: (userId: string): string => `user:${userId}`,

  /**
   * Get typing room name for a group
   */
  typing: (groupId: string): string => `typing:${groupId}`,

  /**
   * Get presence room name
   */
  presence: (): string => 'presence',
} as const;

/**
 * Socket.io error codes
 */
export const SocketErrorCodes = {
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  ACCESS_DENIED: 'ACCESS_DENIED',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  MESSAGE_TOO_LONG: 'MESSAGE_TOO_LONG',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type SocketErrorCode = typeof SocketErrorCodes[keyof typeof SocketErrorCodes];

/**
 * Socket.io error response interface
 */
export interface SocketError {
  code: SocketErrorCode;
  message: string;
  details?: any;
  timestamp: Date;
}

/**
 * Create standardized socket error
 */
export function createSocketError(
  code: SocketErrorCode,
  message: string,
  details?: any
): SocketError {
  return {
    code,
    message,
    details,
    timestamp: new Date(),
  };
}
