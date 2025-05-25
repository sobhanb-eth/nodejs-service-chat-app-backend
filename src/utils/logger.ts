import { createLogger, format, transports, Logger } from 'winston';
import { logConfig, serverConfig } from '../config/app';

/**
 * Custom log levels
 */
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

/**
 * Custom log colors
 */
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

/**
 * Create custom format for development
 */
const developmentFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  format.colorize({ all: true }),
  format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

/**
 * Create custom format for production
 */
const productionFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

/**
 * Create transports array
 */
const createTransports = () => {
  const transportArray: any[] = [
    // Console transport
    new transports.Console({
      level: logConfig.level,
      format: serverConfig.isDevelopment ? developmentFormat : productionFormat,
    }),
  ];

  // Add file transports for production
  if (serverConfig.isProduction) {
    transportArray.push(
      // Error log file
      new transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: productionFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      // Combined log file
      new transports.File({
        filename: 'logs/combined.log',
        format: productionFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );
  }

  return transportArray;
};

/**
 * Create Winston logger instance
 */
const logger: Logger = createLogger({
  level: logConfig.level,
  levels: logLevels,
  format: serverConfig.isDevelopment ? developmentFormat : productionFormat,
  transports: createTransports(),
  exitOnError: false,
});

/**
 * Add colors to Winston
 */
if (serverConfig.isDevelopment) {
  require('winston').addColors(logColors);
}

/**
 * Enhanced logger with additional methods
 */
class AppLogger {
  private logger: Logger;

  constructor(winstonLogger: Logger) {
    this.logger = winstonLogger;
  }

  /**
   * Log error with context
   */
  error(message: string, error?: Error | any, context?: any): void {
    const logData: any = { message };

    if (error) {
      if (error instanceof Error) {
        logData.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      } else {
        logData.error = error;
      }
    }

    if (context) {
      logData.context = context;
    }

    this.logger.error(logData);
  }

  /**
   * Log warning with context
   */
  warn(message: string, context?: any): void {
    this.logger.warn({ message, context });
  }

  /**
   * Log info with context
   */
  info(message: string, context?: any): void {
    this.logger.info({ message, context });
  }

  /**
   * Log HTTP requests
   */
  http(message: string, context?: any): void {
    this.logger.http({ message, context });
  }

  /**
   * Log debug information
   */
  debug(message: string, context?: any): void {
    this.logger.debug({ message, context });
  }

  /**
   * Log database operations
   */
  database(operation: string, collection: string, duration?: number, context?: any): void {
    this.info(`Database ${operation}`, {
      collection,
      duration: duration ? `${duration}ms` : undefined,
      ...context,
    });
  }

  /**
   * Log API requests
   */
  apiRequest(method: string, path: string, statusCode: number, duration: number, userId?: string): void {
    this.http(`${method} ${path} ${statusCode}`, {
      method,
      path,
      statusCode,
      duration: `${duration}ms`,
      userId,
    });
  }

  /**
   * Log authentication events
   */
  auth(event: string, userId?: string, context?: any): void {
    this.info(`Auth: ${event}`, {
      userId,
      ...context,
    });
  }

  /**
   * Log Socket.io events
   */
  socket(event: string, socketId: string, userId?: string, context?: any): void {
    this.info(`Socket: ${event}`, {
      socketId,
      userId,
      ...context,
    });
  }

  /**
   * Log AI operations
   */
  ai(operation: string, duration?: number, context?: any): void {
    this.info(`AI: ${operation}`, {
      duration: duration ? `${duration}ms` : undefined,
      ...context,
    });
  }

  /**
   * Log file operations
   */
  file(operation: string, filename: string, size?: number, context?: any): void {
    this.info(`File: ${operation}`, {
      filename,
      size: size ? `${size} bytes` : undefined,
      ...context,
    });
  }

  /**
   * Log security events
   */
  security(event: string, severity: 'low' | 'medium' | 'high' | 'critical', context?: any): void {
    const logMethod = severity === 'critical' || severity === 'high' ? 'error' : 'warn';
    this[logMethod](`Security: ${event}`, {
      severity,
      ...context,
    });
  }

  /**
   * Log performance metrics
   */
  performance(metric: string, value: number, unit: string = 'ms', context?: any): void {
    this.info(`Performance: ${metric}`, {
      value,
      unit,
      ...context,
    });
  }

  /**
   * Log business events
   */
  business(event: string, context?: any): void {
    this.info(`Business: ${event}`, context);
  }

  /**
   * Create child logger with default context
   */
  child(defaultContext: any): AppLogger {
    const childLogger = this.logger.child(defaultContext);
    return new AppLogger(childLogger);
  }

  /**
   * Get the underlying Winston logger
   */
  getWinstonLogger(): Logger {
    return this.logger;
  }
}

/**
 * Export the enhanced logger instance
 */
export const appLogger = new AppLogger(logger);

/**
 * Export the Winston logger for compatibility
 */
export { logger };

/**
 * Create request logger middleware
 */
export function createRequestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      appLogger.apiRequest(
        req.method,
        req.originalUrl,
        res.statusCode,
        duration,
        req.user?.id
      );
    });

    next();
  };
}

/**
 * Log unhandled errors
 */
export function setupErrorLogging(): void {
  process.on('uncaughtException', (error: Error) => {
    appLogger.error('Uncaught Exception', error, { fatal: true });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    appLogger.error('Unhandled Rejection', reason, { promise: promise.toString() });
  });
}

/**
 * Log application startup
 */
export function logStartup(port: number): void {
  appLogger.info('🚀 Server starting up', {
    port,
    environment: serverConfig.env,
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  });
}

/**
 * Log application shutdown
 */
export function logShutdown(signal: string): void {
  appLogger.info('🛑 Server shutting down', {
    signal,
    uptime: process.uptime(),
  });
}
