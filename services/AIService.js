// services/AIService.js - New separate file for AI operations
const { Groq } = require('groq-sdk');
const OpenAI = require('openai');
const Logger = require('../middleware/Logger');

// Initialize clients
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.CHAT_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.URL_ORIGIN,
    'X-Title': process.env.URL_ORIGIN,
  },
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Rate limit tracking
let rateLimitReached = false;
let rateLimitResetTime = null;

class AIService {
  // Helper method to check if we should use fallback
  static shouldUseFallback() {
    if (!rateLimitReached) return false;
    
    // Check if rate limit has reset
    if (rateLimitResetTime && Date.now() > rateLimitResetTime) {
      rateLimitReached = false;
      rateLimitResetTime = null;
      return false;
    }
    
    return true;
  }

  // Helper method to handle rate limit errors
  static handleRateLimit(error) {
    if (error.status === 429) {
      rateLimitReached = true;
      // Extract reset time from headers if available
      if (error.headers && error.headers['x-ratelimit-reset']) {
        rateLimitResetTime = parseInt(error.headers['x-ratelimit-reset']);
      } else {
        // Default to 1 hour if no reset time provided
        rateLimitResetTime = Date.now() + (60 * 60 * 1000);
      }
      Logger.warn(`Rate limit reached. Switching to Groq fallback until ${new Date(rateLimitResetTime)}`);
    }
  }

