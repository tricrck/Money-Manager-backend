const mongoose = require('mongoose');

// Chama-specific data schema
const ChamaDataSchema = new mongoose.Schema({
  currentCycle: { type: Number, default: 1 },
  currentRecipientIndex: { type: Number, default: 0 },
  cycleHistory: [{
    cycleNumber: Number,
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amountPaid: Number,
    datePaid: Date,
    completed: { type: Boolean, default: false }
  }],
  payoutOrder: [{
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    position: Number,
    hasPaidOut: { type: Boolean, default: false },
    payoutDate: Date,
    amount: Number
  }],
  cycleSettings: {
    shuffleOrder: { type: Boolean, default: false },
    allowEmergencyPayouts: { type: Boolean, default: true },
    penaltyAmount: { type: Number, default: 0 }
  }
}, { _id: false });

// SACCO-specific data schema
const SaccoDataSchema = new mongoose.Schema({
  registrationNumber: String,
  licenseNumber: String,
  fosaBranchCode: String,
  shareCapitalAccount: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' },
    totalShares: { type: Number, default: 0 },
    shareValue: { type: Number, default: 100 }
  },
  dividendAccount: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' },
    lastDividendRate: { type: Number, default: 0 },
    lastDistributionDate: Date
  },
  statutoryReserveAccount: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' }
  },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    memberNumber: String,
    sharesPurchased: { type: Number, default: 0 },
    dividendsEarned: { type: Number, default: 0 },
    accountType: {
      type: String,
      enum: ['BOSA', 'FOSA', 'BOTH'],
      default: 'BOSA'
    }
  }],
  boardOfDirectors: [{
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    position: {
      type: String,
      enum: ['chairman', 'vice_chairman', 'secretary', 'treasurer', 'director']
    },
    appointedDate: Date,
    termEndDate: Date
  }],
  auditHistory: [{
    auditor: String,
    auditDate: Date,
    findings: String,
    recommendations: String,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed']
    }
  }]
}, { _id: false });

// Table Banking-specific data schema
const TableBankingDataSchema = new mongoose.Schema({
  meetingHistory: [{
    meetingNumber: Number,
    date: Date,
    attendance: [{
      member: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      present: Boolean,
      contributionPaid: Boolean,
      amount: Number
    }],
    lendingRounds: [{
      roundNumber: Number,
      borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      amountRequested: Number,
      biddedInterestRate: Number,
      amountApproved: Number,
      guarantors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    }],
    totalFundsAvailable: Number,
    totalLent: Number,
    chairperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  socialRules: {
    attendanceRequirement: { type: Number, default: 0.8 }, // 80%
    penaltyForAbsence: { type: Number, default: 200 }, // KES
    maxConsecutiveAbsences: { type: Number, default: 2 },
    latePaymentPenalty: { type: Number, default: 0.05 } // 5%
  },
  currentMeeting: {
    fundsAvailable: Number,
    lendingInProgress: Boolean,
    currentRound: Number
  }
}, { _id: false });

// Investment Club-specific data schema
const InvestmentClubDataSchema = new mongoose.Schema({
  investmentAccount: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' }
  },
  portfolio: [{
    investmentType: {
      type: String,
      enum: ['money_market_fund', 'government_bonds', 'corporate_bonds', 'equity_fund', 'real_estate', 'treasury_bills']
    },
    provider: String,
    amount: Number,
    purchaseDate: Date,
    currentValue: Number,
    maturityDate: Date,
    expectedReturn: Number,
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high']
    }
  }],
  investmentCommittee: [{
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: {
      type: String,
      enum: ['chairman', 'secretary', 'member']
    },
    expertise: String,
    appointedDate: Date
  }],
  performanceHistory: [{
    period: String, // Q1 2024, Q2 2024, etc.
    openingBalance: Number,
    closingBalance: Number,
    totalReturns: Number,
    returnRate: Number,
    dividendsDistributed: Number,
    managementFees: Number,
    reportDate: Date
  }],
  investmentStrategy: {
    riskTolerance: {
      type: String,
      enum: ['conservative', 'moderate', 'aggressive'],
      default: 'moderate'
    },
    diversificationRules: {
      maxSingleInvestment: { type: Number, default: 0.25 },
      minInvestmentTypes: { type: Number, default: 3 }
    },
    targetReturns: {
      annualTarget: Number,
      benchmarkIndex: String
    }
  },
  managementFeeAccount: {
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' },
    feeRate: { type: Number, default: 0.02 } // 2% annually
  }
}, { _id: false });

module.exports = {
  ChamaDataSchema,
  SaccoDataSchema,
  TableBankingDataSchema,
  InvestmentClubDataSchema
};
