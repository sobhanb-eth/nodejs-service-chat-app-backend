import { MongoClient, Db, Collection } from 'mongodb';
import { config, getMongoConnectionString } from './environment';

// Import local types
import { User, Group, Message, Session, Collections } from '../types/database';

/**
 * Database service for MongoDB operations
 */
export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private client: MongoClient | null = null;
  private database: Db | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /**
   * Connect to MongoDB
   */
  public async connect(): Promise<void> {
    try {
      const connectionString = getMongoConnectionString();

      // In development, skip connection if credentials are missing
      if (config.server.isDevelopment && (!config.database.password || config.database.password === 'your_mongodb_password_here')) {
        console.log('⚠️ Skipping MongoDB connection in development mode - missing credentials');
        return;
      }

      this.client = new MongoClient(connectionString, config.database.options);
      await this.client.connect();

      this.database = this.client.db(config.database.name);

      console.log(`✅ Connected to MongoDB database: ${config.database.name}`);

      // Create indexes for optimal performance
      await this.createIndexes();

    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      if (config.server.isDevelopment) {
        console.log('⚠️ Continuing in development mode without database connection');
        return;
      }
      throw error;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.database = null;
      console.log('✅ Disconnected from MongoDB');
    }
  }

  /**
   * Get database instance
   */
  public getDatabase(): Db {
    if (!this.database) {
      if (config.server.isDevelopment) {
        console.log('⚠️ Database not connected - returning mock database in development mode');
        // Return a mock database object for development
        return {} as Db;
      }
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.database;
  }

  /**
   * Get MongoDB client instance
   */
  public getClient(): MongoClient {
    if (!this.client) {
      if (config.server.isDevelopment) {
        console.log('⚠️ Database client not connected - returning mock client in development mode');
        // Return a mock client object for development
        return {} as MongoClient;
      }
      throw new Error('Database client not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Get collection accessors
   */
  public get users(): Collection<User> {
    return this.getDatabase().collection<User>(Collections.USERS);
  }

  public get groups(): Collection<Group> {
    return this.getDatabase().collection<Group>(Collections.GROUPS);
  }

  public get messages(): Collection<Message> {
    return this.getDatabase().collection<Message>(Collections.MESSAGES);
  }

  public get sessions(): Collection<Session> {
    return this.getDatabase().collection<Session>(Collections.SESSIONS);
  }

  /**
   * Create database indexes for optimal performance
   */
  private async createIndexes(): Promise<void> {
    try {
      // Messages collection indexes
      await this.messages.createIndexes([
        { key: { groupId: 1, createdAt: -1 }, name: 'groupId_createdAt_index' },
        { key: { senderId: 1 }, name: 'senderId_index' },
        { key: { createdAt: -1 }, name: 'createdAt_index' },
        { key: { isDeleted: 1 }, name: 'isDeleted_index' },
        { key: { 'readBy.userId': 1 }, name: 'readBy_userId_index' },
      ]);

      // Sessions collection indexes
      await this.sessions.createIndexes([
        { key: { userId: 1 }, name: 'userId_index' },
        { key: { socketId: 1 }, name: 'socketId_index', unique: true },
        { key: { status: 1 }, name: 'status_index' },
        { key: { lastActivity: 1 }, name: 'lastActivity_index' },
        {
          key: { createdAt: 1 },
          name: 'sessions_ttl_index',
          expireAfterSeconds: config.session.timeout / 1000 // Convert to seconds
        },
      ]);

      // Additional indexes for existing collections (if not already created)
      await this.users.createIndexes([
        { key: { clerkId: 1 }, name: 'clerkId_index', unique: true },
        { key: { email: 1 }, name: 'email_index', unique: true },
        { key: { isActive: 1 }, name: 'isActive_index' },
        { key: { lastSeen: -1 }, name: 'lastSeen_index' },
      ]);

      await this.groups.createIndexes([
        { key: { ownerId: 1 }, name: 'ownerId_index' },
        { key: { 'members.userId': 1 }, name: 'members_userId_index' },
        { key: { isActive: 1 }, name: 'isActive_index' },
        { key: { createdAt: -1 }, name: 'createdAt_index' },
      ]);

      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('❌ Failed to create database indexes:', error);
      throw error;
    }
  }

  /**
   * Health check for database connection
   */
  public async healthCheck(): Promise<boolean> {
    try {
      if (!this.database) {
        return false;
      }

      await this.database.admin().ping();
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const database = DatabaseConnection.getInstance();
