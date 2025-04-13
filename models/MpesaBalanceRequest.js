const mongoose = require('mongoose');
const REQUEST_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  TIMEOUT: 'timeout'
};

// Schema for M-Pesa Balance Requests
const mpesaBalanceRequestSchema = new mongoose.Schema({
  // Unique identifier for the request
  originatorConversationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Request details
  initiator: {
    type: String,
    required: true
  },
  
  // Status of the request
  status: {
    type: String,
    enum: Object.values(REQUEST_STATUS),
    default: REQUEST_STATUS.PENDING
  },
  
  // Balance information
  balanceInfo: {
    workingAccountAvailableFunds: {
      type: Number,
      default: null
    },
    actualBalance: {
      type: Number,
      default: null
    },
    currency: {
      type: String,
      default: 'KES'
    }
  },
  
  // Error information if request fails
  errorDetails: {
    resultCode: {
      type: String,
      default: null
    },
    resultDescription: {
      type: String,
      default: null
    }
  },
  
  // Timeout information
  timeoutDetails: {
    type: Object,
    default: null
  },
  
  // Timestamps
  requestedAt: {
    type: Date,
    default: Date.now
  },
  
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Create indexes for performance
mpesaBalanceRequestSchema.index({ 
  originatorConversationId: 1, 
  status: 1, 
  requestedAt: -1 
});



// Method to update request with result
mpesaBalanceRequestSchema.methods.updateWithResult = function(resultParams) {
  if (resultParams.ResultCode === 0) {
    // Successful request
    const balanceInfo = {};
    if (Array.isArray(resultParams.ResultParameters.ResultParameter)) {
      resultParams.ResultParameters.ResultParameter.forEach(item => {
        balanceInfo[item.Key] = item.Value;
      });
    }

    this.status = REQUEST_STATUS.SUCCESS;
    this.balanceInfo = {
      workingAccountAvailableFunds: parseFloat(balanceInfo.WorkingAccountAvailableFunds || 0),
      actualBalance: parseFloat(balanceInfo.AccountBalance || 0),
      currency: 'KES'
    };
    this.completedAt = new Date();
  } else {
    // Failed request
    this.status = REQUEST_STATUS.FAILED;
    this.errorDetails = {
      resultCode: resultParams.ResultCode,
      resultDescription: resultParams.ResultDesc
    };
    this.completedAt = new Date();
  }

  return this.save();
};

// Method to mark as timeout
mpesaBalanceRequestSchema.methods.markAsTimeout = function(timeoutData) {
  this.status = REQUEST_STATUS.TIMEOUT;
  this.timeoutDetails = timeoutData;
  this.completedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('MpesaBalanceRequest', mpesaBalanceRequestSchema);