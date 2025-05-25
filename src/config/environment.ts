import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Environment configuration for the Node.js real-time service
 */
export const config = {
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
  },

  // Database Configuration
  database: {
    uri: process.env.MONGODB_URI || '',
    name: process.env.DATABASE_NAME || 'realtime_chat_ai_app',
    password: process.env.DATABASE_PASSWORD || '',
    options: {
      retryWrites: true,
      w: 'majority' as const,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  // Clerk Authentication
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY || '',
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '',
    jwtIssuer: process.env.CLERK_JWT_ISSUER || 'https://clerk.dev',
  },

  // CORS Configuration
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:19006,http://192.168.10.12:8081,http://192.168.10.10:8081,http://10.0.2.2:3001,http://127.0.0.1:8081,exp://192.168.10.12:8081,exp://192.168.10.10:8081,exp://localhost:8081')
      .split(',')
      .map(origin => origin.trim()),
    credentials: true,
  },

  // Socket.io Configuration
  socketio: {
    corsOrigins: (process.env.SOCKET_IO_CORS_ORIGINS || 'http://localhost:3000,http://localhost:19006,http://192.168.10.12:8081,http://192.168.10.10:8081,http://10.0.2.2:3001,http://127.0.0.1:8081,exp://192.168.10.12:8081,exp://192.168.10.10:8081,exp://localhost:8081')
      .split(',')
      .map(origin => origin.trim()),
    pingTimeout: parseInt(process.env.SOCKET_IO_PING_TIMEOUT || '60000', 10),
    pingInterval: parseInt(process.env.SOCKET_IO_PING_INTERVAL || '25000', 10),
    maxHttpBufferSize: 1e6, // 1MB
    allowEIO3: true,
  },

  // Integration URLs
  services: {
    dotnetService: process.env.DOTNET_SERVICE_URL || 'http://localhost:5000',
    pythonAiService: process.env.PYTHON_AI_SERVICE_URL || 'http://localhost:8000',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // Session Configuration
  session: {
    cleanupInterval: parseInt(process.env.SESSION_CLEANUP_INTERVAL || '300000', 10), // 5 minutes
    timeout: parseInt(process.env.SESSION_TIMEOUT || '1800000', 10), // 30 minutes
  },
} as const;

/**
 * Validate required environment variables
 */
export function validateEnvironment(): void {
  // In development, we'll be more lenient with validation
  if (config.server.isDevelopment) {
    console.log('⚠️ Running in development mode - some environment variables may be missing');

    // Check for critical database credentials
    if (!config.database.password || config.database.password === 'your_mongodb_password_here') {
      throw new Error('DATABASE_PASSWORD is required for MongoDB connection');
    }

    return;
  }

  const required = [
    'MONGODB_URI',
    'DATABASE_PASSWORD',
    'CLERK_SECRET_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Replace password placeholder in MongoDB URI
  if (config.database.uri.includes('<db_password>')) {
    if (!config.database.password) {
      throw new Error('DATABASE_PASSWORD is required when MONGODB_URI contains <db_password> placeholder');
    }
  }
}

/**
 * Get MongoDB connection string with password replaced
 */
export function getMongoConnectionString(): string {
  let connectionString = config.database.uri;

  if (connectionString.includes('<db_password>')) {
    connectionString = connectionString.replace('<db_password>', config.database.password);
  }

  return connectionString;
}
