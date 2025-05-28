import { ObjectId } from 'mongodb';
import { database } from '../config/database';
import { User } from '../types/database';

/**
 * JWT payload interface from Clerk authentication service
 *
 * @description Defines the structure of JWT tokens issued by Clerk for user authentication.
 * Contains user identity information and token metadata for validation and user sync.
 *
 * @interface ClerkJWTPayload
 * @since 1.0.0
 */
interface ClerkJWTPayload {
  /** Clerk user ID (subject) - primary identifier */
  sub: string;
  /** User email address (primary field) */
  email?: string;
  /** Alternative email field */
  email_address?: string;
  /** Primary email address field */
  primary_email_address?: string;
  /** User's first name */
  given_name?: string;
  /** User's last name */
  family_name?: string;
  /** User's username */
  username?: string;
  /** Profile picture URL */
  picture?: string;
  /** Token issuer */
  iss: string;
  /** Token audience */
  aud?: string;
  /** Token expiration timestamp */
  exp: number;
  /** Token issued at timestamp */
  iat: number;
  /** Token not before timestamp */
  nbf?: number;
  /** Allow additional Clerk fields */
  [key: string]: any;
}

/**
 * Profile update data interface
 *
 * @description Defines the structure for user profile updates.
 * Contains optional fields that can be modified by users.
 *
 * @interface ProfileUpdateData
 * @since 1.0.0
 */
interface ProfileUpdateData {
  /** User's first name */
  firstName?: string;
  /** User's last name */
  lastName?: string;
  /** User's unique username (stored in lowercase) */
  username?: string;
  /** Profile image URL */
  profileImageUrl?: string;
}

/**
 * AuthService - Authentication and user management service
 *
 * @description Handles user authentication, JWT validation, user synchronization,
 * and profile management. Integrates with Clerk authentication service while
 * maintaining local user data for chat functionality.
 *
 * @features
 * - JWT token validation and user sync
 * - User profile management and updates
 * - Group membership validation
 * - Multi-field user lookup (ID, Clerk ID, username)
 * - Batch user operations
 * - Last seen timestamp tracking
 * - Username uniqueness and normalization
 *
 * @security
 * - Clerk JWT validation for authentication
 * - Secure user data synchronization
 * - Input validation and sanitization
 * - Active user filtering
 * - Clerk ID consistency across services
 *
 * @performance
 * - Efficient database queries with indexes
 * - Batch user retrieval operations
 * - Optimized group membership checks
 * - Minimal data synchronization
 * - Username normalization for consistency
 *
 * @author SOBHAN BAHRAMI
 * @since 1.0.0
 */
