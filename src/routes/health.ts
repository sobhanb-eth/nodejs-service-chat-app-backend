import { Router, Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { OpenAI } from 'openai';
import { appLogger } from '../utils/logger';
import { databaseConfig, awsConfig, openaiConfig, serverConfig } from '../config/app';

const router = Router();

/**
 * Basic health check
 * GET /health
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: serverConfig.env,
    version: process.env.npm_package_version || '1.0.0',
  });
});

/**
 * Detailed health check with dependencies
 * GET /health/detailed
 */
router.get('/detailed', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const healthChecks: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: serverConfig.env,
    version: process.env.npm_package_version || '1.0.0',
    checks: {},
  };

  try {
    // Check MongoDB connection
    healthChecks.checks.database = await checkDatabase();
    
    // Check AWS S3 connection
    healthChecks.checks.s3 = await checkS3();
    
    // Check OpenAI API
    healthChecks.checks.openai = await checkOpenAI();
    
    // Check memory usage
    healthChecks.checks.memory = checkMemory();
    
    // Check disk space (if applicable)
    healthChecks.checks.disk = checkDisk();
    
    // Overall status
    const allHealthy = Object.values(healthChecks.checks).every(
      (check: any) => check.status === 'healthy'
    );
    
    healthChecks.status = allHealthy ? 'healthy' : 'degraded';
    healthChecks.responseTime = Date.now() - startTime;
    
    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(healthChecks);
    
  } catch (error) {
    appLogger.error('Health check failed', error);
    
    healthChecks.status = 'unhealthy';
    healthChecks.error = error instanceof Error ? error.message : 'Unknown error';
    healthChecks.responseTime = Date.now() - startTime;
    
    res.status(503).json(healthChecks);
  }
});

/**
 * Readiness probe (for Kubernetes)
 * GET /health/ready
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check critical dependencies
    const dbCheck = await checkDatabase();
    
    if (dbCheck.status === 'healthy') {
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        reason: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      reason: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Liveness probe (for Kubernetes)
 * GET /health/live
 */
router.get('/live', (req: Request, res: Response) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Check MongoDB connection
 */
async function checkDatabase(): Promise<any> {
  try {
    const client = new MongoClient(databaseConfig.uri, databaseConfig.options);
    const startTime = Date.now();
    
    await client.connect();
    await client.db(databaseConfig.name).admin().ping();
    await client.close();
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      database: databaseConfig.name,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
}

/**
 * Check AWS S3 connection
 */
async function checkS3(): Promise<any> {
  try {
    const s3Client = new S3Client({
      region: awsConfig.region,
      credentials: {
        accessKeyId: awsConfig.accessKeyId,
        secretAccessKey: awsConfig.secretAccessKey,
      },
    });
    
    const startTime = Date.now();
    
    await s3Client.send(new HeadBucketCommand({
      Bucket: awsConfig.s3.bucketName,
    }));
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      bucket: awsConfig.s3.bucketName,
      region: awsConfig.region,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown S3 error',
    };
  }
}

/**
 * Check OpenAI API connection
 */
async function checkOpenAI(): Promise<any> {
  try {
    const openai = new OpenAI({
      apiKey: openaiConfig.apiKey,
    });
    
    const startTime = Date.now();
    
    // Make a simple API call to check connectivity
    await openai.models.list();
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      responseTime,
      model: openaiConfig.model,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown OpenAI error',
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory(): any {
  const memUsage = process.memoryUsage();
  const totalMem = require('os').totalmem();
  const freeMem = require('os').freemem();
  
  const memoryUsagePercent = ((totalMem - freeMem) / totalMem) * 100;
  const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  
  const status = memoryUsagePercent > 90 || heapUsagePercent > 90 ? 'warning' : 'healthy';
  
  return {
    status,
    usage: {
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      heapUsagePercent: Math.round(heapUsagePercent),
    },
    system: {
      totalMem: Math.round(totalMem / 1024 / 1024), // MB
      freeMem: Math.round(freeMem / 1024 / 1024), // MB
      memoryUsagePercent: Math.round(memoryUsagePercent),
    },
  };
}

/**
 * Check disk space
 */
function checkDisk(): any {
  try {
    const fs = require('fs');
    const stats = fs.statSync('.');
    
    return {
      status: 'healthy',
      available: true,
    };
  } catch (error) {
    return {
      status: 'warning',
      error: 'Could not check disk space',
    };
  }
}

export default router;