  // Generic method to make AI requests with fallback
  static async makeAIRequest(systemPrompt, userPrompt, options = {}) {
    const {
      maxTokens = 50,
      temperature = 0.1,
      fallbackModel = 'gemma2-9b-it',
      primaryModel = 'nvidia/nemotron-nano-9b-v2:free'
    } = options;

    // Try primary service (OpenRouter) first if not rate limited
    if (!this.shouldUseFallback()) {
      try {
        const completion = await openai.chat.completions.create({
          model: primaryModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: maxTokens,
          temperature: temperature
        });
        
        return completion.choices[0].message.content.trim();
      } catch (error) {
        Logger.error(`OpenRouter API error: ${error.message}`);
        this.handleRateLimit(error);
        
        // If it's a rate limit error, fall through to Groq
        if (error.status !== 429) {
          throw error; // Re-throw non-rate-limit errors
        }
      }
    }

    // Fallback to Groq
    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        model: fallbackModel,
        temperature: temperature,
        max_completion_tokens: maxTokens,
        top_p: 1,
        stream: false,
        stop: null
      });

      return chatCompletion.choices[0].message.content.trim();
    } catch (groqError) {
      Logger.error(`Groq fallback failed: ${groqError.message}`);
      throw groqError;
    }
  }

  // 1. Intelligent Message Type Classification
  static async classifyMessageType(content) {
    try {
      const systemPrompt = `Classify the following message into one of these categories: 
      - bug_report: Technical issues, errors, things not working
      - feature_request: Asking for new features or improvements
      - question: General inquiries, how-to questions
      - support: Need help with existing features
      - user: General conversation
      
      Respond with only the category name.`;

      return await this.makeAIRequest(systemPrompt, content, { maxTokens: 20 });
    } catch (error) {
      Logger.error('AI message classification failed:', error);
      return 'user'; // fallback
    }
  }

  // 2. Smart Priority Detection
  static async determinePriority(content, type) {
    try {
      const systemPrompt = `Determine the priority (low, medium, high) for this ${type} message. 
      High: Urgent issues, system down, security concerns, payment problems
      Medium: Feature requests, general support questions
      Low: Minor questions, documentation requests
      
      Respond with only: low, medium, or high`;

      return await this.makeAIRequest(systemPrompt, content, { maxTokens: 10 });
    } catch (error) {
      Logger.error('AI priority detection failed:', error);
      return 'medium'; // fallback
    }
  }

  // 3. Sentiment Analysis for Better Support Routing
  static async analyzeSentiment(content) {
    try {
      const systemPrompt = `Analyze the sentiment of this message. Respond with:
      - positive: Happy, satisfied customers
      - neutral: Normal inquiries
      - negative: Frustrated, angry, or upset customers (needs immediate attention)
      - urgent: Extremely negative or threatening to leave
      
      Respond with only the sentiment.`;

      return await this.makeAIRequest(systemPrompt, content, { maxTokens: 10 });
    } catch (error) {
      Logger.error('AI sentiment analysis failed:', error);
      return 'neutral';
    }
  }

  // 4. AI Agent for Basic Issue Resolution
  static async generateAutoResponse(content, type, userHistory = []) {
    try {
      const systemPrompt = `You are a helpful customer support AI. Provide concise, helpful responses.
      If you cannot fully resolve the issue, suggest escalating to human support.
      Keep responses under 200 words and be friendly but professional.
      
      Based on message type "${type}", provide appropriate assistance.`;

      const userPrompt = `User message: "${content}"\n\nPrevious context: ${userHistory.slice(-3).map(msg => `${msg.senderType}: ${msg.content}`).join('\n')}`;

      return await this.makeAIRequest(systemPrompt, userPrompt, { 
        maxTokens: 300, 
        temperature: 0.7 
      });
    } catch (error) {
      Logger.error('AI auto-response generation failed:', error);
      return null;
    }
  }

  // 5. Language Detection
  static async detectLanguage(content) {
    try {
      const systemPrompt = 'Detect the language of the following text. Respond with only the ISO 639-1 language code (e.g., en, es, fr, de).';

      return await this.makeAIRequest(systemPrompt, content, { maxTokens: 10 });
    } catch (error) {
      Logger.error('Language detection failed:', error);
      return 'en';
    }
  }

  // 6. Content Moderation
  static async moderateContent(content) {
    try {
      const systemPrompt = `Analyze this message for inappropriate content. Check for:
      - Spam, promotional content
      - Inappropriate language, harassment
      - Potential security threats
      
      Respond with: clean, spam, inappropriate, or threat`;

      return await this.makeAIRequest(systemPrompt, content, { maxTokens: 10 });
    } catch (error) {
      Logger.error('Content moderation failed:', error);
      return 'clean';
    }
  }

  // 7. Smart Agent Assignment
  static async suggestAgent(content, type, priority) {
    try {
      const systemPrompt = `Based on the message content ${content}, type ${type}, and priority ${priority}, 
      suggest the best support agent category:
      - technical: For bug reports, technical issues
      - billing: For payment, subscription issues
      - general: For general questions, feature requests
      - senior: For high priority or complex issues
      
      Respond with only the category.`;

      return await this.makeAIRequest(systemPrompt, content, { maxTokens: 15 });
    } catch (error) {
      Logger.error('Agent suggestion failed:', error);
      return 'general';
    }
  }

  // 8. Extract Key Information/Tags
  static async extractTags(content) {
    try {
      const systemPrompt = `Extract 3-5 relevant tags from this message for better categorization.
      Focus on key topics, issues, or features mentioned.
      Return as comma-separated values.`;

      const result = await this.makeAIRequest(systemPrompt, content, { 
        maxTokens: 50, 
        temperature: 0.3 
      });
      
      return result.split(',').map(tag => tag.trim());
    } catch (error) {
      Logger.error('Tag extraction failed:', error);
      return [];
    }
  }

  // 9. Conversation Summary for Context
  static async summarizeConversation(messages) {
    try {
      const conversation = messages.slice(-10).map(msg => 
        `${msg.senderType}: ${msg.content}`
      ).join('\n');

      const systemPrompt = 'Summarize this conversation in 2-3 sentences, highlighting the main issue and any resolution attempts.';

      return await this.makeAIRequest(systemPrompt, conversation, { 
        maxTokens: 150, 
        temperature: 0.3 
      });
    } catch (error) {
      Logger.error('Conversation summarization failed:', error);
      return null;
    }
  }

  // 10. Proactive Issue Detection
  static async detectIssuePatterns(content, userHistory) {
    try {
      const recentMessages = userHistory.slice(-5).map(msg => msg.content).join('\n');
      
      const systemPrompt = `Analyze if this user is experiencing recurring issues or escalating problems.
      Look for patterns that indicate:
      - Repeated similar issues
      - Increasing frustration
      - Multiple failed attempts
      - Potential churn risk
      
      Respond with: normal, recurring, escalating, or churn_risk`;

      const userPrompt = `Current message: ${content}\n\nRecent history:\n${recentMessages}`;

      return await this.makeAIRequest(systemPrompt, userPrompt, { maxTokens: 20 });
    } catch (error) {
      Logger.error('Issue pattern detection failed:', error);
      return 'normal';
    }
  }

  // Streaming response method for real-time chat
  static async generateStreamingResponse(content, type, userHistory = []) {
    try {
      const systemPrompt = `You are a helpful customer support AI. Provide concise, helpful responses.
      If you cannot fully resolve the issue, suggest escalating to human support.
      Keep responses under 200 words and be friendly but professional.
      
      Based on message type "${type}", provide appropriate assistance.`;

      const userPrompt = `User message: "${content}"\n\nPrevious context: ${userHistory.slice(-3).map(msg => `${msg.senderType}: ${msg.content}`).join('\n')}`;

      // Try OpenRouter first if not rate limited
      if (!this.shouldUseFallback()) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'nvidia/nemotron-nano-9b-v2:free',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            max_tokens: 300,
            temperature: 0.7,
            stream: true
          });

          return completion;
        } catch (error) {
          this.handleRateLimit(error);
          if (error.status !== 429) {
            throw error;
          }
        }
      }

      // Fallback to Groq streaming
      Logger.info(`Using Groq streaming fallback for real-time response`);
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'gemma2-9b-it',
        temperature: 0.7,
        max_completion_tokens: 300,
        top_p: 1,
        stream: true,
        stop: null
      });

      return chatCompletion;
    } catch (error) {
      Logger.error('Streaming response generation failed:', error);
      throw error;
    }
  }

  // Health check method
  static async healthCheck() {
    try {
      const testPrompt = "Hello, respond with 'OK'";
      const result = await this.makeAIRequest("You are a test assistant.", testPrompt, { maxTokens: 5 });
      return {
        status: 'healthy',
        primaryService: !this.shouldUseFallback() ? 'openrouter' : 'rate-limited',
        fallbackService: 'groq',
        rateLimitReached,
        rateLimitResetTime: rateLimitResetTime ? new Date(rateLimitResetTime) : null,
        testResponse: result
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        primaryService: 'error',
        fallbackService: 'error'
      };
    }
  }
}

module.exports = AIService;