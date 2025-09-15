const asyncHandler = require('express-async-handler');
const ChatMessage = require('../models/ChatMessage.js');
const User = require('../models/User');
const Logger = require('../middleware/Logger');
const { v4: uuidv4 } = require('uuid');
const AIService = require('../services/AIService'); // Import our new service
const { sendEmail, sendPushNotification } = require('./messagingController');

/**
 * @desc Enhanced Send Message with AI Integration and Groq Fallback
 * @route POST /api/chat/send
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { content, type, attachment, conversationId, recipientUserId } = req.body;

  if (!content && !attachment) {
    Logger.warn(`User ${req.user._id} tried to send empty message`);
    res.status(400);
    throw new Error('Message content or attachment is required');
  }

  const senderType = req.user.role.toLowerCase() === 'support' || req.user.role.toLowerCase() === 'admin' ? 'support' : 'user';
  

  let finalConversationId = conversationId && conversationId !== 'floating-chat-default'
    ? conversationId
    : `conv_${uuidv4()}`;

  // AI Enhancements for user messages
  let enhancedType = type;
  let enhancedPriority = req.body.priority || 'medium';
  let aiResponse = null;
  let detectedLanguage = 'en';
  let contentModeration = 'clean';
  let extractedTags = [];
  let suggestedAgent = null;
  let issuePattern = 'normal';

  if (senderType === 'user' && content) {
    // Get user's conversation history for context
    const userHistory = await ChatMessage.find({ 
      user: req.user._id 
    }).sort({ createdAt: -1 }).limit(10);

    // Run AI enhancements in parallel for better performance
    const aiPromises = [
      AIService.classifyMessageType(content),
      AIService.determinePriority(content, enhancedType),
      AIService.analyzeSentiment(content),
      AIService.detectLanguage(content),
      AIService.moderateContent(content),
      AIService.extractTags(content),
      AIService.suggestAgent(content, enhancedType, enhancedPriority),
      AIService.detectIssuePatterns(content, userHistory)
    ];

    const results = await Promise.allSettled(aiPromises);

    // Extract results safely with proper error handling
    enhancedType = results[0].status === 'fulfilled' ? results[0].value : enhancedType;
    enhancedPriority = results[1].status === 'fulfilled' ? results[1].value : enhancedPriority;
    const detectedSentiment = results[2].status === 'fulfilled' ? results[2].value : 'neutral';
    detectedLanguage = results[3].status === 'fulfilled' ? results[3].value : 'en';
    contentModeration = results[4].status === 'fulfilled' ? results[4].value : 'clean';
    extractedTags = results[5].status === 'fulfilled' ? results[5].value : [];
    suggestedAgent = results[6].status === 'fulfilled' ? results[6].value : 'general';
    issuePattern = results[7].status === 'fulfilled' ? results[7].value : 'normal';

    // Validate issue pattern
    const validPatterns = ['normal', 'recurring', 'escalating', 'churn_risk'];
    if (!validPatterns.includes(issuePattern)) {
      issuePattern = 'normal';
    }

    // Auto-escalate based on sentiment and patterns
    if (detectedSentiment === 'urgent' || issuePattern === 'churn_risk') {
      enhancedPriority = 'high';
    }


    // Block inappropriate content
    const validResults = ['clean', 'spam', 'inappropriate', 'threat'];
    if (!validResults.includes(contentModeration)) {
      contentModeration = 'clean';
    }

    const validAgents = ['technical', 'billing', 'general', 'senior'];
    if (!validAgents.includes(suggestedAgent)) {
      suggestedAgent = 'general';
    }

    const validPriorities = ['low', 'medium', 'high'];
    if (!validPriorities.includes(enhancedPriority)) {
      Logger.warn(`Invalid AI priority "${enhancedPriority}" - falling back to "medium"`);
      enhancedPriority = 'medium';
    }

    // Sanitize type, priority, agent
    const validTypes = ['bug_report', 'feature_request', 'question', 'support', 'user'];
    if (!validTypes.includes(enhancedType)) {
      Logger.warn(`Invalid AI type "${enhancedType}" - falling back to "user"`);
      enhancedType = 'user';
    }


    // Generate AI auto-response for simple queries
    if (enhancedType === 'question' || enhancedPriority === 'low') {
      try {
        aiResponse = await AIService.generateAutoResponse(content, enhancedType, userHistory);
      } catch (error) {
        Logger.warn('AI auto-response failed, continuing without it:', error.message);
      }
    }

    Logger.info(`AI Analysis - Type: ${enhancedType}, Priority: ${enhancedPriority}, Sentiment: ${detectedSentiment}, Pattern: ${issuePattern}`);
  }

  // Create the message with AI enhancements
  const messageData = {
    user: senderType === 'user' ? req.user._id : recipientUserId,
    conversationId: finalConversationId,
    content,
    type: enhancedType || 'user',
    senderType,
    supportAgent: senderType === 'support' ? req.user._id : null,
    attachment: attachment || null,
    status: 'sent',
    priority: enhancedPriority,
    conversationStatus: req.body.conversationStatus || 'open',
    // Add AI metadata
    aiMetadata: {
      detectedLanguage,
      extractedTags,
      suggestedAgent,
      issuePattern,
      contentModeration
    }
  };

  const message = await ChatMessage.create(messageData);

  const populatedMessage = await ChatMessage.findById(message._id)
    .populate('user', 'name email')
    .populate('supportAgent', 'name email');
  // Notifications for support/admins
    // ---------------------------
    if (senderType === 'user') {
      try {
        // Find active support/admin users
        const targets = await User.find({
          role: { $in: ['Support', 'Admin'] },
          isActive: true
        }).lean();

        if (targets.length > 0) {
          const title = `New ${enhancedPriority.toUpperCase()} ${enhancedType} from ${req.user.name || 'User'}`;
          const snippet = (content || (attachment ? '[attachment]' : '')).toString().slice(0, 250);
          const body = `${snippet}\n\nConversation: ${finalConversationId}\nPriority: ${enhancedPriority}\nType: ${enhancedType}`;

          const notifyPromises = [];

          targets.forEach(target => {
            // send push for medium or high if they accept push
            if (['medium', 'high'].includes(enhancedPriority) &&
                target.notificationPreferences?.push &&
                target.pushToken) {
              // keep same shape your sendPushNotification expects (userId, payload)
              notifyPromises.push(
                sendPushNotification(target._id, {
                  title,
                  body,
                  conversationId: finalConversationId,
                  messageId: message._id
                }).catch(err => {
                  Logger.error('Push notification failed', {
                    to: target._id,
                    email: target.email,
                    error: err?.message || err
                  });
                  // swallow so Promise.allSettled receives failure but we continue
                  throw err;
                })
              );
            }

            // send email when it's a support-type message AND priority is high
            if (['admin', 'support', 'bug_report'].includes(enhancedType) &&
                enhancedPriority === 'high' &&
                target.notificationPreferences?.email &&
                target.email) {
              notifyPromises.push(
                sendEmail(target.email, title, body).catch(err => {
                  Logger.error('Email sending failed', {
                    toEmail: target.email,
                    error: err?.message || err
                  });
                  throw err;
                })
              );
            }

            // (Optional) also record an internal audit / activity log for each target
            // e.g. NotificationLog.create({ to: target._id, type: 'push'|'email', priority: enhancedPriority, conversationId: finalConversationId })
          });

          // Fire them in parallel and log results
          if (notifyPromises.length > 0) {
            const results = await Promise.allSettled(notifyPromises);
            results.forEach((r, idx) => {
              if (r.status === 'rejected') {
                Logger.warn('Notification promise rejected', { index: idx, reason: r.reason?.message || r.reason });
              }
            });
            Logger.info(`Dispatched ${notifyPromises.length} notification(s) for conversation ${finalConversationId}`);
          } else {
            Logger.info('No notification targets matched preferences for this message');
          }
        }
      } catch (notifyErr) {
        Logger.error('Notification dispatch failed:', notifyErr);
      }
    }

  // If AI generated a response, send it immediately
  if (aiResponse && senderType === 'user') {
    try {
      const aiMessage = await ChatMessage.create({
        user: req.user._id,
        conversationId: finalConversationId,
        content: aiResponse,
        type: 'support',
        senderType: 'ai',
        supportAgent: null, // Mark as AI response
        status: 'sent',
        priority: enhancedPriority,
        conversationStatus: 'in_progress',
        aiMetadata: {
          isAiGenerated: true,
          originalMessageId: message._id
        }
      });

      Logger.info(`AI auto-response sent for conversation ${finalConversationId}`);
    } catch (error) {
      Logger.error('Failed to create AI response message:', error);
    }
  }

  Logger.info(`Enhanced message sent by ${senderType} ${req.user._id} in conversation ${finalConversationId}`);

  res.status(201).json({
    ...populatedMessage.toObject(),
    aiInsights: {
      detectedType: enhancedType,
      determinedPriority: enhancedPriority,
      suggestedAgent,
      issuePattern,
      extractedTags,
      hasAiResponse: !!aiResponse
    }
  });
});

/**
 * @desc Enhanced get messages with AI insights and conversation summary
 * @route GET /api/chat/messages
 */
