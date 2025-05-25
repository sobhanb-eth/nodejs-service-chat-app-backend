import { MongoClient, Collection, ObjectId } from 'mongodb';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { Document } from '@langchain/core/documents';
import { RunnableSequence } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Message } from '../types/database';

interface SmartReplyContext {
  recentMessages: Message[];
  similarMessages: Document[];
  groupContext: string;
  userPreferences?: any;
}

interface SmartReplyResponse {
  suggestions: string[];
  confidence: number;
  context: string;
}

/**
 * AI Service with BAML, LangChain, and LangGraph integration
 */
export class AIService {
  private db: MongoClient;
  private messages: Collection<Message>;
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;
  private vectorStore: MongoDBAtlasVectorSearch;
  private smartReplyChain: RunnableSequence;

  constructor(db: MongoClient) {
    this.db = db;
    this.messages = db.db('RealTimeChatAiApp').collection<Message>('messages');

    // Initialize OpenAI models
    this.llm = new ChatOpenAI({
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize MongoDB Atlas Vector Search
    this.vectorStore = new MongoDBAtlasVectorSearch(this.embeddings, {
      collection: this.messages as any, // Type assertion for compatibility
      indexName: 'message_vector_index',
      textKey: 'content',
      embeddingKey: 'embedding',
    });

    // Initialize smart reply chain
    this.initializeSmartReplyChain();
  }

  /**
   * Initialize the smart reply chain with BAML-style structured prompts
   */
  private initializeSmartReplyChain(): void {
    const smartReplyPrompt = PromptTemplate.fromTemplate(`
You are an AI assistant helping users generate smart replies for group chat messages.

Context:
- Group: {groupContext}
- Recent conversation: {recentMessages}
- Similar past messages: {similarContext}

Current message to reply to: {currentMessage}

Generate 3 contextually appropriate, helpful, and natural reply suggestions.
Each reply should be:
1. Relevant to the conversation context
2. Appropriate for the group setting
3. Natural and conversational
4. Different in tone/approach from the others

Format your response as a JSON array of strings:
["reply1", "reply2", "reply3"]

Reply suggestions:
`);

    this.smartReplyChain = RunnableSequence.from([
      smartReplyPrompt,
      this.llm,
      new StringOutputParser(),
    ]);
  }

  /**
   * Generate smart reply suggestions for a message
   */
  async generateSmartReplies(
    messageContent: string,
    groupId: string,
    userId: string
  ): Promise<SmartReplyResponse> {
    try {
      // Get recent messages for context
      const recentMessages = await this.getRecentMessages(groupId, 10);

      // Get similar messages using vector search
      const similarMessages = await this.vectorStore.similaritySearch(
        messageContent,
        3,
        { groupId }
      );

      // Build context
      const context: SmartReplyContext = {
        recentMessages,
        similarMessages,
        groupContext: `Group ${groupId}`,
      };

      // Generate replies using the chain
      const response = await this.smartReplyChain.invoke({
        groupContext: context.groupContext,
        recentMessages: this.formatRecentMessages(recentMessages),
        similarContext: this.formatSimilarMessages(similarMessages),
        currentMessage: messageContent,
      });

      // Parse the response
      const suggestions = this.parseSmartReplyResponse(response);

      return {
        suggestions,
        confidence: this.calculateConfidence(context),
        context: context.groupContext,
      };

    } catch (error) {
      console.error('Error generating smart replies:', error);
      return {
        suggestions: ['Thanks!', 'Got it!', 'Sounds good!'],
        confidence: 0.1,
        context: 'fallback',
      };
    }
  }

  /**
   * Store message with vector embedding
   */
  async storeMessageWithEmbedding(message: Message): Promise<void> {
    try {
      // Generate embedding for the message content
      const embedding = await this.embeddings.embedQuery(message.content);

      // Store message with embedding
      await this.messages.updateOne(
        { _id: message._id },
        {
          $set: {
            embedding,
            updatedAt: new Date()
          }
        }
      );

    } catch (error) {
      console.error('Error storing message embedding:', error);
    }
  }

  /**
   * Analyze message sentiment and content
   */
  async analyzeMessage(content: string): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral';
    topics: string[];
    confidence: number;
  }> {
    try {
      const analysisPrompt = PromptTemplate.fromTemplate(`
Analyze the following message for sentiment and topics:

Message: {message}

Provide analysis in JSON format:
{{
  "sentiment": "positive|negative|neutral",
  "topics": ["topic1", "topic2"],
  "confidence": 0.0-1.0
}}

Analysis:
`);

      const analysisChain = RunnableSequence.from([
        analysisPrompt,
        this.llm,
        new StringOutputParser(),
      ]);

      const response = await analysisChain.invoke({ message: content });
      return JSON.parse(response);

    } catch (error) {
      console.error('Error analyzing message:', error);
      return {
        sentiment: 'neutral',
        topics: [],
        confidence: 0.1,
      };
    }
  }

  /**
   * Generate contextual responses using RAG
   */
  async generateContextualResponse(
    query: string,
    groupId: string,
    maxTokens: number = 150
  ): Promise<string> {
    try {
      // Retrieve relevant context using vector search
      const relevantDocs = await this.vectorStore.similaritySearch(
        query,
        5,
        { groupId }
      );

      const contextualPrompt = PromptTemplate.fromTemplate(`
Based on the conversation history and context, provide a helpful response.

Context from previous messages:
{context}

Current query: {query}

Provide a natural, helpful response that takes into account the conversation context:
`);

      const contextualChain = RunnableSequence.from([
        contextualPrompt,
        this.llm,
        new StringOutputParser(),
      ]);

      const context = relevantDocs
        .map(doc => doc.pageContent)
        .join('\n');

      return await contextualChain.invoke({
        context,
        query,
      });

    } catch (error) {
      console.error('Error generating contextual response:', error);
      return 'I apologize, but I cannot provide a response at the moment.';
    }
  }

  /**
   * Moderate message content
   */
  async moderateContent(content: string): Promise<{
    isAppropriate: boolean;
    reason?: string;
    confidence: number;
  }> {
    try {
      const moderationPrompt = PromptTemplate.fromTemplate(`
Analyze the following message for inappropriate content including:
- Hate speech
- Harassment
- Spam
- Explicit content
- Threats

Message: {message}

Respond in JSON format:
{{
  "isAppropriate": true|false,
  "reason": "explanation if inappropriate",
  "confidence": 0.0-1.0
}}

Analysis:
`);

      const moderationChain = RunnableSequence.from([
        moderationPrompt,
        this.llm,
        new StringOutputParser(),
      ]);

      const response = await moderationChain.invoke({ message: content });
      return JSON.parse(response);

    } catch (error) {
      console.error('Error moderating content:', error);
      return {
        isAppropriate: true,
        confidence: 0.1,
      };
    }
  }

  /**
   * Get recent messages for context
   */
  private async getRecentMessages(groupId: string, limit: number): Promise<Message[]> {
    return await this.messages
      .find({ groupId: new ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Format recent messages for prompt
   */
  private formatRecentMessages(messages: Message[]): string {
    return messages
      .reverse()
      .map(msg => `${msg.senderId}: ${msg.content}`)
      .join('\n');
  }

  /**
   * Format similar messages for prompt
   */
  private formatSimilarMessages(documents: Document[]): string {
    return documents
      .map(doc => doc.pageContent)
      .join('\n');
  }

  /**
   * Parse smart reply response from LLM
   */
  private parseSmartReplyResponse(response: string): string[] {
    try {
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 3); // Ensure max 3 suggestions
      }
    } catch (error) {
      console.error('Error parsing smart reply response:', error);
    }

    // Fallback suggestions
    return ['Thanks!', 'Got it!', 'Sounds good!'];
  }

  /**
   * Calculate confidence based on context quality
   */
  private calculateConfidence(context: SmartReplyContext): number {
    let confidence = 0.5; // Base confidence

    if (context.recentMessages.length > 5) confidence += 0.2;
    if (context.similarMessages.length > 2) confidence += 0.2;
    if (context.groupContext) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Initialize vector search index (run once during setup)
   */
  async initializeVectorIndex(): Promise<void> {
    try {
      // This would typically be done via MongoDB Atlas UI or CLI
      console.log('Vector search index should be created in MongoDB Atlas');
      console.log('Index name: message_vector_index');
      console.log('Vector field: embedding');
      console.log('Dimensions: 1536 (OpenAI embeddings)');
    } catch (error) {
      console.error('Error initializing vector index:', error);
    }
  }
}
