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
        enum: ['contribution', 'loan_disbursement', 'loan_repayment', 'interest_payment', 'fine_payment', 'expense', 'dividend'],
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
        enum: ['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount'],
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

// Method to add a contribution from a member's wallet
GroupSchema.methods.addWalletContribution = async function(memberId, amount, verifiedBy, notes) {
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
      method: 'wallet',
      verifiedBy,
      notes,
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
      method: 'wallet',
      description: notes || 'Wallet contribution',
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
GroupSchema.methods.fundWallet = async function(userId, amount, initiatedBy, account = 'savingsAccount', description = 'Wallet funding') {
  if (!['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount'].includes(account)) {
    throw new Error('Invalid source account');
  }

  if (this[account].balance < amount) {
    throw new Error(`Insufficient balance in ${account}`);
  }

  // Deduct from group account
  this[account].balance -= amount;

  // Add transaction record
  this.transactions.push({
    type: 'dividend', // or 'wallet_funding' if added to enum
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
    groupAccountBalance: this[account].balance
  };
};

GroupSchema.methods.recordCashPayment = async function(userId, amount, verifiedBy, notes = '', account = 'savingsAccount') {
  // 1. Validate account
  if (!['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount'].includes(account)) {
    throw new Error('Invalid account specified');
  }

  // 2. Check group balance
  if (this[account].balance < amount) {
    throw new Error(`Insufficient funds in ${account}`);
  }

  // 3. Deduct from group account
  this[account].balance -= amount;

  // 4. Record transaction
  this.transactions.push({
    type: 'expense', // or use 'cash_payment' if added to enum
    amount,
    date: Date.now(),
    member: userId,
    method: 'cash',
    description: notes || 'Cash payment to member',
    verifiedBy,
    affectedAccount: account,
    status: 'completed'
  });

  await this.save();

  return {
    success: true,
    newGroupBalance: this[account].balance
  };
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

module.exports = mongoose.model('Group', GroupSchema);