exports.getMessages = asyncHandler(async (req, res) => {
  let { conversationId } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  if (!conversationId && req.params.conversationId) {
    conversationId = req.params.conversationId;
  }

  if (!conversationId) {
    const userRole = req.user.role.toLowerCase();
    let query = {};
    
    if (userRole !== 'admin' && userRole !== 'support') {
      query.user = req.user._id;
    }

    const messages = await ChatMessage.find(query)
      .populate('user', 'name email')
      .populate('supportAgent', 'name email')
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({
      messages,
      conversationId: null,
      pagination: { total: messages.length, page: 1, pages: 1 }
    });
  }

  const userRole = req.user.role;
  let query = { conversationId };

  if (userRole !== 'admin' && userRole !== 'support') {
    query.user = req.user._id;
  }

  const total = await ChatMessage.countDocuments(query);
  const messages = await ChatMessage.find(query)
    .populate('user', 'name email')
    .populate('supportAgent', 'name email')
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);

  // Generate conversation summary if requested
  let conversationSummary = null;
  if (req.query.includeSummary === 'true' && messages.length > 5) {
    try {
      conversationSummary = await AIService.summarizeConversation(messages);
    } catch (error) {
      Logger.warn('Failed to generate conversation summary:', error.message);
    }
  }

  res.json({
    messages,
    conversationId,
    conversationSummary,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc Get AI service health status
 * @route GET /api/chat/ai/health
 */
exports.getAIHealth = asyncHandler(async (req, res) => {
  try {
    const healthStatus = await AIService.healthCheck();
    res.json(healthStatus);
  } catch (error) {
    Logger.error('AI health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check AI service health',
      error: error.message
    });
  }
});

/**
 * @desc Generate streaming AI response for real-time chat
 * @route POST /api/chat/ai/stream
 */
exports.streamAIResponse = asyncHandler(async (req, res) => {
  const { content, type = 'question', conversationId } = req.body;

  if (!content) {
    res.status(400);
    throw new Error('Content is required for AI response');
  }

  // Get conversation history for context
  const userHistory = conversationId 
    ? await ChatMessage.find({ conversationId }).sort({ createdAt: -1 }).limit(10)
    : [];

  try {
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await AIService.generateStreamingResponse(content, type, userHistory);
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(content);
      }
    }
    
    res.end();
  } catch (error) {
    Logger.error('Streaming AI response failed:', error);
    res.status(500).json({
      error: 'Failed to generate AI response',
      message: error.message
    });
  }
});

