const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Add conversation/thread tracking
    conversationId: {
      type: String,
      required: true,
      index: true, // For faster queries
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
    // Track who sent the message (user or support)
    senderType: {
      type: String,
      enum: ['user', 'support'],
      required: true,
    },
    // If it's from support, track which support member
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
    // Track read status for both parties
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
    // Add priority for support tickets
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    // Track conversation status
    conversationStatus: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open'
    }
  },
  { timestamps: true }
);

// Compound index for efficient conversation queries
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });
chatMessageSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);