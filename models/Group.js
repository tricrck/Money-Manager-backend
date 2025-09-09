const mongoose = require('mongoose');
const GroupTypePolicies = require('../controllers/GroupTypePolicies.js');
const { ChamaDataSchema, SaccoDataSchema, TableBankingDataSchema, InvestmentClubDataSchema } = require('./Policies.js');
const Wallet = require('./Wallet');
const Logger = require('../middleware/Logger.js');

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
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended', 'pending'],
        default: 'active'
      },
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
      },
      // Track individual member contributions
      contributions: {
        total: {
          type: Number,
          default: 0
        },
        history: [{
          amount: {
            type: Number,
            required: true
          },
          date: {
            type: Date,
            default: Date.now
          },
          method: {
            type: String,
            enum: ['wallet', 'cash', 'bank_transfer', 'mobile_money'],
            required: true
          },
          verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
          },
          notes: String,
          reference: String,
          status: {
            type: String,
            enum: ['pending', 'verified', 'rejected'],
            default: 'verified'
          }
        }]
      }
    }],
    // New: Group invitations sent to users
    invitations: [{
      invitedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      role: {
        type: String,
        enum: ['member', 'admin', 'treasurer', 'chair', 'secretary'],
        default: 'member'
      },
      status: {
        type: String,
        enum: ['pending', 'accepted', 'declined', 'expired'],
        default: 'pending'
      },
      invitedAt: {
        type: Date,
        default: Date.now
      },
      respondedAt: Date,
      expiresAt: {
        type: Date,
        default: function() {
          return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
        }
      },
      message: String // Optional message from inviter
    }],
    // New: Join requests from users wanting to join
    joinRequests: [{
      requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      requestedAt: {
        type: Date,
        default: Date.now
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reviewedAt: Date,
      message: String, // Optional message from requester
      reviewNote: String // Optional note from reviewer
    }],
    // Group privacy settings
    privacy: {
      type: String,
      enum: ['public', 'private', 'invite_only'],
      default: 'private'
    },
    // Group-type specific data
    chamaData: ChamaDataSchema,
    saccoData: SaccoDataSchema,
    tableBankingData: TableBankingDataSchema,
    investmentClubData: InvestmentClubDataSchema,
    // Common financial accounts for the group
    groupAccount: {
      balance: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'KES'
      }
    },
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
    // Track all transactions for the group
    transactions: [{
      type: {
        type: String,
        enum: ['contribution', 'loan_disbursement', 'loan_repayment', 'interest_payment', 'fine_payment', 'expense', 'dividend', 'wallet_funding'],
        required: true
      },
      amount: {
        type: Number,
        required: true
      },
      date: {
        type: Date,
        default: Date.now
      },
      member: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      method: {
        type: String,
        enum: ['wallet', 'cash', 'bank_transfer', 'mobile_money'],
        required: true
      },
      description: String,
      reference: String,
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      affectedAccount: {
        type: String,
        enum: ['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount', 'groupAccount'],
        required: true
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'rejected'],
        default: 'completed'
      }
    }],
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
        dueDay: Number 
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
        time: String, // e.g. "18:00"
        venue: {
          type: String,
          default: 'Office'
        }
      }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }, { timestamps: true });

