import { Socket } from 'socket.io';
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/clerk-sdk-node';
import { config } from '../config/environment';
import { SocketError, createSocketError, SocketErrorCodes } from '../config/socket';
import { AuthService } from '../services/AuthService';
import { SocketData } from '../types/socket';
import { AuthenticatedRequest } from '../types/api';

/**
 * JWT payload interface from Clerk
 */
interface ClerkJWTPayload {
  sub: string; // Clerk user ID
  email?: string;
  email_address?: string;
  primary_email_address?: string;
  given_name?: string;
  family_name?: string;
  username?: string;
  picture?: string;
  iss: string; // Issuer
  aud?: string; // Audience
  exp: number; // Expiration time
  iat: number; // Issued at
  nbf?: number; // Not before
  [key: string]: any; // Allow additional fields
}

/**
 * Socket.io authentication middleware
 * Validates JWT tokens from Clerk and attaches user data to socket
 */
export function createAuthMiddleware(authService: AuthService) {
  return async (socket: Socket<any, any, any, SocketData>, next: (err?: Error) => void) => {
    try {
      // Extract token and user info from handshake auth or query
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      const userEmail = socket.handshake.auth?.userEmail;

      if (!token || typeof token !== 'string') {
        const error = createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication token is required'
        );
        return next(new Error(JSON.stringify(error)));
      }

      console.log('📧 User email from client:', userEmail);

      // Verify JWT token
      const decoded = await verifyClerkToken(token);

      // If we have user email from client, add it to the decoded payload
      if (userEmail && !decoded.email) {
        decoded.email = userEmail;
        console.log('✅ Added email from client to token payload:', userEmail);
      }

      // Get or create user in our database
      const user = await authService.syncUserFromJWT(decoded);

      if (!user) {
        const error = createSocketError(
          SocketErrorCodes.USER_NOT_FOUND,
          'User not found or inactive'
        );
        return next(new Error(JSON.stringify(error)));
      }

      // Attach user data to socket
      socket.data.userId = user._id?.toString();
      socket.data.user = user;
      socket.data.isAuthenticated = true;
      socket.data.joinedGroups = new Set();
      socket.data.lastActivity = new Date();
      socket.data.deviceType = detectDeviceType(socket.handshake.headers['user-agent']);

      console.log(`✅ Socket authenticated for user: ${user.email} (${user._id})`);
      next();

    } catch (error) {
      console.error('❌ Socket authentication failed:', error);

      let socketError: SocketError;

      if (error instanceof Error) {
        if (error.message.includes('expired') || error.message.includes('exp')) {
          socketError = createSocketError(
            SocketErrorCodes.TOKEN_EXPIRED,
            'Authentication token has expired'
          );
        } else if (error.message.includes('invalid') || error.message.includes('malformed')) {
          socketError = createSocketError(
            SocketErrorCodes.INVALID_TOKEN,
            'Invalid authentication token'
          );
        } else {
          socketError = createSocketError(
            SocketErrorCodes.AUTHENTICATION_FAILED,
            'Authentication failed'
          );
        }
      } else {
        socketError = createSocketError(
          SocketErrorCodes.AUTHENTICATION_FAILED,
          'Authentication failed'
        );
      }

      next(new Error(JSON.stringify(socketError)));
    }
  };
}

/**
 * Verify Clerk JWT token using proper Clerk SDK verification
 */
async function verifyClerkToken(token: string): Promise<ClerkJWTPayload> {
  try {
    console.log('🔍 Verifying Clerk token with proper verification...');

    // Use Clerk's verifyToken function for proper JWT verification
    const payload = await verifyToken(token, {
      secretKey: config.clerk.secretKey,
      issuer: config.clerk.jwtIssuer,
    });

    console.log('📋 Verified token payload:', {
      sub: payload.sub,
      email: payload.email,
      iss: payload.iss,
    });

    return payload as unknown as ClerkJWTPayload;
  } catch (error) {
    console.error('❌ Token verification failed:', error);
    throw error;
  }
}

/**
 * Detect device type from user agent
 */
function detectDeviceType(userAgent?: string): 'mobile' | 'web' | 'desktop' {
  if (!userAgent) {
    return 'web';
  }

  const ua = userAgent.toLowerCase();

  // Check for mobile devices
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
    return 'mobile';
  }

  // Check for desktop applications (Electron, etc.)
  if (ua.includes('electron')) {
    return 'desktop';
  }

  // Default to web
  return 'web';
}

/**
 * Middleware to check if socket is authenticated
 */
export function requireAuth(socket: Socket<any, any, any, SocketData>): boolean {
  return socket.data.isAuthenticated && !!socket.data.userId;
}

/**
 * Get authenticated user from socket
 */
export function getAuthenticatedUser(socket: Socket<any, any, any, SocketData>) {
  if (!requireAuth(socket)) {
    throw new Error('Socket is not authenticated');
  }

  return {
    userId: socket.data.userId!,
    user: socket.data.user!,
  };
}

/**
 * Update socket activity timestamp
 */
export function updateSocketActivity(socket: Socket<any, any, any, SocketData>): void {
  socket.data.lastActivity = new Date();
}

/**
 * Express authentication middleware
 * Validates JWT tokens from Clerk and attaches user data to request
 */
export function authMiddleware(authService?: AuthService) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication token is required',
        });
      }

      // Verify JWT token
      const decoded = await verifyClerkToken(token);

      // If authService is provided, sync user with database
      if (authService) {
        const user = await authService.syncUserFromJWT(decoded);
        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'User not found or inactive',
          });
        }
        req.user = {
          id: user._id?.toString() || '',
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          clerkId: user.clerkId,
        };
      } else {
        // Use token data directly
        req.user = {
          id: decoded.sub,
          email: decoded.email || decoded.email_address || decoded.primary_email_address || '',
          firstName: decoded.given_name || '',
          lastName: decoded.family_name || '',
          clerkId: decoded.sub,
        };
      }

      next();
    } catch (error) {
      console.error('❌ Express authentication failed:', error);

      if (error instanceof Error) {
        if (error.message.includes('expired') || error.message.includes('exp')) {
          return res.status(401).json({
            success: false,
            error: 'Authentication token has expired',
          });
        } else if (error.message.includes('invalid') || error.message.includes('malformed')) {
          return res.status(401).json({
            success: false,
            error: 'Invalid authentication token',
          });
        }
      }

      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
      });
    }
  };
}