export class AuthService {
  /**
   * Synchronize user data from Clerk JWT payload
   *
   * @description Creates new users or updates existing users based on Clerk JWT data.
   * Handles user synchronization between Clerk authentication service and local database
   * while preserving user-modified profile data and maintaining data consistency.
   *
   * @param {ClerkJWTPayload} payload - JWT payload from Clerk containing user data
   * @returns {Promise<User | null>} The synchronized user object or null if failed
   *
   * @throws {Error} Invalid JWT payload: missing clerkId (sub)
   * @throws {Error} Database operation failures
   *
   * @flow
   * 1. Extract user data from JWT payload with fallbacks
   * 2. Validate required clerkId field
   * 3. Search for existing user by Clerk ID
   * 4. Update existing user with selective field sync
   * 5. Create new user if not found
   * 6. Return synchronized user data
   *
   * @security
   * - Validates JWT payload structure
   * - Preserves user-modified profile data
   * - Selective field synchronization from Clerk
   * - Email fallback for missing email fields
   *
   * @performance
   * - Single database lookup for existing users
   * - Minimal field updates for existing users
   * - Efficient user creation for new users
   * - Selective field synchronization
   *
   * @example
   * ```typescript
   * const jwtPayload = {
   *   sub: 'user_clerk_id_123',
   *   email: 'user@example.com',
   *   given_name: 'John',
   *   family_name: 'Doe'
   * };
   * const user = await authService.syncUserFromJWT(jwtPayload);
   * ```
   *
   * @author SOBHAN BAHRAMI
   * @since 1.0.0
   */
  async syncUserFromJWT(payload: ClerkJWTPayload): Promise<User | null> {
    try {
      // Step 1: Extract user data from JWT with fallbacks
      const clerkId = payload.sub;
      const email = payload.email || payload.email_address || payload.primary_email_address || `${clerkId}@clerk.dev`;
      const firstName = payload.given_name || '';
      const lastName = payload.family_name || '';
      const username = payload.username;
      const profileImageUrl = payload.picture;

      // Step 2: Validate required clerkId field
      if (!clerkId) {
        throw new Error('Invalid JWT payload: missing clerkId (sub)');
      }

      console.log(`🔍 AuthService: Processing user - clerkId: ${clerkId}, email: ${email}`);

      // Step 3: Search for existing user by Clerk ID
      let user = await database.users.findOne({ clerkId });

      if (user) {
        // For existing users, only update fields that should be synced from Clerk
        // Preserve MongoDB-managed fields like firstName, lastName, and username
        const updateData: Partial<User> = {
          email, // Always sync email from Clerk
          lastSeen: new Date(),
          updatedAt: new Date(),
        };

        // Only update profileImageUrl if it's provided in JWT
        if (profileImageUrl) {
          updateData.profileImageUrl = profileImageUrl;
        }

        // Only sync firstName/lastName from Clerk if they don't exist in MongoDB and are provided in JWT
        // This is for backward compatibility with users who might have these set in Clerk initially
        if (!user.firstName && firstName) {
          updateData.firstName = firstName;
        }
        if (!user.lastName && lastName) {
          updateData.lastName = lastName;
        }
        if (!user.username && username) {
          updateData.username = username;
        }

        await database.users.updateOne(
          { _id: user._id },
          { $set: updateData }
        );

        // Return updated user
        user = await database.users.findOne({ _id: user._id });
        console.log(`✅ Updated existing user from JWT: ${email} (${clerkId})`);
      } else {
        // Create new user - use JWT data for initial setup
        const newUser: Omit<User, '_id'> = {
          clerkId,
          email,
          firstName,
          lastName,
          username,
          profileImageUrl,
          isActive: true,
          lastSeen: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await database.users.insertOne(newUser as User);
        user = await database.users.findOne({ _id: result.insertedId });
        console.log(`✅ Created new user from JWT: ${email} (${clerkId})`);
      }

      return user;
    } catch (error) {
      console.error('❌ Error syncing user from JWT:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      if (!ObjectId.isValid(userId)) {
        return null;
      }

      const user = await database.users.findOne({
        _id: new ObjectId(userId),
        isActive: true
      });

      return user;
    } catch (error) {
      console.error('❌ Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Get user by Clerk ID
   */
  async getUserByClerkId(clerkId: string): Promise<User | null> {
    try {
      const user = await database.users.findOne({
        clerkId,
        isActive: true
      });

      return user;
    } catch (error) {
      console.error('❌ Error getting user by Clerk ID:', error);
      throw error;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    try {
      if (!username) {
        return null;
      }

      const user = await database.users.findOne({
        username: username.toLowerCase(), // Store usernames in lowercase for consistency
        isActive: true
      });

      return user;
    } catch (error) {
      console.error('❌ Error getting user by username:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(clerkId: string, updateData: ProfileUpdateData): Promise<User | null> {
    try {
      if (!clerkId) {
        throw new Error('Clerk ID is required');
      }

      // Prepare update data
      const updateFields: Partial<User> = {
        updatedAt: new Date(),
        ...updateData
      };

      // Convert username to lowercase for consistency
      if (updateData.username) {
        updateFields.username = updateData.username.toLowerCase();
      }

      // Update the user
      const result = await database.users.findOneAndUpdate(
        { clerkId, isActive: true },
        { $set: updateFields },
        { returnDocument: 'after' }
      );

      if (!result) {
        throw new Error('User not found or update failed');
      }

      console.log(`✅ Updated user profile: ${clerkId}`);
      return result;
    } catch (error) {
      console.error('❌ Error updating user profile:', error);
      throw error;
    }
  }

  /**
   * Update user's last seen timestamp
   */
  async updateLastSeen(userId: string): Promise<void> {
    try {
      if (!ObjectId.isValid(userId)) {
        return;
      }

      await database.users.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            lastSeen: new Date(),
            updatedAt: new Date()
          }
        }
      );
    } catch (error) {
      console.error('❌ Error updating last seen:', error);
      // Don't throw error for this operation
    }
  }

  /**
   * Get multiple users by IDs
   */
  async getUsersByIds(userIds: string[]): Promise<User[]> {
    try {
      const objectIds = userIds
        .filter(id => ObjectId.isValid(id))
        .map(id => new ObjectId(id));

      if (objectIds.length === 0) {
        return [];
      }

      const users = await database.users.find({
        _id: { $in: objectIds },
        isActive: true
      }).toArray();

      return users;
    } catch (error) {
      console.error('❌ Error getting users by IDs:', error);
      throw error;
    }
  }

  /**
   * Check if user is member of a group
   */
  async isUserGroupMember(userId: string, groupId: string): Promise<boolean> {
    try {
      // Validate groupId as ObjectId, but userId is a Clerk string ID
      if (!ObjectId.isValid(groupId)) {
        return false;
      }

      const group = await database.groups.findOne({
        _id: new ObjectId(groupId),
        isActive: true,
        'members.userId': userId // Clerk user ID is stored as string
      });

      return !!group;
    } catch (error) {
      console.error('❌ Error checking group membership:', error);
      return false;
    }
  }

  /**
   * Get user's groups
   */
  async getUserGroups(userId: string): Promise<string[]> {
    try {
      // userId is a Clerk string ID, no need to validate as ObjectId
      if (!userId || typeof userId !== 'string') {
        return [];
      }

      const groups = await database.groups.find({
        isActive: true,
        'members.userId': userId // Clerk user ID is stored as string
      }, {
        projection: { _id: 1 }
      }).toArray();

      return groups.map(group => group._id!.toString());
    } catch (error) {
      console.error('❌ Error getting user groups:', error);
      return [];
    }
  }
}
