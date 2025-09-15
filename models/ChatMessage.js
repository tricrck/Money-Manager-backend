const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    content: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['user', 'admin', 'support', 'bug_report', 'feature_request', 'question'],
      default: 'user',
    },
    senderType: {
      type: String,
      enum: ['user', 'support', 'ai'],
      required: true,
    },
    supportAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function() {
        return this.senderType === 'support';
      }
    },
    attachment: {
      name: String,
      type: String,
      size: Number,
      url: String,
    },
    status: {
      type: String,
      enum: ['sending', 'sent', 'delivered', 'read'],
      default: 'sent',
    },
    read: {
      type: Boolean,
      default: false,
    },
    readBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    conversationStatus: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open'
    },
    // AI Enhancement Fields
    aiMetadata: {
      // Language detection
      detectedLanguage: {
        type: String,
        default: 'en'
      },
      
      // Content analysis
      sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative', 'urgent'],
        default: 'neutral'
      },
      
      // Auto-extracted tags for categorization
      extractedTags: [{
        type: String,
        trim: true
      }],
      
      // Suggested support agent type
      suggestedAgent: {
        type: String,
        enum: ['technical', 'billing', 'general', 'senior'],
        default: 'general'
      },
      
      // Issue pattern detection
      issuePattern: {
        type: String,
        enum: ['normal', 'recurring', 'escalating', 'churn_risk'],
        default: 'normal'
      },
      
      // Content moderation status
      contentModeration: {
        type: String,
        enum: ['clean', 'spam', 'inappropriate', 'threat'],
        default: 'clean'
      },
      
      // AI confidence scores
      aiConfidence: {
        typeClassification: {
          type: Number,
          min: 0,
          max: 1
        },
        priorityDetection: {
          type: Number,
          min: 0,
          max: 1
        },
        sentimentAnalysis: {
          type: Number,
          min: 0,
          max: 1
        }
      },
      
      // Track AI-generated responses
      isAiGenerated: {
        type: Boolean,
        default: false
      },
      
      // Reference to original message if this is an AI response
      originalMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatMessage'
      },
      
      // AI model used for analysis
      aiModel: {
        type: String,
        default: 'nvidia/nemotron-nano-9b-v2:free'
      },
      
      // Processing timestamp
      aiProcessedAt: {
        type: Date,
        default: Date.now
      }
    }
  },
  { timestamps: true }
);

// Enhanced indexes for AI features
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });
chatMessageSchema.index({ user: 1, createdAt: -1 });
chatMessageSchema.index({ 'aiMetadata.sentiment': 1, priority: 1 });
chatMessageSchema.index({ 'aiMetadata.extractedTags': 1 });
chatMessageSchema.index({ 'aiMetadata.issuePattern': 1, createdAt: -1 });
chatMessageSchema.index({ 'aiMetadata.suggestedAgent': 1, conversationStatus: 1 });

// Virtual for AI insights summary
chatMessageSchema.virtual('aiInsights').get(function() {
  if (!this.aiMetadata) return null;
  
  return {
    hasAiAnalysis: true,
    riskLevel: this.aiMetadata.issuePattern === 'churn_risk' ? 'high' : 
              this.aiMetadata.sentiment === 'urgent' ? 'medium' : 'low',
    needsHumanAttention: this.aiMetadata.sentiment === 'urgent' || 
                        this.aiMetadata.issuePattern === 'escalating',
    suggestedActions: this.getSuggestedActions()
  };
});

// Method to get suggested actions based on AI analysis
chatMessageSchema.methods.getSuggestedActions = function() {
  const actions = [];
  
  if (this.aiMetadata?.sentiment === 'urgent') {
    actions.push('Escalate to senior support');
  }
  
  if (this.aiMetadata?.issuePattern === 'recurring') {
    actions.push('Check knowledge base for similar issues');
  }
  
  if (this.aiMetadata?.issuePattern === 'churn_risk') {
    actions.push('Notify customer success team');
  }
  
  if (this.priority === 'high' && this.aiMetadata?.suggestedAgent) {
    actions.push(`Route to ${this.aiMetadata.suggestedAgent} team`);
  }
  
  return actions;
};

// Static method to get AI analytics
chatMessageSchema.statics.getAIAnalytics = function(dateRange = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - dateRange);
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        aiMetadata: { $exists: true }
      }
    },
    {
      $group: {
        _id: null,
        totalMessages: { $sum: 1 },
        aiGeneratedResponses: {
          $sum: { $cond: ['$aiMetadata.isAiGenerated', 1, 0] }
        },
        urgentSentiment: {
          $sum: { $cond: [{ $eq: ['$aiMetadata.sentiment', 'urgent'] }, 1, 0] }
        },
        churnRisk: {
          $sum: { $cond: [{ $eq: ['$aiMetadata.issuePattern', 'churn_risk'] }, 1, 0] }
        },
        avgConfidence: {
          $avg: '$aiMetadata.aiConfidence.typeClassification'
        }
      }
    }
  ]);
};

module.exports = mongoose.model('ChatMessage', chatMessageSchema);