/**
 * @desc Enhanced AI insights with fallback status
 * @route GET /api/chat/ai/insights/:conversationId
 */
exports.getAIInsights = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  
  const messages = await ChatMessage.find({ conversationId })
    .sort({ createdAt: 1 });

  if (messages.length === 0) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  // Aggregate AI insights
  const insights = {
    totalMessages: messages.length,
    messageTypes: {},
    priorities: {},
    sentimentTrend: [],
    commonTags: {},
    issuePatterns: {},
    languageDistribution: {},
    aiResponseCount: messages.filter(m => m.aiMetadata?.isAiGenerated).length,
    // Add fallback service status
    serviceStatus: await AIService.healthCheck()
  };

  messages.forEach(message => {
    if (message.aiMetadata) {
      // Count message types
      insights.messageTypes[message.type] = (insights.messageTypes[message.type] || 0) + 1;
      
      // Count priorities
      insights.priorities[message.priority] = (insights.priorities[message.priority] || 0) + 1;
      
      // Aggregate tags
      if (message.aiMetadata.extractedTags) {
        message.aiMetadata.extractedTags.forEach(tag => {
          insights.commonTags[tag] = (insights.commonTags[tag] || 0) + 1;
        });
      }
      
      // Track issue patterns
      if (message.aiMetadata.issuePattern) {
        insights.issuePatterns[message.aiMetadata.issuePattern] = 
          (insights.issuePatterns[message.aiMetadata.issuePattern] || 0) + 1;
      }
      
      // Language distribution
      if (message.aiMetadata.detectedLanguage) {
        insights.languageDistribution[message.aiMetadata.detectedLanguage] = 
          (insights.languageDistribution[message.aiMetadata.detectedLanguage] || 0) + 1;
      }
    }
  });

  res.json({
    success: true,
    conversationId,
    insights
  });
});