GroupSchema.methods.initializeTypeData = async function() {
  const policies = GroupTypePolicies.getPolicies(this.groupType);
  
  switch (this.groupType) {
    case 'chama':
      if (!this.chamaData || Object.keys(this.chamaData).length === 0) {
        this.chamaData = {
          currentCycle: 1,
          currentRecipientIndex: 0,
          cycleHistory: [],
          payoutOrder: this.members.map((member, index) => ({
            memberId: member.user,
            position: index + 1,
            hasPaidOut: false
          })),
          cycleSettings: {
            shuffleOrder: false,
            allowEmergencyPayouts: policies.allowEmergencyPayouts || false,
            penaltyAmount: policies.penaltyForMissedContribution || 500
          }
        };
      }
      break;
      
    case 'sacco':
      if (!this.saccoData || Object.keys(this.saccoData).length === 0) {
        this.saccoData = {
          shareCapitalAccount: {
            balance: 0,
            currency: 'KES',
            totalShares: 0,
            shareValue: policies.minShareValue || 100
          },
          dividendAccount: {
            balance: 0,
            currency: 'KES',
            lastDividendRate: 0
          },
          statutoryReserveAccount: {
            balance: 0,
            currency: 'KES'
          },
          members: [],
          boardOfDirectors: [],
          auditHistory: []
        };
      }
      break;
      
    case 'table_banking':
      if (!this.tableBankingData || Object.keys(this.tableBankingData).length === 0) {
        this.tableBankingData = {
          meetingHistory: [],
          socialRules: {
            attendanceRequirement: policies.meetingAttendanceRequired || 0.8,
            penaltyForAbsence: policies.penaltyForMissedMeeting || 200,
            maxConsecutiveAbsences: 2,
            latePaymentPenalty: policies.penaltyForLatePayment || 0.05
          },
          currentMeeting: {
            fundsAvailable: 0,
            lendingInProgress: false,
            currentRound: 0
          }
        };
      }
      break;
      
    case 'investment_club':
      if (!this.investmentClubData || Object.keys(this.investmentClubData).length === 0) {
        this.investmentClubData = {
          investmentAccount: {
            balance: 0,
            currency: 'KES'
          },
          portfolio: [],
          investmentCommittee: [],
          performanceHistory: [],
          investmentStrategy: {
            riskTolerance: 'moderate',
            diversificationRules: {
              maxSingleInvestment: policies.maxSingleInvestmentRatio || 0.25,
              minInvestmentTypes: 3
            },
            targetReturns: {
              annualTarget: 12,
              benchmarkIndex: 'NSE20'
            }
          },
          managementFeeAccount: {
            balance: 0,
            currency: 'KES',
            feeRate: policies.managementFee || 0.02
          }
        };
      }
      break;
  }
  
  await this.save();
  return this;
};

// Pre-save middleware to initialize group-type-specific data
GroupSchema.pre('save', async function(next) {
  if (this.isNew) {
    const policies = GroupTypePolicies.getPolicies(this.groupType);
    
    // Initialize group-type-specific data structures
    switch (this.groupType) {
      case 'chama':
        this.chamaData = {
          currentCycle: 1,
          currentRecipientIndex: 0,
          cycleHistory: [],
          payoutOrder: this.members.map((member, index) => ({
            memberId: member.user,
            position: index + 1,
            hasPaidOut: false
          })),
          cycleSettings: {
            shuffleOrder: false,
            allowEmergencyPayouts: policies.allowEmergencyPayouts,
            penaltyAmount: policies.penaltyForMissedContribution
          }
        };
        break;
        
      case 'sacco':
        this.saccoData = {
          shareCapitalAccount: {
            balance: 0,
            currency: 'KES',
            totalShares: 0,
            shareValue: policies.minShareValue || 100
          },
          dividendAccount: {
            balance: 0,
            currency: 'KES',
            lastDividendRate: 0
          },
          statutoryReserveAccount: {
            balance: 0,
            currency: 'KES'
          },
          members: [],
          boardOfDirectors: [],
          auditHistory: []
        };
        break;
        
      case 'table_banking':
        this.tableBankingData = {
          meetingHistory: [],
          socialRules: {
            attendanceRequirement: policies.meetingAttendanceRequired || 0.8,
            penaltyForAbsence: policies.penaltyForMissedMeeting || 200,
            maxConsecutiveAbsences: 2,
            latePaymentPenalty: policies.penaltyForLatePayment || 0.05
          },
          currentMeeting: {
            fundsAvailable: 0,
            lendingInProgress: false,
            currentRound: 0
          }
        };
        break;
        
      case 'investment_club':
        this.investmentClubData = {
          investmentAccount: {
            balance: 0,
            currency: 'KES'
          },
          portfolio: [],
          investmentCommittee: [],
          performanceHistory: [],
          investmentStrategy: {
            riskTolerance: 'moderate',
            diversificationRules: {
              maxSingleInvestment: policies.maxSingleInvestmentRatio || 0.25,
              minInvestmentTypes: 3
            },
            targetReturns: {
              annualTarget: 12, // 12% annual target
              benchmarkIndex: 'NSE20'
            }
          },
          managementFeeAccount: {
            balance: 0,
            currency: 'KES',
            feeRate: policies.managementFee || 0.02
          }
        };
        break;
    }
    
    // Set default loan settings based on group type
    this.settings.loanSettings = {
      ...this.settings.loanSettings,
      ...policies.loanEligibility
    };
  }
  
  next();
});

