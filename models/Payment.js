const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['Stripe', 'M-Pesa'] // Limiting to only M-Pesa and Stripe
  },
  amount: {
    type: Number,
    required: true,
    min: 1 // Minimum payment amount
  },
  currency: {
    type: String,
    required: true,
    default: 'KES', // Default to Kenyan Shillings
    enum: ['KES', 'USD'] // M-Pesa uses KES, Stripe can use USD
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'success', 'failed', 'refunded'],
    default: 'pending'
  },
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
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
  description: {
    type: String
  },
  receiptNumber: {
    type: String
  },
  failureReason: {
    type: String
  },
  metadata: {
    type: Object,
    default: {}
  }
}, { timestamps: true });

// Create indexes for faster lookups
PaymentSchema.index({ userId: 1, transactionId: 1 });
PaymentSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);