/**
 * @desc Mark messages as read
 * @route PUT /api/chat/mark-read
 * Pass { conversationId } in body
 */
exports.markMessagesAsRead = asyncHandler(async (req, res) => {
  let { conversationId } = req.body;
  
  // Also check for conversationId in query params for flexibility
  if (!conversationId && req.query.conversationId) {
    conversationId = req.query.conversationId;
  }

  const userRole = req.user.role.toLowerCase();

  if (!conversationId) {
    Logger.warn(`Mark as read attempted without conversationId by user ${req.user._id}`);
    res.status(400);
    throw new Error('conversationId is required');
  }

  let query = { conversationId, read: false };

  if (userRole === 'admin' || userRole === 'support') {
    query.senderType = 'user';
  } else {
    query.senderType = 'support';
    query.user = req.user._id;
  }

  const result = await ChatMessage.updateMany(query, {
    $set: { read: true, status: 'read' },
    $push: {
      readBy: {
        user: req.user._id,
        readAt: new Date()
      }
    }
  });

  Logger.info(`User ${req.user._id} marked ${result.modifiedCount} messages as read in conversation ${conversationId}`);

  res.json({
    message: 'Messages marked as read',
    modifiedCount: result.modifiedCount
  });
});

/**
 * @desc Get unread count
 * @route GET /api/chat/unread-count
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const userRole = req.user.role.toLowerCase();

  let query;
  if (userRole === 'admin' || userRole === 'support') {
    query = { senderType: 'user', read: false };
  } else {
    query = { user: req.user._id, senderType: 'support', read: false };
  }

  const count = await ChatMessage.countDocuments(query);

  Logger.info(`User ${req.user._id} has ${count} unread messages`);

  res.json({ count });
});

/**
 * @desc Get all support conversations/messages
 * @route GET /api/chat/support/messages
 */