// Method  to Process Group internal transfers
GroupSchema.methods.processTransfer = async function(fromAccountType, toAccountType, amount, verifiedBy) {
  if (!this[fromAccountType] || !this[toAccountType]) {
    throw new Error('Invalid account type specified');
  }

  if (this[fromAccountType].balance < amount) {
    throw new Error('Insufficient funds in the source account');
  }

  // Transfer logic
  this[fromAccountType].balance -= amount;
  this[toAccountType].balance += amount;

  // Add transaction records (two records to track movement if needed)
  this.transactions.push({
    type: 'expense',
    amount,
    date: new Date(),
    method: 'wallet',
    description: `Transfer from ${fromAccountType} to ${toAccountType}`,
    verifiedBy,
    affectedAccount: fromAccountType,
    status: 'completed'
  });

  this.transactions.push({
    type: 'contribution',
    amount,
    date: new Date(),
    method: 'wallet',
    description: `Transfer into ${toAccountType} from ${fromAccountType}`,
    verifiedBy,
    affectedAccount: toAccountType,
    status: 'completed'
  });

  await this.save();

  return {
    success: true,
    fromAccountBalance: this[fromAccountType].balance,
    toAccountBalance: this[toAccountType].balance
  };
};

// Method to add a contribution from a member's wallet
GroupSchema.methods.addWalletContribution = async function(memberId, totalAmount, verifiedBy, allocations) {
  try {
    const policies = GroupTypePolicies.getPolicies(this.groupType);
    
    // Validate contribution against group policies
    const validation = GroupTypePolicies.validateOperation(this.groupType, 'contribution', {
      amount: totalAmount,
      expectedAmount: this.settings.contributionSchedule.amount,
      standardAmount: this.settings.contributionSchedule.amount,
      allowPartial: policies.allowPartialContributions
    });
    
    if (!validation.valid) {
      throw new Error(validation.validations[0].message);
    }
    
    const memberIndex = this.members.findIndex(m => m.user.toString() === memberId);
    if (memberIndex === -1) throw new Error('Member not found in this group');

    // Process allocations
    let totalAllocated = 0;
    for (const alloc of allocations) {
      const { account, amount } = alloc;
      if (!this[account]) throw new Error(`Invalid account specified: ${account}`);
      this[account].balance += amount;
      totalAllocated += amount;

      this.transactions.push({
        type: 'contribution',
        amount,
        date: Date.now(),
        member: memberId,
        method: 'wallet',
        description: `Wallet contribution to ${account}`,
        verifiedBy,
        affectedAccount: account,
        status: 'completed'
      });
    }

    if (totalAllocated !== totalAmount) {
      throw new Error('Total allocation does not match the contribution amount');
    }

    // Add to member contribution history
    const contributionRecord = {
      amount: totalAmount,
      date: Date.now(),
      method: 'wallet',
      verifiedBy,
      notes: JSON.stringify(allocations),
      status: 'verified',
      allocations
    };

    if (!this.members[memberIndex].contributions) {
      this.members[memberIndex].contributions = { total: 0, history: [] };
    }

    this.members[memberIndex].contributions.history.push(contributionRecord);
    this.members[memberIndex].contributions.total += totalAmount;

    // Apply group-type-specific business logic
    const businessLogic = GroupTypePolicies.applyBusinessLogic(
      this.groupType, 
      'contribution', 
      this, 
      { memberId, amount: totalAmount }
    );

    let additionalResults = {};
    
    // Handle Chama payout logic
    // if (this.groupType === 'chama' && businessLogic?.action === 'payout') {
    //   additionalResults = await this.processChamaPayout(businessLogic);
    // }
    
    // Handle SACCO dividend calculations
    if (this.groupType === 'sacco') {
      additionalResults = await this.updateSaccoMemberData(memberId, totalAmount);
    }

    await this.save();

    return {
      success: true,
      newBalanceSummary: {
        savings: this.savingsAccount.balance,
        loan: this.loanAccount.balance,
        group: this.groupAccount.balance
      },
      contribution: contributionRecord,
      ...additionalResults
    };
  } catch (error) {
    throw error;
  }
};



// Method to record a cash contribution
GroupSchema.methods.addCashContribution = async function(memberId, amount, verifiedBy, notes, reference) {
  try {
    // Find the member in the group
    const memberIndex = this.members.findIndex(m => m.user.toString() === memberId);
    if (memberIndex === -1) {
      throw new Error('Member not found in this group');
    }

    // Create a new contribution record
    const contributionRecord = {
      amount,
      date: Date.now(),
      method: 'cash',
      verifiedBy,
      notes,
      reference,
      status: 'verified'
    };

    // Add to member's contributions history
    if (!this.members[memberIndex].contributions) {
      this.members[memberIndex].contributions = { total: 0, history: [] };
    }

    this.members[memberIndex].contributions.history.push(contributionRecord);
    this.members[memberIndex].contributions.total += amount;

    // Add to group transactions
    this.transactions.push({
      type: 'contribution',
      amount,
      date: Date.now(),
      member: memberId,
      method: 'cash',
      description: notes || 'Cash contribution',
      reference,
      verifiedBy,
      affectedAccount: 'savingsAccount',
      status: 'completed'
    });

    // Update the savings account balance
    this.savingsAccount.balance += amount;

    // Save the changes
    await this.save();
    return {
      success: true,
      newBalance: this.savingsAccount.balance,
      contribution: contributionRecord
    };
  } catch (error) {
    throw error;
  }
};

