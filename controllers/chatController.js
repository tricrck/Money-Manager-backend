// controllers/chatController.js
const asyncHandler = require('express-async-handler');
const ChatMessage = require('../models/ChatMessage.js');
const User = require('../models/User'); // Add this import
const Logger = require('../middleware/Logger');
const { v4: uuidv4 } = require('uuid');

/**
 * @desc Send a message (user or support)
 * @route POST /api/chat/send
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { content, type, attachment, conversationId, recipientUserId } = req.body;

  if (!content && !attachment) {
    Logger.warn(`User ${req.user._id} tried to send empty message`);
    res.status(400);
    throw new Error('Message content or attachment is required');
  }
  Logger.info(`User ${req.user.role} is sending a message`, { conversationId, recipientUserId, user: req.user });

  const senderType = req.user.role.toLowerCase() === 'support' || req.user.role.toLowerCase() === 'admin' ? 'support' : 'user';

  let finalConversationId =
    conversationId && conversationId !== 'floating-chat-default'
      ? conversationId
      : `conv_${uuidv4()}`;
  Logger.info(`Using conversationId: ${finalConversationId}`, { conversationId, senderType });

  const message = await ChatMessage.create({
    user: senderType === 'user' ? req.user._id : recipientUserId,
    conversationId: finalConversationId,
    content,
    type: type || 'user',
    senderType,
    supportAgent: senderType === 'support' ? req.user._id : null,
    attachment: attachment || null,
    status: 'sent',
    priority: req.body.priority || 'medium',
    conversationStatus: req.body.conversationStatus || 'open'
  });

  const populatedMessage = await ChatMessage.findById(message._id)
    .populate('user', 'name email')
    .populate('supportAgent', 'name email');

  Logger.info(`Message sent by ${senderType} ${req.user._id} in conversation ${finalConversationId}`);

  res.status(201).json(populatedMessage);
});

/**
 * @desc Get messages (user or support)
 * @route GET /api/chat/messages
 * You can pass ?conversationId=...&page=...&limit=...
 */
exports.getMessages = asyncHandler(async (req, res) => {
  let { conversationId } = req.query; // use query instead of param to fit old route
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  // Handle case where conversationId might be passed as a parameter
  if (!conversationId && req.params.conversationId) {
    conversationId = req.params.conversationId;
  }



  // If still no conversationId and not admin/support, try to get user's conversations
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
      .limit(20); // Get recent messages across all conversations

    Logger.info(`Retrieved recent messages for user ${req.user._id}`);
    
    return res.json({
      messages,
      conversationId: null,
      pagination: {
        total: messages.length,
        page: 1,
        pages: 1,
      },
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

  Logger.info(`Retrieved conversation ${conversationId} messages for user ${req.user._id}`);

  res.json({
    messages,
    conversationId,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
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