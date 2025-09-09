const mongoose = require('mongoose');
const Logger = require('../middleware/Logger.js');

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
WalletSchema.methods.updateBalance = async function(amount, type, session = null) {
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
  
  const saveOptions = session ? { session } : {};
  await this.save(saveOptions);
  return this.balance;
};

// Add method to update currency
WalletSchema.methods.updateCurrency = async function(newCurrency) {
  const supportedCurrencies = ['KES', 'USD', 'EUR', 'GBP'];

  if (!supportedCurrencies.includes(newCurrency.toUpperCase())) {
    throw new Error(`Unsupported currency: ${newCurrency}`);
  }

  this.currency = newCurrency.toUpperCase();
  await this.save();
  return this.currency;
};

// Enhanced Wallet Schema Methods
WalletSchema.methods.addTransaction = async function(transactionData, session = null) {
  const transaction = {
    type: transactionData.type,
    amount: transactionData.amount,
    relatedEntity: transactionData.relatedEntity,
    description: transactionData.description,
    paymentMethod: transactionData.paymentMethod || 'Internal',
    paymentReference: transactionData.paymentReference,
    date: transactionData.date || Date.now(),
    status: transactionData.status || 'completed'
  };

  this.transactions.push(transaction);
  
  // Update balance based on transaction type
  await this.updateBalance(transactionData.amount, transactionData.type, session);
  
  return transaction;
};

// Method to receive funds from group
WalletSchema.methods.receiveFundsFromGroup = async function(amount, groupId, description = 'Funds from group', session = null) {
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }

  const transaction = await this.addTransaction({
    type: 'deposit',
    amount: amount,
    relatedEntity: {
      entityType: 'group',
      entityId: groupId
    },
    description: description,
    paymentMethod: 'Internal'
  }, session);

  Logger.info(`Wallet ${this._id} received ${amount} from group ${groupId}`);

  return {
    success: true,
    newBalance: this.balance,
    transaction
  };
};

// Method to send funds to group
WalletSchema.methods.sendFundsToGroup = async function(amount, groupId, description = 'Payment to group') {
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }

  if (this.balance < amount) {
    throw new Error('Insufficient wallet balance');
  }

  const transaction = await this.addTransaction({
    type: 'withdrawal',
    amount: amount,
    relatedEntity: {
      entityType: 'group',
      entityId: groupId
    },
    description: description,
    paymentMethod: 'Internal'
  });

  return {
    success: true,
    newBalance: this.balance,
    transaction
  };
};



module.exports = mongoose.model('Wallet', WalletSchema);