// Method to record a mobile money contribution
GroupSchema.methods.addMobileMoneyContribution = async function(memberId, amount, verifiedBy, notes, reference) {
  try {
    // Find the member in the group
    const memberIndex = this.members.findIndex(m => m.user.toString() === memberId);
    if (memberIndex === -1) {
      throw new Error('Member not found in this group');
    }

    // Create a new contribution record
    const contributionRecord = {
      amount,
      date: Date.now(),
      method: 'mobile_money',
      verifiedBy,
      notes,
      reference,
      status: 'verified'
    };

    // Add to member's contributions history
    if (!this.members[memberIndex].contributions) {
      this.members[memberIndex].contributions = { total: 0, history: [] };
    }

    this.members[memberIndex].contributions.history.push(contributionRecord);
    this.members[memberIndex].contributions.total += amount;

    // Add to group transactions
    this.transactions.push({
      type: 'contribution',
      amount,
      date: Date.now(),
      member: memberId,
      method: 'mobile_money',
      description: notes || 'Mobile money contribution',
      reference,
      verifiedBy,
      affectedAccount: 'savingsAccount',
      status: 'completed'
    });

    // Update the savings account balance
    this.savingsAccount.balance += amount;

    // Save the changes
    await this.save();
    return {
      success: true,
      newBalance: this.savingsAccount.balance,
      contribution: contributionRecord
    };
  } catch (error) {
    throw error;
  }
};
// Inside GroupSchema.methods
GroupSchema.methods.fundWallet = async function(userId, amount, initiatedBy, account, description = 'Wallet funding', session = null) {
   try {
    // Validate account
    if (!['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount', 'groupAccount'].includes(account)) {
      throw new Error('Invalid source account');
    }

    // Check group balance
    if (this[account].balance < amount) {
      throw new Error(`Insufficient balance in ${account}`);
    }

    // Find user's wallet
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      // Create wallet if it doesn't exist
      wallet = new Wallet({ user: userId });
      await wallet.save();
    }

    Logger.info(`Funding wallet for user ${userId} from group ${this._id} account ${account} by ${initiatedBy}`);

    // Update user's wallet (add funds)
    await wallet.receiveFundsFromGroup(amount, this._id, description, session);

    Logger.info(`Wallet funded. New wallet balance: ${wallet.balance}`);

    // Deduct from group account
    this[account].balance -= amount;

    // Add transaction record to group
    this.transactions.push({
      type: 'wallet_funding',
      amount,
      date: Date.now(),
      member: userId,
      method: 'wallet',
      description,
      verifiedBy: initiatedBy,
      affectedAccount: account,
      status: 'completed'
    });

    // Save group changes
    await this.save();
    return {
      success: true,
      groupAccountBalance: this[account].balance,
      userWalletBalance: wallet.balance
    };

  } catch (error) {
    // Rollback on error
    throw error;
  }
};

