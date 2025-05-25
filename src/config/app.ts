import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

/**
 * Environment variable validation schema
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().transform(Number).default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database Configuration
  MONGODB_URI: z.string().min(1, 'MongoDB URI is required'),
  DATABASE_NAME: z.string().default('RealTimeChatAiApp'),
  DATABASE_PASSWORD: z.string().min(1, 'Database password is required'),

  // AWS S3 Configuration
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS Access Key ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS Secret Access Key is required'),
  AWS_DEFAULT_REGION: z.string().default('us-east-1'),
  S3_BUCKET_NAME: z.string().min(1, 'S3 Bucket name is required'),

  // Clerk Configuration
  CLERK_SECRET_KEY: z.string().min(1, 'Clerk secret key is required'),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_JWT_ISSUER: z.string().url('Invalid Clerk JWT issuer URL'),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // OpenAI Configuration
  OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),

  // Encryption Configuration
  ENCRYPTION_SECRET_KEY: z.string().min(16, 'Encryption key must be at least 16 characters'),

  // CORS Configuration
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:19006'),

  // Socket.io Configuration
  SOCKET_IO_CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:19006'),
  SOCKET_IO_PING_TIMEOUT: z.string().transform(Number).default('60000'),
  SOCKET_IO_PING_INTERVAL: z.string().transform(Number).default('25000'),

  // File Upload Configuration
  MAX_FILE_SIZE: z.string().transform(Number).default('10485760'), // 10MB
  ALLOWED_FILE_TYPES: z.string().default('image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf,text/plain'),

  // AI Configuration
  AI_MODEL: z.string().default('gpt-3.5-turbo'),
  AI_TEMPERATURE: z.string().transform(Number).default('0.7'),
  AI_MAX_TOKENS: z.string().transform(Number).default('150'),
  VECTOR_INDEX_NAME: z.string().default('message_vector_index'),

  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Rate Limiting Configuration
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // Session Configuration
  SESSION_CLEANUP_INTERVAL: z.string().transform(Number).default('300000'), // 5 minutes
  SESSION_TIMEOUT: z.string().transform(Number).default('1800000'), // 30 minutes
});

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err: any) => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Environment validation failed:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
}

/**
 * Application configuration
 */
export const config = validateEnv();

/**
 * Derived configuration objects
 */
export const serverConfig = {
  port: config.PORT,
  env: config.NODE_ENV,
  isDevelopment: config.NODE_ENV === 'development',
  isProduction: config.NODE_ENV === 'production',
  isTest: config.NODE_ENV === 'test',
};

export const databaseConfig = {
  uri: config.MONGODB_URI.replace('<db_password>', config.DATABASE_PASSWORD),
  name: config.DATABASE_NAME,
  options: {
    retryWrites: true,
    w: 'majority' as const,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  },
};

export const awsConfig = {
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  region: config.AWS_DEFAULT_REGION,
  s3: {
    bucketName: config.S3_BUCKET_NAME,
    signedUrlExpiry: 3600, // 1 hour
  },
};

export const clerkConfig = {
  secretKey: config.CLERK_SECRET_KEY,
  publishableKey: config.CLERK_PUBLISHABLE_KEY,
  jwtIssuer: config.CLERK_JWT_ISSUER,
  webhookSecret: config.CLERK_WEBHOOK_SECRET,
};

export const openaiConfig = {
  apiKey: config.OPENAI_API_KEY,
  model: config.AI_MODEL,
  temperature: config.AI_TEMPERATURE,
  maxTokens: config.AI_MAX_TOKENS,
};

export const encryptionConfig = {
  secretKey: config.ENCRYPTION_SECRET_KEY,
  algorithm: 'aes-128-cbc' as const,
};

export const corsConfig = {
  origins: config.ALLOWED_ORIGINS.split(',').map((origin: string) => origin.trim()),
  credentials: true,
  optionsSuccessStatus: 200,
};

export const socketConfig = {
  cors: {
    origin: config.SOCKET_IO_CORS_ORIGINS.split(',').map((origin: string) => origin.trim()),
    credentials: true,
  },
  pingTimeout: config.SOCKET_IO_PING_TIMEOUT,
  pingInterval: config.SOCKET_IO_PING_INTERVAL,
  transports: ['websocket', 'polling'] as const,
};

export const fileUploadConfig = {
  maxFileSize: config.MAX_FILE_SIZE,
  allowedTypes: config.ALLOWED_FILE_TYPES.split(',').map((type: string) => type.trim()),
  uploadPath: 'uploads/',
  thumbnailPath: 'thumbnails/',
};

export const aiConfig = {
  vectorIndexName: config.VECTOR_INDEX_NAME,
  embeddingDimensions: 1536, // OpenAI embeddings
  maxContextLength: 4000,
  smartReplyCount: 3,
};

export const rateLimitConfig = {
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
};

export const sessionConfig = {
  cleanupInterval: config.SESSION_CLEANUP_INTERVAL,
  timeout: config.SESSION_TIMEOUT,
};

export const logConfig = {
  level: config.LOG_LEVEL,
  format: serverConfig.isDevelopment ? 'dev' : 'combined',
  colorize: serverConfig.isDevelopment,
};

/**
 * Validate critical configuration on startup
 */
export function validateCriticalConfig(): void {
  const criticalChecks = [
    { name: 'Database URI', value: databaseConfig.uri, check: (v: string) => v.includes('mongodb') },
    { name: 'AWS Access Key', value: awsConfig.accessKeyId, check: (v: string) => v.startsWith('AKIA') },
    { name: 'S3 Bucket', value: awsConfig.s3.bucketName, check: (v: string) => v.length > 0 },
    { name: 'Clerk Secret', value: clerkConfig.secretKey, check: (v: string) => v.startsWith('sk_') },
    { name: 'OpenAI Key', value: openaiConfig.apiKey, check: (v: string) => v.startsWith('sk-') },
    { name: 'Encryption Key', value: encryptionConfig.secretKey, check: (v: string) => v.length >= 16 },
  ];

  const failures = criticalChecks.filter(check => !check.check(check.value));

  if (failures.length > 0) {
    const failureMessages = failures.map(f => `- ${f.name}: Invalid or missing`);
    throw new Error(`Critical configuration validation failed:\n${failureMessages.join('\n')}`);
  }

  console.log('✅ All critical configuration validated successfully');
}
