const mongoose = require('mongoose');

const mpesaTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  merchantRequestId: String,
  checkoutRequestId: String,
  transactionId: String, // M-Pesa receipt number when completed
  originatorConversationId: String,
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout'],
    default: 'pending'
  },
  resultCode: Number,
  resultDesc: String,
  
  // Enhanced payment purpose to include withdrawal
  paymentPurpose: {
    type: String,
    enum: [
      'wallet_deposit', 
      'loan_repayment', 
      'contribution', 
      'membership_fee',
      'withdrawal', // New withdrawal type
      'salary_payment',
      'business_payment',
      'promotion_payment'
    ],
    required: true
  },
  
  // Withdrawal-specific fields
  withdrawalDetails: {
    commandId: {
      type: String,
      enum: ['BusinessPayment', 'SalaryPayment', 'PromotionPayment']
    },
    initiatorName: String,
    securityCredential: String,
    workingAccountBalance: String,
    transactionReceipt: String,
    receiverPartyPublicName: String
  },
  
  relatedItemId: {
    type: String,
    refPath: 'relatedItemModel'
  },
  relatedItemModel: {
    type: String,
    enum: ['Loan', 'Group', 'Wallet', 'Withdrawal', 'Order']
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '24h' // Auto-delete pending transactions after 24 hours
  },
  completedAt: Date,
  
  // Additional metadata for tracking
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  indexes: [
    { fields: { userId: 1, status: 1, createdAt: -1 } },
    { fields: { phoneNumber: 1, status: 1 } },
    { fields: { merchantRequestId: 1 } },
    { fields: { checkoutRequestId: 1 } }
  ]
});

// Method to update withdrawal transaction
mpesaTransactionSchema.methods.updateWithdrawalStatus = function(resultData) {
  const resultCode = resultData.ResultCode;
  const resultParams = resultData.ResultParameters?.ResultParameter || [];

  // Convert array of parameters to an object
  const params = resultParams.reduce((acc, param) => {
    acc[param.Key] = param.Value;
    return acc;
  }, {});

  // Update transaction details
  this.resultCode = resultCode;
  this.resultDesc = resultData.ResultDesc;

  if (resultCode === 0) {
    // Successful transaction
    this.status = 'completed';
    this.transactionId = params.TransactionID;
    this.completedAt = new Date(params.TransactionCompletedDateTime || Date.now());
    
    // Update withdrawal details
    this.withdrawalDetails = {
      ...this.withdrawalDetails,
      workingAccountBalance: params.WorkingAccountBalance,
      transactionReceipt: params.TransactionReceipt,
      receiverPartyPublicName: params.ReceiverPartyPublicName
    };
  } else {
    // Failed transaction
    this.status = 'failed';
  }

  return this.save();
};

// Method to mark transaction as timed out
mpesaTransactionSchema.methods.markAsTimeout = function() {
  this.status = 'timeout';
  this.resultDesc = 'Transaction timed out';
  return this.save();
};
// Add this method to the mpesaTransactionSchema
mpesaTransactionSchema.methods.updateStatus = function(Result) {
  // Destructure result parameters
  const { 
    ResultType, 
    ResultCode, 
    ResultDesc, 
    ConversationID, 
    TransactionID,
    ResultParameters,
    ReferenceData
  } = Result;

  // Set basic result information
  this.resultCode = ResultCode;
  this.resultDesc = ResultDesc;

  // Process result parameters if they exist
  const resultParams = ResultParameters?.ResultParameter || [];
  const paramsMap = resultParams.reduce((acc, param) => {
    acc[param.Key] = param.Value;
    return acc;
  }, {});

  // Determine status based on result code
  if (ResultCode === 0) {
    // Successful transaction
    this.status = 'completed';
    this.transactionId = TransactionID || paramsMap.TransactionID;
    this.completedAt = new Date();

    // Update additional details from result parameters
    if (this.paymentPurpose === 'withdrawal') {
      this.withdrawalDetails = {
        ...this.withdrawalDetails,
        workingAccountBalance: paramsMap.WorkingAccountBalance,
        transactionReceipt: paramsMap.TransactionReceipt,
        receiverPartyPublicName: paramsMap.ReceiverPartyPublicName
      };
    }
  } else if (ResultCode === 1032) {
    // Specific timeout scenario
    this.status = 'timeout';
  } else {
    // Failed transaction
    this.status = 'failed';
  }

  // Store additional metadata
  this.metadata = {
    ...this.metadata,
    conversationId: ConversationID,
    referenceData: ReferenceData
  };

  // Save and return the updated transaction
  return this.save();
};

const MpesaTransaction = mongoose.model('MpesaTransaction', mpesaTransactionSchema);

module.exports = MpesaTransaction;