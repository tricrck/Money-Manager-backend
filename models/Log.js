const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  timestamp: { 
    type: String, 
    required: true,
    index: true 
  },
  source: { 
    type: String, 
    required: true,
    index: true 
  },
  message: { 
    type: String, 
    required: true 
  },
  levelName: { 
    type: String, 
    required: true,
    enum: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'NOTE'],
    index: true 
  },
  level: { 
    type: Number, 
    required: true,
    index: true 
  },
  // Additional metadata for better querying
  date: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  // Optional: Add environment info
  environment: { 
    type: String, 
    default: process.env.NODE_ENV || 'development' 
  },
  // Optional: Add server/instance identifier
  serverId: { 
    type: String, 
    default: process.env.SERVER_ID || 'default' 
  }
}, { 
  timestamps: true,
  // Automatically remove logs older than 30 days (adjust as needed)
  expireAfterSeconds: 30 * 24 * 60 * 60 
});

// Compound indexes for common queries
logSchema.index({ date: -1, level: 1 });
logSchema.index({ levelName: 1, date: -1 });
logSchema.index({ source: 1, date: -1 });

// Static methods for common queries
logSchema.statics.findByLevel = function(levelName, limit = 100) {
  return this.find({ levelName })
    .sort({ date: -1 })
    .limit(limit);
};

logSchema.statics.findBySource = function(source, limit = 100) {
  return this.find({ source })
    .sort({ date: -1 })
    .limit(limit);
};

logSchema.statics.findByDateRange = function(startDate, endDate, limit = 1000) {
  return this.find({ 
    date: { 
      $gte: startDate, 
      $lte: endDate 
    } 
  })
    .sort({ date: -1 })
    .limit(limit);
};

logSchema.statics.findRecentLogs = function(limit = 500) {
  return this.find()
    .sort({ date: -1 })
    .limit(limit);
};

logSchema.statics.findErrorsAndFatals = function(limit = 100) {
  return this.find({ 
    $or: [
      { levelName: 'ERROR' },
      { levelName: 'FATAL' }
    ]
  })
    .sort({ date: -1 })
    .limit(limit);
};

module.exports = mongoose.model('Log', logSchema);