// @access  Private (Support/Admin only)
exports.getAllSupportMessages = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;
  const status = req.query.status || 'all';
  const priority = req.query.priority || 'all';

  // Build match query
  let matchQuery = {};
  if (status !== 'all') {
    matchQuery.conversationStatus = status;
  }
  if (priority !== 'all') {
    matchQuery.priority = priority;
  }

  try {
    const conversations = await ChatMessage.aggregate([
      {
        $match: matchQuery
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: '$conversationId',
          user: { $first: '$user' },
          lastMessage: { $first: '$content' },
          lastMessageTime: { $first: '$createdAt' },
          lastMessageType: { $first: '$senderType' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$read', false] }, { $eq: ['$senderType', 'user'] }] },
                1,
                0
              ]
            }
          },
          status: { $first: '$conversationStatus' },
          priority: { $first: '$priority' },
          messageCount: { $sum: 1 },
          assignedAgent: { $first: '$supportAgent' },
          createdAt: { $first: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users', // Make sure this matches your actual users collection name
          localField: 'user',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedAgent',
          foreignField: '_id',
          as: 'agentInfo'
        }
      },
      {
        $addFields: {
          userDoc: { $arrayElemAt: ['$userInfo', 0] },
          agentDoc: { $arrayElemAt: ['$agentInfo', 0] }
        }
      },
      {
        $project: {
          _id: 1,
          conversationId: '$_id',
          user: {
            _id: '$user',
            name: {
              $cond: {
                if: { $ne: ['$userDoc', null] },
                then: { $ifNull: ['$userDoc.name', 'No Name'] },
                else: 'User Not Found'
              }
            },
            email: {
              $cond: {
                if: { $ne: ['$userDoc', null] },
                then: { $ifNull: ['$userDoc.email', 'No Email'] },
                else: ''
              }
            }
          },
          assignedAgent: {
            $cond: {
              if: { $ne: ['$agentDoc', null] },
              then: {
                _id: '$assignedAgent',
                name: { $ifNull: ['$agentDoc.name', 'No Name'] },
                email: { $ifNull: ['$agentDoc.email', 'No Email'] }
              },
              else: null
            }
          },
          lastMessage: 1,
          lastMessageTime: 1,
          lastMessageType: 1,
          unreadCount: 1,
          status: 1,
          priority: 1,
          messageCount: 1,
          createdAt: 1
        }
      },
      {
        $sort: { 
          unreadCount: -1,
          lastMessageTime: -1 
        }
      },
      {
        $skip: skip
      },
      {
        $limit: limit
      }
    ]);

    // Get total count using aggregation instead of distinct
    const totalResult = await ChatMessage.aggregate([
      { $match: matchQuery },
      { $group: { _id: '$conversationId' } },
      { $count: 'total' }
    ]);
    
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    Logger.info(`Support retrieved ${conversations.length} conversations out of ${total} total`);

    res.json({
      success: true,
      conversations,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    Logger.error('Error in getAllSupportMessages:', error);
    
    // Fallback method that doesn't use distinct - using aggregation instead
    try {
      // Use aggregation to get unique conversation IDs instead of distinct
      const conversationIdsResult = await ChatMessage.aggregate([
        { $match: matchQuery },
        { $group: { _id: '$conversationId' } },
        { $skip: skip },
        { $limit: limit }
      ]);
      
      const conversationIds = conversationIdsResult.map(item => item._id);
      const conversations = [];
      
      for (const convId of conversationIds) {
        const messages = await ChatMessage.find({ conversationId: convId })
          .populate('user', 'name email')
          .populate('supportAgent', 'name email')
          .sort({ createdAt: -1 });
        
        if (messages.length > 0) {
          const lastMessage = messages[0];
          const unreadCount = messages.filter(msg => !msg.read && msg.senderType === 'user').length;
          
          conversations.push({
            _id: convId,
            conversationId: convId,
            user: {
              _id: lastMessage.user?._id,
              name: lastMessage.user?.name || 'Unknown',
              email: lastMessage.user?.email || ''
            },
            lastMessage: lastMessage.content,
            lastMessageTime: lastMessage.createdAt,
            lastMessageType: lastMessage.senderType,
            unreadCount,
            status: lastMessage.conversationStatus,
            priority: lastMessage.priority,
            messageCount: messages.length,
            createdAt: messages[messages.length - 1].createdAt, // First message timestamp
            assignedAgent: lastMessage.supportAgent ? {
              _id: lastMessage.supportAgent._id,
              name: lastMessage.supportAgent.name,
              email: lastMessage.supportAgent.email
            } : null
          });
        }
      }
      
      // Get total count using aggregation
      const totalCountResult = await ChatMessage.aggregate([
        { $match: matchQuery },
        { $group: { _id: '$conversationId' } },
        { $count: 'total' }
      ]);
      const total = totalCountResult.length > 0 ? totalCountResult[0].total : 0;
      
      Logger.info(`Support retrieved ${conversations} conversations using fallback method`);
      
      res.json({
        success: true,
        conversations,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      });
      
    } catch (fallbackError) {
      Logger.error('Fallback method also failed:', fallbackError);
      res.status(500);
      throw new Error('Unable to retrieve support conversations');
    }
  }
});

