const mongoose = require('mongoose');

const LoanSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  group: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Group'
  },
  loanType: {
    type: String,
    enum: ['personal', 'group', 'emergency', 'business'],
    default: 'personal'
  },
  principalAmount: { 
    type: Number, 
    required: true,
    min: 100 // Minimum loan amount in KES
  },
  disbursedAmount: {
    type: Number
  },
  repaymentPeriod: { 
    type: Number, 
    required: true // in months
  },
  interestRate: { 
    type: Number, 
    default: 10, // Default 10% interest rate
    min: 0,
    max: 100
  },
  interestType: {
    type: String,
    enum: ['simple', 'compound', 'reducing_balance'],
    default: 'simple'
  },
  processingFee: {
    type: Number,
    default: 0
  },
  totalRepayableAmount: {
    type: Number // Calculated field: principal + interest + fees
  },
  amountRepaid: {
    type: Number,
    default: 0
  },
  nextPaymentDue: {
    amount: Number,
    dueDate: Date
  },
  repaymentSchedule: [{
    installmentNumber: Number,
    dueDate: Date,
    totalAmount: Number,
    principalAmount: Number,
    interestAmount: Number,
    paid: {
      type: Boolean,
      default: false
    },
    paidDate: Date,
    paidAmount: {
      type: Number,
      default: 0
    },
    lateFee: {
      type: Number,
      default: 0
    }
  }],
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'disbursed', 'active', 'completed', 'defaulted', 'rejected'], 
    default: 'pending' 
  },
  applicationDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: Date,
  disbursementDate: Date,
  completionDate: Date,
  guarantors: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approved: {
      type: Boolean,
      default: false
    },
    approvalDate: Date
  }],
  purpose: {
    type: String
  },
  collateral: {
    description: String,
    value: Number,
    documents: [String] // URLs to uploaded collateral documents
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: String,
  notes: [{ 
    text: String, 
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Method to calculate loan repayment schedule
LoanSchema.methods.calculateRepaymentSchedule = function() {
  const principal = this.principalAmount;
  const ratePerMonth = this.interestRate / 100 / 12;
  const term = this.repaymentPeriod;
  const processingFee = this.processingFee || 0;
  let totalRepayable = 0;
  
  // Create repayment schedule based on interest type
  let schedule = [];
  const disbursementDate = this.disbursementDate || new Date();
  
  if (this.interestType === 'simple') {
    // Simple interest calculation
    const totalInterest = principal * (this.interestRate / 100) * (term / 12);
    totalRepayable = principal + totalInterest + processingFee;
    const monthlyPayment = totalRepayable / term;
    
    for (let i = 1; i <= term; i++) {
      const dueDate = new Date(disbursementDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      
      schedule.push({
        installmentNumber: i,
        dueDate,
        totalAmount: monthlyPayment,
        principalAmount: principal / term,
        interestAmount: totalInterest / term,
        paid: false,
        paidAmount: 0,
        lateFee: 0
      });
    }
  } else if (this.interestType === 'reducing_balance') {
    // Reducing balance / amortized loan calculation
    if (ratePerMonth > 0) {
      const monthlyPayment = principal * (ratePerMonth * Math.pow(1 + ratePerMonth, term)) / 
                           (Math.pow(1 + ratePerMonth, term) - 1);
      
      let remainingPrincipal = principal;
      
      for (let i = 1; i <= term; i++) {
        const interestForMonth = remainingPrincipal * ratePerMonth;
        const principalForMonth = monthlyPayment - interestForMonth;
        remainingPrincipal -= principalForMonth;
        
        const dueDate = new Date(disbursementDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        schedule.push({
          installmentNumber: i,
          dueDate,
          totalAmount: monthlyPayment,
          principalAmount: principalForMonth,
          interestAmount: interestForMonth,
          paid: false,
          paidAmount: 0,
          lateFee: 0
        });
        
        totalRepayable += monthlyPayment;
      }
      
      totalRepayable += processingFee;
    } else {
      // If interest rate is 0, equal principal payments
      const monthlyPayment = principal / term;
      
      for (let i = 1; i <= term; i++) {
        const dueDate = new Date(disbursementDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        schedule.push({
          installmentNumber: i,
          dueDate,
          totalAmount: monthlyPayment,
          principalAmount: monthlyPayment,
          interestAmount: 0,
          paid: false,
          paidAmount: 0,
          lateFee: 0
        });
      }
      
      totalRepayable = principal + processingFee;
    }
  }
  
  this.repaymentSchedule = schedule;
  this.totalRepayableAmount = totalRepayable;
  return schedule;
};


module.exports = mongoose.model('Loan', LoanSchema);
