import { Router } from 'express';
import { MongoClient } from 'mongodb';
import { AIService } from '../services/AIService';
import { GroupService } from '../services/GroupService';
import { validateSchema } from '../middleware/validation';
import { aiSchemas } from '../middleware/validation';
import { aiRateLimitMiddleware } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/api';

/**
 * AI routes
 */
export default function createAIRoutes(db: MongoClient): Router {
  const router = Router();

  // Initialize services
  const aiService = new AIService(db);
  const groupService = new GroupService(db);

  /**
   * Generate smart replies for a message
   * POST /ai/smart-replies
   */
  router.post('/smart-replies',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.smartReply),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { messageContent, groupId } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      const smartReplies = await aiService.generateSmartReplies(messageContent, groupId, userId);

      res.json({
        success: true,
        smartReplies,
      });
    })
  );

  /**
   * Analyze message sentiment
   * POST /ai/sentiment
   */
  router.post('/sentiment',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.sentiment),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { content } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const analysis = await aiService.analyzeMessage(content);
      const sentiment = {
        sentiment: analysis.sentiment,
        confidence: analysis.confidence,
      };

      res.json({
        success: true,
        sentiment,
      });
    })
  );

  /**
   * Search messages using vector similarity
   * POST /ai/search
   */
  router.post('/search',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.search),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { query, groupId, limit = 10 } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      // Use vector search through the vectorStore
      const results = await aiService.generateContextualResponse(query, groupId);

      res.json({
        success: true,
        results,
      });
    })
  );

  /**
   * Generate message summary
   * POST /ai/summarize
   */
  router.post('/summarize',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.summarize),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { groupId, timeRange = '24h' } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      // Generate summary using contextual response
      const summary = await aiService.generateContextualResponse(
        `Summarize the conversation from the last ${timeRange}`,
        groupId
      );

      res.json({
        success: true,
        summary,
      });
    })
  );

  /**
   * Get conversation insights
   * GET /ai/insights/:groupId
   */
  router.get('/insights/:groupId',
    aiRateLimitMiddleware,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { groupId } = req.params;
      const { timeRange = '7d' } = req.query as any;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      // Generate insights using analysis
      const insights = await aiService.generateContextualResponse(
        `Analyze conversation patterns and provide insights for the last ${timeRange}`,
        groupId
      );

      res.json({
        success: true,
        insights: {
          summary: insights,
          timeRange,
          generatedAt: new Date(),
        },
      });
    })
  );

  /**
   * Generate topic suggestions
   * POST /ai/topics
   */
  router.post('/topics',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.topics),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { groupId, count = 5 } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Check if user is member of group
      const isMember = await groupService.isUserMember(groupId, userId);
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        });
      }

      // Generate topic suggestions using contextual response
      const topicsResponse = await aiService.generateContextualResponse(
        `Generate ${count} relevant topic suggestions for this conversation`,
        groupId
      );

      res.json({
        success: true,
        topics: [topicsResponse], // Simplified response
      });
    })
  );

  /**
   * Translate message
   * POST /ai/translate
   */
  router.post('/translate',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.translate),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { content, targetLanguage, sourceLanguage } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Use contextual response for translation
      const translationPrompt = `Translate the following text to ${targetLanguage}: "${content}"`;
      const translation = await aiService.generateContextualResponse(translationPrompt, 'translation');

      res.json({
        success: true,
        translation: {
          originalText: content,
          translatedText: translation,
          targetLanguage,
          sourceLanguage: sourceLanguage || 'auto-detected',
        },
      });
    })
  );

  /**
   * Detect language of message
   * POST /ai/detect-language
   */
  router.post('/detect-language',
    aiRateLimitMiddleware,
    validateSchema(aiSchemas.detectLanguage),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { content } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Use contextual response for language detection
      const detectionPrompt = `Detect the language of this text and respond with just the language code: "${content}"`;
      const detectedLanguage = await aiService.generateContextualResponse(detectionPrompt, 'detection');

      res.json({
        success: true,
        language: {
          code: detectedLanguage.trim().toLowerCase(),
          confidence: 0.8, // Placeholder confidence
          text: content,
        },
      });
    })
  );

  return router;
}