/**
 * @desc Update conversation status and priority
 * @route PUT /api/chat/conversation/:conversationId
 */
exports.updateConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { status, priority } = req.body;

  if (!conversationId) {
    res.status(400);
    throw new Error('Conversation ID is required');
  }

  const updateFields = {};
  if (status) updateFields.conversationStatus = status;
  if (priority) updateFields.priority = priority;

  if (Object.keys(updateFields).length === 0) {
    res.status(400);
    throw new Error('At least one field (status or priority) is required');
  }

  const result = await ChatMessage.updateMany(
    { conversationId },
    { $set: updateFields }
  );

  Logger.info(`Updated conversation ${conversationId} - modified ${result.modifiedCount} messages`);

  res.json({
    success: true,
    message: 'Conversation updated successfully',
    modifiedCount: result.modifiedCount
  });
});

/**
 * @desc Get conversation details
 * @route GET /api/chat/conversation/:conversationId
 */
exports.getConversationDetails = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;

  if (!conversationId) {
    res.status(400);
    throw new Error('Conversation ID is required');
  }

  const messages = await ChatMessage.find({ conversationId })
    .populate('user', 'name email')
    .populate('supportAgent', 'name email')
    .sort({ createdAt: 1 });

  if (messages.length === 0) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const unreadCount = messages.filter(msg => !msg.read && msg.senderType === 'user').length;

  const conversationDetails = {
    conversationId,
    user: {
      _id: firstMessage.user?._id,
      name: firstMessage.user?.name || 'Unknown',
      email: firstMessage.user?.email || ''
    },
    status: firstMessage.conversationStatus,
    priority: firstMessage.priority,
    messageCount: messages.length,
    unreadCount,
    createdAt: firstMessage.createdAt,
    lastMessageTime: lastMessage.createdAt,
    lastMessage: lastMessage.content,
    lastMessageType: lastMessage.senderType,
    assignedAgent: firstMessage.supportAgent ? {
      _id: firstMessage.supportAgent._id,
      name: firstMessage.supportAgent.name,
      email: firstMessage.supportAgent.email
    } : null,
    messages
  };

  Logger.info(`Retrieved conversation details for ${conversationId}`);

  res.json({
    success: true,
    conversation: conversationDetails
  });
});

// Debug helper function - add this temporarily
exports.debugChatMessages = asyncHandler(async (req, res) => {
  // Check a sample of your ChatMessage documents
  const sampleMessages = await ChatMessage.find().limit(3).lean();
  
  // Check if users exist
  const userIds = sampleMessages.map(msg => msg.user).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  
  res.json({
    sampleMessages,
    users,
    userCollection: User.collection.name, // Verify collection name
    chatMessageCollection: ChatMessage.collection.name
  });
});