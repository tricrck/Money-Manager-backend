const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['contribution', 'meeting', 'loan_payment', 'loan_due'], 
    required: true 
  },
  title: { type: String, required: true },
  description: String,
  dueDate: { type: Date, required: true }, // Changed from startDate to dueDate for consistency
  endDate: Date,
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'missed', 'cancelled'], 
    default: 'pending' 
  },
  isRecurring: { type: Boolean, default: false },
  recurrencePattern: String, // e.g., "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1"
  originalEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  notificationSent: { type: Boolean, default: false },
  
  // Fine-related fields
  fine: {
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' },
    reason: String,
    appliedDate: Date,
    waived: { type: Boolean, default: false },
    waivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    waivedDate: Date,
    waivedReason: String,
    paid: { type: Boolean, default: false },
    paidDate: Date,
    paidAmount: { type: Number, default: 0 }
  },
  
  // Completion tracking
  completedDate: Date,
  completedAmount: Number, // For contribution/payment events
  
  // Grace period and late tracking
  gracePeriodHours: { type: Number, default: 24 }, // Grace period before fine is applied
  daysLate: { type: Number, default: 0 }
}, { timestamps: true });

// Method to apply fine for late events
EventSchema.methods.applyFine = function(fineRules) {
  if (this.status === 'completed' || this.fine.amount > 0) {
    return; // Already completed or fine already applied
  }
  
  const now = new Date();
  const gracePeriodEnd = new Date(this.dueDate.getTime() + (this.gracePeriodHours * 60 * 60 * 1000));
  
  if (now > gracePeriodEnd) {
    this.daysLate = Math.ceil((now - gracePeriodEnd) / (1000 * 60 * 60 * 24));
    
    let fineAmount = 0;
    let fineReason = '';
    
    // Apply fine based on event type and rules
    switch(this.type) {
      case 'contribution':
        fineAmount = fineRules.contribution?.baseAmount || 50;
        if (fineRules.contribution?.dailyRate) {
          fineAmount += (this.daysLate * fineRules.contribution.dailyRate);
        }
        fineReason = `Late contribution fine: ${this.daysLate} days late`;
        break;
        
      case 'loan_payment':
        fineAmount = fineRules.loanPayment?.baseAmount || 100;
        if (fineRules.loanPayment?.percentageOfAmount && this.description) {
          // Extract amount from description if available
          const match = this.description.match(/(\d+(?:\.\d+)?)/);
          if (match) {
            const paymentAmount = parseFloat(match[1]);
            fineAmount += (paymentAmount * (fineRules.loanPayment.percentageOfAmount / 100));
          }
        }
        fineReason = `Late loan payment fine: ${this.daysLate} days late`;
        break;
        
      case 'meeting':
        fineAmount = fineRules.meeting?.baseAmount || 20;
        fineReason = `Meeting absence fine`;
        break;
        
      default:
        fineAmount = fineRules.default?.baseAmount || 25;
        fineReason = `Late event fine: ${this.daysLate} days late`;
    }
    
    this.fine = {
      amount: Math.round(fineAmount * 100) / 100, // Round to 2 decimal places
      currency: 'KES',
      reason: fineReason,
      appliedDate: now,
      waived: false,
      paid: false,
      paidAmount: 0
    };
    
    this.status = 'missed';
  }
};

// Method to waive fine
EventSchema.methods.waiveFine = function(waivedBy, reason) {
  if (this.fine.amount > 0 && !this.fine.waived) {
    this.fine.waived = true;
    this.fine.waivedBy = waivedBy;
    this.fine.waivedDate = new Date();
    this.fine.waivedReason = reason;
  }
};

// Method to mark fine as paid
EventSchema.methods.payFine = function(amount) {
  if (this.fine.amount > 0 && !this.fine.paid) {
    this.fine.paidAmount = amount;
    this.fine.paid = amount >= this.fine.amount;
    this.fine.paidDate = new Date();
  }
};

module.exports = mongoose.model('Event', EventSchema);