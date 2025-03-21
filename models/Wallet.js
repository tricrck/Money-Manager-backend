const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  balance: { 
    type: Number, 
    default: 0,
    min: 0 // Prevent negative balances
  },
  currency: { 
    type: String, 
    default: 'KES' // Kenyan Shilling
  },
  transactions: [
    {
      type: { 
        type: String, 
        enum: ['deposit', 'withdrawal', 'loan_disbursement', 'loan_repayment', 'interest_payment', 'fine_payment', 'transfer'], 
        required: true 
      },
      amount: { 
        type: Number, 
        required: true 
      },
      relatedEntity: {
        entityType: { 
          type: String, 
          enum: ['loan', 'group', 'user', 'payment'] 
        },
        entityId: mongoose.Schema.Types.ObjectId
      },
      description: String,
      paymentMethod: {
        type: String,
        enum: ['M-Pesa', 'Stripe', 'Internal']
      },
      paymentReference: String,
      date: { 
        type: Date, 
        default: Date.now 
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'reversed'],
        default: 'completed'
      }
    }
  ]
}, { timestamps: true });

// Add method to update balance safely
WalletSchema.methods.updateBalance = async function(amount, type) {
  if (type === 'deposit' || type === 'loan_disbursement' || 
      (type === 'transfer' && amount > 0)) {
    this.balance += amount;
  } else if ((type === 'withdrawal' || type === 'loan_repayment' || 
             type === 'interest_payment' || type === 'fine_payment' ||
             (type === 'transfer' && amount < 0)) && 
             this.balance >= Math.abs(amount)) {
    this.balance -= Math.abs(amount);
  } else {
    throw new Error('Insufficient funds');
  }
  
  await this.save();
  return this.balance;
};


module.exports = mongoose.model('Wallet', WalletSchema);