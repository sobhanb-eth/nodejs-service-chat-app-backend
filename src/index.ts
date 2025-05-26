import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import { config, validateEnvironment } from './config/environment';
import { database } from './config/database';
import { createSocketServer } from './config/socket';
import { createAuthMiddleware } from './middleware/auth';

// Services
import { AuthService } from './services/AuthService';
import { MessageService } from './services/MessageService';
import { PresenceService } from './services/PresenceService';
import { AIService } from './services/AIService';

// Handlers
import { handleConnection, handleSocketError } from './handlers/connectionHandler';
import { handleMessageEvents } from './handlers/messageHandler';
import { handleGroupEvents } from './handlers/groupHandler';
import { handlePresenceEvents, startTypingCleanup, stopTypingCleanup } from './handlers/presenceHandler';

// Routes
import { createVersionedRoutes } from './routes/index';

/**
 * Node.js Real-Time Service
 * Handles WebSocket connections, real-time messaging, and presence tracking
 */
class RealTimeService {
  private app: express.Application;
  private server: any;
  private io: any;
  private authService: AuthService;
  private messageService: MessageService;
  private presenceService: PresenceService;
  private aiService: AIService;
  private typingCleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing Node.js Real-Time Service...');

      // Validate environment variables
      validateEnvironment();

      // Connect to database
      await database.connect();

      // Initialize services after database connection
      this.authService = new AuthService();

      // Create AI service first (needed by MessageService)
      this.aiService = new AIService(database.getClient());
      this.messageService = new MessageService(this.aiService);

      this.presenceService = new PresenceService();

      // Setup Express middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup Socket.io
      this.setupSocketIO();

      // Start typing cleanup
      this.typingCleanupInterval = startTypingCleanup();

      console.log('✅ Node.js Real-Time Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize service:', error);
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
    }));

    // CORS middleware
    this.app.use(cors({
      origin: config.cors.allowedOrigins,
      credentials: config.cors.credentials,
    }));

    // Compression middleware
    this.app.use(compression());

    // Logging middleware
    if (config.server.isDevelopment) {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined'));
    }

    // JSON parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // API routes with full integration
    this.app.use('/api', createVersionedRoutes(database.getClient()));

    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        console.log('🔍 Health check requested');
        const dbHealth = await database.healthCheck();

        const healthData = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          service: 'nodejs-realtime-service',
          version: '1.0.0',
          database: dbHealth ? 'connected' : 'disconnected',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
        };
        console.log('✅ Health check passed');
        res.json(healthData);
      } catch (error) {
        console.error('❌ Health check failed:', error);
        const errorData = {
          status: 'error',
          message: 'Health check failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          pid: process.pid,
        };
        console.log('❌ Health check error data:', errorData);
        res.status(500).json(errorData);
      }
    });

    // Service info endpoint
    this.app.get('/info', (req, res) => {
      res.json({
        service: 'nodejs-realtime-service',
        version: '1.0.0',
        description: 'Real-time messaging service with Socket.io',
        features: [
          'WebSocket connections',
          'Real-time messaging',
          'Typing indicators',
          'Read receipts',
          'Online presence tracking',
          'Group management',
          'AI-powered smart replies',
          'Real-time AI suggestions',
          'Content moderation',
          'Message encryption (AES-128)',
          'Media sharing (AWS S3)',
        ],
        endpoints: {
          health: '/health',
          info: '/info',
          socket: '/socket.io/',
        },
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested endpoint does not exist',
        path: req.originalUrl,
      });
    });

    // Error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('❌ Express error:', error);

      res.status(error.status || 500).json({
        error: 'Internal Server Error',
        message: config.server.isDevelopment ? error.message : 'Something went wrong',
        ...(config.server.isDevelopment && { stack: error.stack }),
      });
    });
  }

  /**
   * Setup Socket.io server and event handlers
   */
  private setupSocketIO(): void {
    // Create Socket.io server
    this.io = createSocketServer(this.server);

    // Setup authentication middleware
    this.io.use(createAuthMiddleware(this.authService));

    // Handle socket connections
    this.io.on('connection', (socket: any) => {
      // Setup error handling
      socket.on('error', (error: Error) => {
        handleSocketError(socket, error);
      });

      // Handle connection events
      handleConnection(this.io, socket, this.presenceService, this.authService);

      // Handle message events (with AI service integration)
      handleMessageEvents(this.io, socket, this.messageService, this.authService, this.aiService);

      // Handle group events
      handleGroupEvents(this.io, socket, this.authService, this.presenceService);

      // Handle presence events
      handlePresenceEvents(this.io, socket, this.authService, this.presenceService);
    });

    console.log('✅ Socket.io server configured');
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      await this.initialize();

      this.server.listen(config.server.port, '0.0.0.0', () => {
        console.log(`🚀 Node.js Real-Time Service running on port ${config.server.port}`);
        console.log(`📡 Socket.io server ready for connections`);
        console.log(`🌍 Environment: ${config.server.nodeEnv}`);
        console.log(`🔗 CORS origins: ${config.cors.allowedOrigins.join(', ')}`);
        console.log(`🌐 Server listening on all interfaces (0.0.0.0:${config.server.port})`);
      });
    } catch (error) {
      console.error('❌ Failed to start service:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down Node.js Real-Time Service...');

    try {
      // Stop typing cleanup
      if (this.typingCleanupInterval) {
        stopTypingCleanup(this.typingCleanupInterval);
      }

      // Stop presence service cleanup
      this.presenceService.stopCleanupInterval();

      // Close Socket.io server
      if (this.io) {
        this.io.close();
      }

      // Close HTTP server
      if (this.server) {
        this.server.close();
      }

      // Disconnect from database
      await database.disconnect();

      console.log('✅ Service shutdown complete');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }
}

// Create and start the service
const service = new RealTimeService();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  await service.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await service.shutdown();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('❌ Stack trace:', error.stack);
  console.error('❌ Process will exit due to uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('❌ Rejection details:', JSON.stringify(reason, null, 2));
  console.error('❌ Process will exit due to unhandled rejection');
  process.exit(1);
});

// Add more process event listeners for debugging
process.on('SIGTERM', () => {
  console.log('🔔 Received SIGTERM signal');
});

process.on('SIGINT', () => {
  console.log('🔔 Received SIGINT signal');
});

process.on('exit', (code) => {
  console.log(`🔔 Process exiting with code: ${code}`);
});

process.on('beforeExit', (code) => {
  console.log(`🔔 Process about to exit with code: ${code}`);
});

// Start the service
service.start().catch((error) => {
  console.error('❌ Failed to start service:', error);
  process.exit(1);
});
