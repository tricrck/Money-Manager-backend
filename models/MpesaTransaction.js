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
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending'
    },
    resultCode: Number,
    resultDesc: String,
    paymentPurpose: {
        type: String,
        enum: ['wallet_deposit', 'loan_repayment', 'contribution', 'membership_fee'],
        required: true
      },
    relatedItemId: {
        type: String,
        refPath: 'relatedItemModel'
      },
    relatedItemModel: {
        type: String,
        enum: ['Loan', 'Group', 'Wallet']
      },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: '24h' // Auto-delete pending transactions after 24 hours
    },
    completedAt: Date
  });
  
  const MpesaTransaction = mongoose.model('MpesaTransaction', mpesaTransactionSchema);

  module.exports = MpesaTransaction;