const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      unique: true
    },
    groupType: {
      type: String,
      enum: ['chama', 'sacco', 'table_banking', 'investment_club'],
      required: true
    },
    description: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    admins: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    treasurer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    members: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      joinedDate: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['active', 'inactive', 'suspended'],
        default: 'active'
      },
      role: {
        type: String,
        enum: ['member', 'admin', 'treasurer', 'chair', 'secretary'],
        default: 'member'
      }
    }],
    loanAccount: {
      balance: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'KES'
      }
    },
    savingsAccount: {
      balance: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'KES'
      }
    },
    interestEarnedAccount: {
      balance: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'KES'
      }
    },
    finesAccount: {
      balance: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'KES'
      }
    },
    settings: {
      contributionSchedule: {
        frequency: {
          type: String,
          enum: ['weekly', 'biweekly', 'monthly'],
          default: 'monthly'
        },
        amount: {
          type: Number,
          default: 0
        },
        dueDay: Number // Day of week or month when contributions are due
      },
      loanSettings: {
        maxLoanMultiplier: {
          type: Number,
          default: 3 // e.g., 3x of savings
        },
        interestRate: {
          type: Number,
          default: 10 // 10%
        },
        maxRepaymentPeriod: {
          type: Number,
          default: 12 // months
        },
        latePaymentFee: {
          type: Number,
          default: 5 // percent
        },
        processingFee: {
          type: Number,
          default: 1 // percent
        },
        requiresGuarantors: {
          type: Boolean,
          default: true
        },
        guarantorsRequired: {
          type: Number,
          default: 2
        }
      },
      meetingSchedule: {
        frequency: {
          type: String,
          enum: ['weekly', 'biweekly', 'monthly'],
          default: 'monthly'
        },
        dayOfWeek: Number, // 0 = Sunday, 6 = Saturday
        dayOfMonth: Number,
        time: String // e.g. "18:00"
      }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }, { timestamps: true });

module.exports = mongoose.model('Group', GroupSchema);