GroupSchema.methods.recordCashPayment = async function(userId, amount, verifiedBy, notes = '', account) {
  session.startTransaction();

  try {
    // Validate account
    if (!['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount', 'groupAccount'].includes(account)) {
      throw new Error('Invalid account specified');
    }

    // Check group balance
    if (this[account].balance < amount) {
      throw new Error(`Insufficient funds in ${account}`);
    }

    // Find or create user's wallet
    let wallet = await Wallet.findOne({ user: userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ user: userId });
      await wallet.save({ session });
    }

    // Add funds to user's wallet
    await wallet.receiveFundsFromGroup(amount, this._id, notes || 'Cash payment from group');

    // Deduct from group account
    this[account].balance -= amount;

    // Record transaction in group
    this.transactions.push({
      type: 'expense',
      amount,
      date: Date.now(),
      member: userId,
      method: 'cash',
      description: notes || 'Cash payment to member wallet',
      verifiedBy,
      affectedAccount: account,
      status: 'completed'
    });

    await this.save({ session });
    await session.commitTransaction();

    return {
      success: true,
      newGroupBalance: this[account].balance,
      newWalletBalance: wallet.balance
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
// Method to get member contribution summary
GroupSchema.methods.getMemberContributionSummary = function(memberId) {
  // Find the member in the group
  const member = this.members.find(m => m.user.toString() === memberId);
  if (!member) {
    throw new Error('Member not found in this group');
  }

  if (!member.contributions) {
    return { total: 0, history: [] };
  }

  return member.contributions;
};

// Method to get all contributions for the group
GroupSchema.methods.getAllContributions = function() {
  return this.transactions.filter(transaction => transaction.type === 'contribution');
};

// New method to send invitation to user
GroupSchema.methods.sendInvitation = async function(invitedUserId, invitedBy, role = 'member', message = '') {
  try {
    // Check if user is already a member
    const existingMember = this.members.find(m => m.user.toString() === invitedUserId);
    if (existingMember) {
      throw new Error('User is already a member of this group');
    }

    // Check if there's already a pending invitation
    const existingInvitation = this.invitations.find(inv => 
      inv.invitedUser.toString() === invitedUserId && inv.status === 'pending'
    );
    if (existingInvitation) {
      throw new Error('User already has a pending invitation to this group');
    }

    // Create new invitation
    const invitation = {
      invitedUser: invitedUserId,
      invitedBy,
      role,
      message,
      status: 'pending',
      invitedAt: Date.now(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    };

    this.invitations.push(invitation);
    await this.save();
    
    return invitation;
  } catch (error) {
    throw error;
  }
};

// New method to accept invitation
GroupSchema.methods.acceptInvitation = async function(userId) {
  try {
    // Find the pending invitation
    const invitationIndex = this.invitations.findIndex(inv => 
      inv.invitedUser.toString() === userId && inv.status === 'pending'
    );
    if (invitationIndex === -1) {
      throw new Error('No pending invitation found for this user');
    }

    const invitation = this.invitations[invitationIndex];
    
    // Check if invitation has expired
    if (invitation.expiresAt < Date.now()) {
      invitation.status = 'expired';
      await this.save();
      throw new Error('Invitation has expired');
    }

    // Update invitation status
    invitation.status = 'accepted';
    invitation.respondedAt = Date.now();

    // Add user as member
    this.members.push({
      user: userId,
      role: invitation.role,
      status: 'active',
      joinedDate: Date.now()
    });

    // Add to admins if role is admin
    if (invitation.role === 'admin') {
      this.admins.push(userId);
    }

    // Set as treasurer if role is treasurer
    if (invitation.role === 'treasurer') {
      this.treasurer = userId;
    }

    await this.save();
    return { success: true, role: invitation.role };
  } catch (error) {
    throw error;
  }
};

// New method to decline invitation
GroupSchema.methods.declineInvitation = async function(userId) {
  try {
    // Find the pending invitation
    const invitationIndex = this.invitations.findIndex(inv => 
      inv.invitedUser.toString() === userId && inv.status === 'pending'
    );
    
    if (invitationIndex === -1) {
      throw new Error('No pending invitation found for this user');
    }

    // Update invitation status
    this.invitations[invitationIndex].status = 'declined';
    this.invitations[invitationIndex].respondedAt = Date.now();

    await this.save();
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// New method to request to join group
GroupSchema.methods.requestToJoin = async function(userId, message = '') {
  try {
    // Check if user is already a member
    const existingMember = this.members.find(m => m.user.toString() === userId);
    if (existingMember) {
      throw new Error('User is already a member of this group');
    }

    // Check if there's already a pending request
    const existingRequest = this.joinRequests.find(req => 
      req.requestedBy.toString() === userId && req.status === 'pending'
    );
    if (existingRequest) {
      throw new Error('User already has a pending join request for this group');
    }

    // Check if there's a pending invitation (user should accept that instead)
    const pendingInvitation = this.invitations.find(inv => 
      inv.invitedUser.toString() === userId && inv.status === 'pending'
    );
    if (pendingInvitation) {
      throw new Error('User has a pending invitation. Please accept the invitation instead.');
    }

    // Create new join request
    const joinRequest = {
      requestedBy: userId,
      message,
      status: 'pending',
      requestedAt: Date.now()
    };

    this.joinRequests.push(joinRequest);
    await this.save();
    
    return joinRequest;
  } catch (error) {
    throw error;
  }
};

// New method to approve join request
GroupSchema.methods.approveJoinRequest = async function(userId, reviewedBy, reviewNote = 'welcome') {
  try {
    // Find the pending join request
    const requestIndex = this.joinRequests.findIndex(req => 
      req.requestedBy.toString() === userId && req.status === 'pending'
    );
    
    if (requestIndex === -1) {
      throw new Error('No pending join request found for this user');
    }

    const joinRequest = this.joinRequests[requestIndex];

    // Update request status
    joinRequest.status = 'approved';
    joinRequest.reviewedBy = reviewedBy;
    joinRequest.reviewedAt = Date.now();
    joinRequest.reviewNote = reviewNote;

    // Add user as member
    this.members.push({
      user: userId,
      role: 'member',
      status: 'active',
      joinedDate: Date.now()
    });

    await this.save();
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// New method to reject join request
GroupSchema.methods.rejectJoinRequest = async function(userId, reviewedBy, reviewNote = 'Fuck Off') {
  try {
    // Find the pending join request
    const requestIndex = this.joinRequests.findIndex(req => 
      req.requestedBy.toString() === userId && req.status === 'pending'
    );
    
    if (requestIndex === -1) {
      throw new Error('No pending join request found for this user');
    }

    const joinRequest = this.joinRequests[requestIndex];

    // Update request status
    joinRequest.status = 'rejected';
    joinRequest.reviewedBy = reviewedBy;
    joinRequest.reviewedAt = Date.now();
    joinRequest.reviewNote = reviewNote;

    await this.save();
    return { success: true };
  } catch (error) {
    throw error;
  }
};

// Method to clean up expired invitations
GroupSchema.methods.cleanupExpiredInvitations = async function() {
  try {
    const now = Date.now();
    let hasExpired = false;

    this.invitations.forEach(invitation => {
      if (invitation.status === 'pending' && invitation.expiresAt < now) {
        invitation.status = 'expired';
        hasExpired = true;
      }
    });

    if (hasExpired) {
      await this.save();
    }

    return { cleaned: hasExpired };
  } catch (error) {
    throw error;
  }
};

GroupSchema.statics.getUserJoinRequests = async function(userId, status = null) {
  try {
    const matchQuery = {
      privacy: 'public',
      'joinRequests.requestedBy': userId
    };

    if (status) {
      matchQuery['joinRequests.status'] = status;
    }

    const groups = await this.find(matchQuery)
      .select('name groupType description joinRequests createdBy members')
      .populate('createdBy', 'name email avatar')
      .populate('joinRequests.reviewedBy', 'name email avatar')
      .lean();

    // Filter and format the results
    const userRequests = groups.map(group => {
      const userRequest = group.joinRequests.find(
        req => req.requestedBy.toString() === userId
      );
      
      if (!userRequest) return null;

      return {
        groupId: group._id,
        groupName: group.name,
        groupType: group.groupType,
        description: group.description,
        createdBy: group.createdBy,
        memberCount: group.members ? group.members.length : 0,
        joinRequest: userRequest
      };
    }).filter(Boolean);

    return userRequests;

  } catch (error) {
    throw new Error(`Failed to get user join requests: ${error.message}`);
  }
};

// In GroupSchema.methods
GroupSchema.methods.generateUpcomingEvents = async function() {
  const events = [];
  const now = new Date();
  
  // Generate contribution events
  if (this.settings.contributionSchedule) {
    const { frequency, amount, dueDay } = this.settings.contributionSchedule;
    const nextContribution = this.calculateNextDueDate(frequency, dueDay);
    
    events.push({
      type: 'contribution',
      title: `Contribution Due - ${this.name}`,
      description: `Contribution amount: ${amount} ${this.savingsAccount.currency}`,
      startDate: nextContribution,
      group: this._id,
      isRecurring: true,
      recurrencePattern: this.getRecurrencePattern(frequency, dueDay)
    });
  }
  
  // Generate meeting events
  if (this.settings.meetingSchedule) {
    const { frequency, dayOfMonth, time } = this.settings.meetingSchedule;
    const nextMeeting = this.calculateNextMeetingDate(frequency, dayOfMonth, time);
    
    events.push({
      type: 'meeting',
      title: `Meeting - ${this.name}`,
      description: `Group meeting scheduled`,
      startDate: nextMeeting,
      endDate: new Date(nextMeeting.getTime() + 60*60*1000), // 1 hour duration
      group: this._id,
      isRecurring: true,
      recurrencePattern: this.getRecurrencePattern(frequency, dayOfMonth)
    });
  }
  
  return events;
};

GroupSchema.methods.calculateNextDueDate = function(frequency, dueDay) {
  const now = new Date();
  let nextDate = new Date(now);
  
  switch(frequency) {
    case 'monthly':
      nextDate.setDate(dueDay);
      if (nextDate < now) {
        nextDate.setMonth(nextDate.getMonth() + 1);
      }
      break;
    case 'weekly':
      // Calculate next occurrence of the specified day of week
      const dayDiff = (dueDay - now.getDay() + 7) % 7;
      nextDate.setDate(now.getDate() + dayDiff);
      break;
    case 'biweekly':
      // Similar to weekly but with 2-week interval
      break;
  }
  
  return nextDate;
};

// Enhanced Group.js model methods

GroupSchema.methods.assessLatePaymentFines = async function(loanId, lateFeePercentage) {
  const loan = await Loan.findById(loanId);
  if (!loan || loan.group.toString() !== this._id.toString()) {
    throw new Error('Loan not found in this group');
  }
  
  const today = new Date();
  let totalFines = 0;
  
  // Check for late payments
  loan.repaymentSchedule.forEach(installment => {
    if (!installment.paid && installment.dueDate < today && installment.lateFee === 0) {
      const lateAmount = installment.totalAmount - installment.paidAmount;
      const fine = lateAmount * (lateFeePercentage / 100);
      installment.lateFee = fine;
      totalFines += fine;
    }
  });
  
  if (totalFines > 0) {
    // Add to fines account
    this.finesAccount.balance += totalFines;
    
    // Record transaction
    this.transactions.push({
      type: 'fine_payment',
      amount: totalFines,
      description: `Late payment fines for loan ${loan._id}`,
      affectedAccount: 'finesAccount',
      status: 'completed'
    });
    
    await this.save();
  }
  
  await loan.save();
  
  return { finesAssessed: totalFines };
};

// SACCO-specific member data updates
GroupSchema.methods.updateSaccoMemberData = async function(memberId, contributionAmount) {
  if (!this.saccoData.members) {
    this.saccoData.members = [];
  }
  
  let saccoMember = this.saccoData.members.find(m => m.user.toString() === memberId.toString());
  if (!saccoMember) {
    const memberNumber = `SACCO${String(this.saccoData.members.length + 1).padStart(4, '0')}`;
    saccoMember = {
      user: memberId,
      memberNumber,
      sharesPurchased: 0,
      dividendsEarned: 0,
      accountType: 'BOSA'
    };
    this.saccoData.members.push(saccoMember);
  }
  
  return {
    saccoMemberUpdated: true,
    memberNumber: saccoMember.memberNumber,
    accountType: saccoMember.accountType
  };
};

// Table Banking meeting methods
GroupSchema.methods.startTableBankingMeeting = async function(chairpersonId) {
  if (this.groupType !== 'table_banking') {
    throw new Error('This method is only available for table banking groups');
  }
  
  const meetingNumber = this.tableBankingData.meetingHistory.length + 1;
  const availableFunds = this.savingsAccount.balance;
  
  const newMeeting = {
    meetingNumber,
    date: new Date(),
    attendance: [],
    lendingRounds: [],
    totalFundsAvailable: availableFunds,
    totalLent: 0,
    chairperson: chairpersonId
  };
  
  this.tableBankingData.currentMeeting = {
    fundsAvailable: availableFunds,
    lendingInProgress: true,
    currentRound: 1
  };
  
  this.tableBankingData.meetingHistory.push(newMeeting);
  await this.save();
  
  return {
    meetingStarted: true,
    meetingNumber,
    availableFunds,
    chairperson: chairpersonId
  };
};

// Investment Club portfolio management
GroupSchema.methods.addInvestment = async function(investmentData, initiatedBy) {
  if (this.groupType !== 'investment_club') {
    throw new Error('This method is only available for investment clubs');
  }
  
  const policies = GroupTypePolicies.getPolicies(this.groupType);
  const maxInvestment = this.investmentClubData.investmentAccount.balance * policies.maxSingleInvestmentRatio;
  
  if (investmentData.amount > maxInvestment) {
    throw new Error(`Investment amount exceeds maximum allowed: ${maxInvestment}`);
  }
  
  // Deduct from investment account
  this.investmentClubData.investmentAccount.balance -= investmentData.amount;
  
  // Add to portfolio
  this.investmentClubData.portfolio.push({
    ...investmentData,
    purchaseDate: new Date(),
    currentValue: investmentData.amount
  });
  
  // Record transaction
  this.transactions.push({
    type: 'expense',
    amount: investmentData.amount,
    date: new Date(),
    method: 'wallet',
    description: `Investment in ${investmentData.investmentType}`,
    verifiedBy: initiatedBy,
    affectedAccount: 'investmentAccount',
    status: 'completed'
  });
  
  await this.save();
  
  return {
    investmentAdded: true,
    portfolioValue: this.investmentClubData.portfolio.reduce((sum, inv) => sum + inv.currentValue, 0),
    remainingFunds: this.investmentClubData.investmentAccount.balance
  };
};

// Policy validation method
GroupSchema.methods.validateOperationPolicy = function(operation, params) {
  return GroupTypePolicies.validateOperation(this.groupType, operation, params);
};
GroupSchema.methods.syncSaccoMembers = async function() {
  if (this.groupType !== 'sacco') return;

  // Ensure saccoData exists
  if (!this.saccoData) {
    await this.initializeTypeData();
  }

  if (!Array.isArray(this.saccoData.members)) {
    this.saccoData.members = [];
  }

  // Add any group members who aren't in saccoData.members
  for (const member of this.members) {
    if (member.status === 'active') {
      const existingSaccoMember = this.saccoData.members.find(sm => 
        sm.user.toString() === member.user.toString()
      );
      if (!existingSaccoMember) {
        const memberNumber = `SACCO${String(this.saccoData.members.length + 1).padStart(4, '0')}`;
        this.saccoData.members.push({
          user: member.user,
          memberNumber,
          sharesPurchased: 0,
          dividendsEarned: 0,
          accountType: 'BOSA',
          shareCapitalBalance: 0,
          savingsBalance: 0,
          loanBalance: 0,
          joinedDate: member.joinedDate || new Date()
        });
      }
    }
  }

  await this.save();
};

// Method to calculate and distribute dividends
GroupSchema.methods.distributeSaccoDividends = async function(dividendRate, initiatedBy) {
  if (this.groupType !== 'sacco') {
    throw new Error('This method is only available for SACCO groups');
  }

  const totalDividends = this.saccoData.shareCapitalAccount.balance * (dividendRate / 100);
  
  if (this.savingsAccount.balance < totalDividends) {
    throw new Error('Insufficient funds for dividend distribution');
  }

  let distributedAmount = 0;

  for (const member of this.saccoData.members) {
    if (member.sharesPurchased > 0) {
      const memberDividend = member.shareCapitalBalance * (dividendRate / 100);
      member.dividendsEarned = (member.dividendsEarned || 0) + memberDividend;
      distributedAmount += memberDividend;

      // Record dividend transaction
      this.transactions.push({
        type: 'dividend',
        amount: memberDividend,
        date: new Date(),
        member: member.user,
        method: 'wallet',
        description: `Dividend payment at ${dividendRate}% rate`,
        verifiedBy: initiatedBy,
        affectedAccount: 'dividendAccount',
        status: 'completed'
      });
    }
  }

  // Update accounts
  this.savingsAccount.balance -= distributedAmount;
  this.saccoData.dividendAccount.balance += distributedAmount;
  this.saccoData.dividendAccount.lastDividendRate = dividendRate;

  await this.save();

  return {
    dividendRate,
    totalDistributed: distributedAmount,
    membersReceived: this.saccoData.members.filter(m => m.sharesPurchased > 0).length
  };
};

// Method to get SACCO member statement
GroupSchema.methods.getSaccoMemberStatement = function(userId) {
  if (this.groupType !== 'sacco') {
    throw new Error('This method is only available for SACCO groups');
  }

  const saccoMember = this.saccoData.members.find(m => 
    m.user.toString() === userId.toString()
  );

  if (!saccoMember) {
    throw new Error('SACCO member record not found');
  }

  // Get member's transactions
  const memberTransactions = this.transactions.filter(t => 
    t.member && t.member.toString() === userId.toString()
  );

  return {
    memberNumber: saccoMember.memberNumber,
    accountType: saccoMember.accountType,
    sharesPurchased: saccoMember.sharesPurchased,
    shareCapitalBalance: saccoMember.shareCapitalBalance,
    savingsBalance: saccoMember.savingsBalance,
    dividendsEarned: saccoMember.dividendsEarned,
    loanEligibilityAmount: saccoMember.loanEligibilityAmount,
    votingPower: saccoMember.votingPower,
    joinedDate: saccoMember.joinedDate,
    lastContributionDate: saccoMember.lastContributionDate,
    transactions: memberTransactions
  };
};
// Get group-specific policies
GroupSchema.methods.getPolicies = function() {
  return GroupTypePolicies.getPolicies(this.groupType);
};

module.exports = mongoose.model('Group', GroupSchema);