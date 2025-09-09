const Group = require('../models/Group');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const { sendEmail, sendPushNotification } = require('./messagingController');
const { repayLoan } = require('./loanController');
const Logger = require('../middleware/Logger');
const mongoose = require('mongoose');


/**
 * Contribution Controller
 * Handles all group contribution operations
 */
class ContributionController {
  constructor() {
    // Bind methods to ensure 'this' context is preserved
    this.contributeFromWallet = this.contributeFromWallet.bind(this);
    this.updateChamaData = this.updateChamaData.bind(this);
    this.processChamaPayout = this.processChamaPayout.bind(this);
    this.getCurrentCycleStartDate = this.getCurrentCycleStartDate.bind(this);
    this.processLoanRepayment = this.processLoanRepayment.bind(this);
  }
  /**
   * Make a contribution from member's wallet to a group
   * @route POST /api/groups/:id/contributions/wallet
   * @access Private
   **/
  async contributeFromWallet(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      Logger.error('Contribution validation errors', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    
    Logger.info('Processing wallet contribution', {
      userId: req.user.id,
      groupId: req.params.id,
      totalAmount: req.body.totalAmount,
    });

    // Use database transaction for atomicity
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { totalAmount, allocations, verifiedBy } = req.body;
      const userId = req.user.id;
      const groupId = req.params.id;

      // Input validation
      if (!Array.isArray(allocations) || allocations.length === 0) {
        Logger.error('Invalid allocations provided', { allocations });
        await session.abortTransaction();
        return res.status(400).json({ message: 'Please provide valid allocations' });
      }

      // Validate allocation structure and calculate total
      let calculatedTotal = 0;
      for (const alloc of allocations) {
        if (!alloc.account || typeof alloc.amount !== 'number' || alloc.amount <= 0) {
          Logger.error('Invalid allocation structure', { allocation: alloc });
          await session.abortTransaction();
          return res.status(400).json({ message: 'Each allocation must have valid account and positive amount' });
        }
        calculatedTotal += alloc.amount;
      }

      if (!totalAmount || totalAmount <= 0 || Math.abs(totalAmount - calculatedTotal) > 0.01) {
        Logger.error('Total amount does not match allocations', { totalAmount, calculatedTotal, allocations });
        await session.abortTransaction();
        return res.status(400).json({ message: 'Total amount must match sum of allocations' });
      }

      // Find and validate group with session
      const group = await Group.findById(groupId).session(session);
      await group.initializeTypeData();
      if (!group) {
        Logger.error('Group not found', { groupId });
        await session.abortTransaction();
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check user membership
      const memberRecord = group.members.find(member =>
        member.user.toString() === userId && member.status === 'active'
      );
      if (!memberRecord) {
        Logger.error('User is not an active member of the group', { userId, groupId });
        await session.abortTransaction();
        return res.status(403).json({ message: 'Access denied. Not an active member of this group' });
      }

      // Get and validate user wallet with session
      const wallet = await Wallet.findOne({ user: userId }).session(session);
      if (!wallet) {
        Logger.error('User wallet not found', { userId });
        await session.abortTransaction();
        return res.status(404).json({ message: 'User wallet not found' });
      }

      // Check wallet balance
      if (wallet.balance < totalAmount) {
        Logger.error('Insufficient funds in wallet', { 
          userId, 
          walletBalance: wallet.balance, 
          requiredAmount: totalAmount 
        });
        await session.abortTransaction();
        return res.status(400).json({ message: 'Insufficient funds in your wallet' });
      }

      // Validate all accounts exist before processing
      const validAccounts = ['savingsAccount', 'loanAccount', 'interestEarnedAccount', 'finesAccount', 'groupAccount'];
      for (const alloc of allocations) {
        if (!validAccounts.includes(alloc.account)) {
          Logger.error('Invalid account in allocation', { account: alloc.account });
          await session.abortTransaction();
          return res.status(400).json({ message: `Invalid account: ${alloc.account}` });
        }
      }

      // Process loan repayments first (if any) with proper error handling
      const loanRepaymentResults = [];
      for (const alloc of allocations) {
        if (alloc.account === 'loanAccount' && alloc.loanIds?.length) {
          try {
            for (const loanId of alloc.loanIds) {
              // Validate loan ownership and status
              const loan = await Loan.findById(loanId).session(session);
              if (!loan) {
                throw new Error(`Loan ${loanId} not found`);
              }
              if (loan.borrower.toString() !== userId) {
                throw new Error(`Not authorized to repay loan ${loanId}`);
              }
              if (loan.status === 'fully_paid') {
                throw new Error(`Loan ${loanId} is already fully paid`);
              }

              // Calculate repayment amount for this specific loan
              const repaymentAmount = Math.min(alloc.amount, loan.remainingAmount);
              
              // Create proper request object for loan repayment
              const loanRepaymentReq = {
                params: { id: loanId },
                body: { 
                  amount: repaymentAmount, 
                  method: 'wallet',
                  source: 'contribution_allocation'
                },
                user: { id: userId },
                session // Pass the session for transaction consistency
              };

              // Use a promise-based approach instead of fake response objects
              const repaymentResult = await this.processLoanRepayment(loanRepaymentReq);

              loanRepaymentResults.push({
                loanId,
                amount: repaymentAmount,
                result: repaymentResult
              });

              Logger.info('Loan repayment processed within contribution', {
                loanId,
                amount: repaymentAmount,
                userId
              });
            }
          } catch (loanError) {
            Logger.error('Error processing loan repayment within contribution', {
              loanId: alloc.loanIds,
              error: loanError.message,
              userId
            });
            await session.abortTransaction();
            return res.status(400).json({ 
              message: `Error processing loan repayment: ${loanError.message}` 
            });
          }
        }
      }

      // Create wallet transaction
      const walletTransaction = {
        type: 'withdrawal',
        amount: totalAmount,
        relatedEntity: {
          entityType: 'group',
          entityId: groupId
        },
        description: `Contribution to ${group.name}`,
        paymentMethod: 'Internal',
        date: new Date(),
        status: 'completed',
        allocations: allocations // Track how the withdrawal was allocated
      };

      // Process group contribution with allocations
      const contribution = await group.addWalletContribution(
        userId,
        totalAmount,
        verifiedBy || userId,
        allocations,
        session // Pass session for transaction consistency
      );

      // Update wallet balance and add transaction
      wallet.transactions.push(walletTransaction);
      await wallet.updateBalance(totalAmount, 'withdrawal', session);

      // ✅ SAVE GROUP FIRST before chama logic to ensure contribution is recorded
      await group.save({ session });
      Logger.info('Group contribution saved before chama processing', { userId, groupId, totalAmount }, group);


      // CHAMA-SPECIFIC LOGIC: Update chamaData and process payout if applicable
      let chamaPayoutResult = null;
      if (group.groupType === 'chama') {
        try {
          chamaPayoutResult = await this.updateChamaData(group, userId, allocations, session);
          Logger.info('Chama data updated successfully', {
            groupId,
            userId,
            payoutTriggered: !!chamaPayoutResult,
            currentCycle: group.chamaData?.currentCycle
          });
        } catch (chamaError) {
          Logger.error('Error updating chama data', {
            error: chamaError.message,
            stack: chamaError.stack,
            groupId,
            userId
          });
          // Don't fail the entire transaction for chama data errors, but log them
        }
      }

      // Save group changes again after chama processing (if any updates were made)
      if (chamaPayoutResult) {
        await group.save({ session });
        Logger.info('Group saved after chama payout processing', { userId, groupId });
      }

      let saccoResult = null;

      if (group.groupType === 'sacco') {
        try {
          const saccoResult = await this.updateSaccoData(group, userId, allocations, session);
          Logger.info('SACCO data updated successfully', {
            groupId,
            userId,
            saccoResult
          });
        } catch (saccoError) {
          Logger.error('Error updating SACCO data', {
            error: saccoError.message,
            stack: saccoError.stack,
            groupId,
            userId
          });
          // Don't fail the entire transaction for SACCO data errors, but log them
        }
      }

      // Get user for notifications
      const user = await User.findById(userId).session(session);
      if (!user) {
        Logger.error('User not found for notifications', { userId });
        await session.abortTransaction();
        return res.status(404).json({ message: 'User not found' });
      }

      // Commit transaction before sending notifications
      await session.commitTransaction();
      Logger.info('Contribution transaction committed successfully', { userId, groupId, totalAmount });

      // Send notifications (outside of database transaction)
      const message = {
        title: 'Contribution Received',
        body: `Your contribution of KES ${totalAmount} to ${group.name} has been received and recorded.`
      };

      // Send chama payout notification if applicable
      if (chamaPayoutResult && chamaPayoutResult.payoutProcessed) {
        const payoutMessage = {
          title: 'Chama Payout Received',
          body: `You received KES ${chamaPayoutResult.payoutAmount} from ${group.name} chama payout!`
        };
        
        Promise.all([
          sendPushNotification(chamaPayoutResult.recipientId, payoutMessage).catch(err => 
            Logger.error('Payout notification failed', { recipientId: chamaPayoutResult.recipientId, error: err.message })
          )
        ]);
      }

      // Send notifications asynchronously to avoid blocking response
      Promise.all([
        sendPushNotification(user._id, message).catch(err => 
          Logger.error('Push notification failed', { userId: user._id, error: err.message })
        ),
        // sendEmail(user.email, message.title, message.body).catch(err =>
        //   Logger.error('Email sending failed', { email: user.email, error: err.message })
        // )
      ]);

      // Prepare response data
      const responseData = {
        message: 'Contribution successful',
        walletBalance: wallet.balance,
        groupBalances: {
          savings: group.savingsAccount.balance,
          loan: group.loanAccount.balance,
          group: group.groupAccount.balance,
          interestEarned: group.interestEarnedAccount.balance,
          fines: group.finesAccount.balance
        },
        contribution,
        loanRepayments: loanRepaymentResults.length > 0 ? loanRepaymentResults : undefined,
        chamaUpdate: group.groupType === 'chama' ? {
          currentCycle: group.chamaData?.currentCycle,
          currentRecipientIndex: group.chamaData?.currentRecipientIndex,
          payoutProcessed: chamaPayoutResult?.payoutProcessed || false,
          payoutAmount: chamaPayoutResult?.payoutAmount || 0,
          nextRecipient: chamaPayoutResult?.nextRecipient || null
        } : undefined,
        saccoUpdate: saccoResult || undefined
      };

      Logger.info('Contribution processed successfully', {
        userId,
        groupId,
        totalAmount,
        allocations: allocations.length,
        loanRepayments: loanRepaymentResults.length,
        chamaPayoutProcessed: !!chamaPayoutResult?.payoutProcessed
      });

      res.json(responseData);

    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      Logger.error('Error processing wallet contribution', {
        error: error.message,
        stack: error.stack,
        userId: req.user.id,
        groupId: req.params.id
      });
      
      res.status(500).json({ 
        message: 'Server error processing contribution', 
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    } finally {
      session.endSession();
    }
  }

  initializeChamaData(group) {
    if (group.groupType === 'chama' && !group.chamaData) {
      Logger.info('Initializing chamaData for existing group', { groupId: group._id });
      
      group.chamaData = {
        currentCycle: 1,
        currentRecipientIndex: 0,
        cycleHistory: [],
        payoutOrder: group.members
          .filter(m => m.status === 'active')
          .sort((a, b) => new Date(a.joinedDate) - new Date(b.joinedDate))
          .map((member, index) => ({
            memberId: member.user._id || member.user,
            position: index + 1,
            hasPaidOut: false,
            payoutDate: null,
            amount: 0
          })),
        cycleSettings: {
          shuffleOrder: false,
          allowEmergencyPayouts: true,
          penaltyAmount: 0.1
        }
      };
    }
  }

  /**
   * Update Chama Data and process payout if all members have contributed
   * @param {Object} group - Group document
   * @param {String} userId - Contributing member ID  
   * @param {Array} allocations - Contribution allocations
   * @param {Object} session - Database session
   * @returns {Object|null} Payout result if processed
   */
  async updateChamaData(group, userId, allocations, session) {
    // Initialize chamaData if not exists
    this.initializeChamaData(group);

    // Initialize payout order based on members joining order if empty
    if (group.chamaData.payoutOrder.length === 0) {
      group.chamaData.payoutOrder = group.members
        .filter(m => m.status === 'active')
        .sort((a, b) => new Date(a.joinedDate) - new Date(b.joinedDate))
        .map((member, index) => ({
          memberId: member.user._id || member.user,
          position: index + 1,
          hasPaidOut: false,
          payoutDate: null,
          amount: 0
        }));
    }

    // Add any new members to payout order if not already included
    const activeMembers = group.members.filter(m => m.status === 'active');
    activeMembers.forEach(member => {
      const memberExists = group.chamaData.payoutOrder.find(
        p => p.memberId.toString() === (member.user._id || member.user).toString()
      );
      if (!memberExists) {
        group.chamaData.payoutOrder.push({
          memberId: member.user._id || member.user,
          position: group.chamaData.payoutOrder.length + 1,
          hasPaidOut: false,
          payoutDate: null,
          amount: 0
        });
      }
    });

    // Check if this contribution includes groupAccount allocation
    const groupContribution = allocations.find(alloc => alloc.account === 'groupAccount');
    if (!groupContribution) {
      return null; // No group contribution, no chama logic needed
    }


    // Check if all active members have contributed to current cycle
    const lastCycle = group?.chamaData?.cycleHistory[group?.chamaData?.cycleHistory?.length - 1];
    const cycleStartDate = lastCycle ? new Date(lastCycle.datePaid) : group.createdAt;
    const contributorsThisCycle = new Set();
    
    // Count unique members who contributed to groupAccount since cycle start
    // Check the group.transactions array (where contributions are actually stored)
    const relevantTransactions = [];
    group.transactions.forEach(t => {
      // Handle both Mongoose documents and plain objects
      const transaction = t.toObject ? t.toObject() : t;
      
      if (transaction.type === 'contribution' && 
          new Date(transaction.date) >= group?.createdAt &&
          transaction.affectedAccount === 'groupAccount' &&
          transaction.status === 'completed') {
        relevantTransactions.push(transaction);
        contributorsThisCycle.add(transaction.member.toString());
      }
    });

    Logger.info('Relevant groupAccount transactions for cycle', {
      cycleStartDate,
      cycleinitialDate: group.createdAt,
      lastCycle,
      TotalTransactions: relevantTransactions.length,
    });

    const totalActiveMembers = activeMembers.length;
    const totalContributors = contributorsThisCycle.size; // +1 for current contribution

    Logger.info('Chama cycle check', {
      totalActiveMembers,
      totalContributors,
      cycleStartDate,
      currentCycle: group.chamaData.currentCycle,
      contributorsThisCycle: Array.from(contributorsThisCycle), // Convert Set to Array for better logging
    });

    // If all members have contributed, process payout
    if (totalContributors === totalActiveMembers) {
      // Calculate total payout: contribution amount × total active members
      const totalPayout = groupContribution.amount * totalActiveMembers;
      
      Logger.info('All members contributed. Triggering payout...', {
        totalPayout,
        contributionAmount: groupContribution.amount,
        totalActiveMembers,
        groupAccountBalance: group.groupAccount.balance
      });
      
      return await this.processChamaPayout(group, cycleStartDate, userId, totalPayout, session);
    }

    return null;
  }

  /**
 * Process Chama payout when all members have contributed
 * @param {Object} group - Group document
 * @param {Date} cycleStartDate - Start date of current cycle
 * @param {Object} session - Database session
 * @returns {Object} Payout result
 */
async processChamaPayout(group, cycleStartDate, userId, totalPayout, session) {
  const currentRecipientIndex = group.chamaData.currentRecipientIndex;
  const payoutOrder = group.chamaData.payoutOrder;
  const currentRecipient = payoutOrder[currentRecipientIndex];
  
  if (!currentRecipient) {
    throw new Error('Invalid recipient index in chama payout');
  }

  // Calculate total payout (all group contributions for this cycle)
  const contributorsThisCycle = new Set();
  group.transactions
    .filter(t => 
      t.type === 'contribution' && 
      t.date >= cycleStartDate &&
      t.affectedAccount === 'groupAccount'
    )
    .forEach(t => contributorsThisCycle.add(t.member.toString()));
  // contributorsThisCycle.add(userId.toString());

  Logger.info('Processing chama payout', {
    recipientId: currentRecipient.memberId,
    amount: totalPayout,
    cycle: group.chamaData.currentCycle,
    userId,
  });

  // Record the payout in cycle history
  group.chamaData.cycleHistory.push({
    cycleNumber: group.chamaData.currentCycle,
    recipientId: currentRecipient.memberId,
    amountPaid: totalPayout,
    datePaid: new Date(),
    completed: true
  });

  // Update payout order
  currentRecipient.hasPaidOut = true;
  currentRecipient.payoutDate = new Date();
  currentRecipient.amount = totalPayout;

  // ✅ Use fundWallet method instead of manual transaction/balance update
  await group.fundWallet(
    currentRecipient.memberId,  // userId - who receives the funds
    totalPayout,               // amount - how much to transfer
    userId,                    // initiatedBy - who initiated this payout
    'groupAccount',            // account - source account to deduct from
    `${group.name} - Cycle ${group.chamaData.currentCycle} Payout`, // description
    session                    // session - for transaction consistency
  );

  // Advance to next recipient/cycle
  const nextRecipientIndex = (currentRecipientIndex + 1) % payoutOrder.length;
  Logger.info('Chama payout completed', {
    nextRecipientIndex});
  
  if (nextRecipientIndex === 0) {
    // Completed full round - start new cycle
    group.chamaData.currentCycle += 1;
    // Reset payout tracking for new cycle
    group.chamaData.payoutOrder.forEach(p => {
      p.hasPaidOut = false;
    });
  }
  
  group.chamaData.currentRecipientIndex = nextRecipientIndex;
  const nextRecipient = payoutOrder[nextRecipientIndex];

  return {
    payoutProcessed: true,
    recipientId: currentRecipient.memberId,
    payoutAmount: totalPayout,
    cycleCompleted: nextRecipientIndex === 0,
    nextRecipient: nextRecipient ? nextRecipient.memberId : null,
    currentCycle: group.chamaData.currentCycle
  };
}


  /**
   * Get the start date of current cycle
   * @param {Object} group - Group document
   * @returns {Date} Cycle start date
   */
  getCurrentCycleStartDate(group) {
    if (!group.chamaData || group.chamaData.cycleHistory.length === 0) {
      // First cycle starts from group creation
      return group.createdAt;
    }
    
    // Current cycle starts after last completed payout
    const lastCycle = group.chamaData.cycleHistory[group.chamaData.cycleHistory.length - 1];
    return lastCycle.datePaid;
  }


  // Helper function to process loan repayments properly
  async processLoanRepayment(req) {
    const { id: loanId } = req.params;
    const { amount, method, source } = req.body;
    const { id: userId } = req.user;
    const session = req.session;

    const loan = await Loan.findById(loanId).session(session);
    if (!loan) throw new Error('Loan not found');

    const repaymentAmount = Math.min(amount, loan.remainingAmount);

    loan.paidAmount += repaymentAmount;
    loan.remainingAmount -= repaymentAmount;

    if (loan.remainingAmount <= 0) {
      loan.status = 'fully_paid';
      loan.fullyPaidDate = new Date();
    }

    loan.payments.push({
      amount: repaymentAmount,
      date: new Date(),
      method: method || 'wallet',
      source: source || 'manual'
    });

    await loan.save({ session });

    return {
      success: true,
      loanId,
      paidAmount: repaymentAmount,
      remainingAmount: loan.remainingAmount,
      status: loan.status
    };
  }
  async updateSaccoData(group, userId, allocations, session) {
    // Initialize saccoData if not exists
    if (!group.saccoData) {
      group.saccoData = {
        shareCapitalAccount: { balance: 0, currency: 'KES', totalShares: 0, shareValue: 100 },
        dividendAccount: { balance: 0, currency: 'KES', lastDividendRate: 0 },
        statutoryReserveAccount: { balance: 0, currency: 'KES' },
        members: [],
        boardOfDirectors: [],
        auditHistory: []
      };
    }

    // Ensure saccoData.members array exists
    if (!Array.isArray(group.saccoData.members)) {
      group.saccoData.members = [];
    }

    // Find or create SACCO member record
    let saccoMember = group.saccoData.members.find(m => 
      m.user.toString() === userId.toString()
    );

    if (!saccoMember) {
      // Create new SACCO member record
      const memberNumber = `SACCO${String(group.saccoData.members.length + 1).padStart(4, '0')}`;
      saccoMember = {
        user: userId,
        memberNumber,
        sharesPurchased: 0,
        dividendsEarned: 0,
        accountType: 'BOSA', // Basic Savings Account
        shareCapitalBalance: 0,
        savingsBalance: 0,
        loanBalance: 0,
        joinedDate: new Date()
      };
      group.saccoData.members.push(saccoMember);
    }

    // Process allocations for SACCO-specific accounts
    let sharesPurchased = 0;
    let savingsContribution = 0;
    
    for (const alloc of allocations) {
      switch (alloc.account) {
        case 'savingsAccount':
          // Regular savings contribution
          saccoMember.savingsBalance = (saccoMember.savingsBalance || 0) + alloc.amount;
          savingsContribution += alloc.amount;
          break;
          
        case 'groupAccount':
          // In SACCO context, groupAccount contributions can be treated as share capital
          const shareValue = group.saccoData.shareCapitalAccount.shareValue || 100;
          const newShares = Math.floor(alloc.amount / shareValue);
          
          if (newShares > 0) {
            sharesPurchased += newShares;
            saccoMember.sharesPurchased = (saccoMember.sharesPurchased || 0) + newShares;
            saccoMember.shareCapitalBalance = (saccoMember.shareCapitalBalance || 0) + (newShares * shareValue);
            
            // Update group share capital account
            group.saccoData.shareCapitalAccount.totalShares += newShares;
            group.saccoData.shareCapitalAccount.balance += (newShares * shareValue);
            
            // Handle remainder (if any) as regular savings
            const remainder = alloc.amount % shareValue;
            if (remainder > 0) {
              saccoMember.savingsBalance = (saccoMember.savingsBalance || 0) + remainder;
              savingsContribution += remainder;
            }
          } else {
            // Amount too small for shares, add to savings
            saccoMember.savingsBalance = (saccoMember.savingsBalance || 0) + alloc.amount;
            savingsContribution += alloc.amount;
          }
          break;
          
        case 'loanAccount':
          // Loan repayment (already handled in main logic)
          break;
          
        case 'finesAccount':
          // Fine payment (already handled in main logic)
          break;
          
        case 'interestEarnedAccount':
          // Interest payment (already handled in main logic)
          break;
      }
    }

    // Update member's last contribution date
    saccoMember.lastContributionDate = new Date();

    // Calculate member's voting power based on shares
    saccoMember.votingPower = saccoMember.sharesPurchased;

    // Determine member eligibility for loans (typically 3x share capital + savings)
    saccoMember.loanEligibilityAmount = (saccoMember.shareCapitalBalance + saccoMember.savingsBalance) * 3;

    Logger.info('SACCO member data updated', {
      userId,
      memberNumber: saccoMember.memberNumber,
      sharesPurchased,
      totalShares: saccoMember.sharesPurchased,
      savingsContribution,
      totalSavings: saccoMember.savingsBalance,
      loanEligibility: saccoMember.loanEligibilityAmount
    });

    return {
      memberNumber: saccoMember.memberNumber,
      sharesPurchased,
      totalShares: saccoMember.sharesPurchased,
      savingsContribution,
      totalSavings: saccoMember.savingsBalance,
      loanEligibilityAmount: saccoMember.loanEligibilityAmount,
      votingPower: saccoMember.votingPower
    };
  }

  /**
   * Fund a user's wallet from group account
   * @route POST /api/groups/:id/fund-wallet
   * @access Private (admin or treasurer)
   */
  async fundWallet(req, res) {
    try {
      const { userId, amount, account, description } = req.body;
      const groupId = req.params.id;
      const group = await Group.findById(groupId);

      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if requester is authorized
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      const isTreasurer = group.treasurer?.toString() === req.user.id;
      const isCreator = group.createdBy.toString() === req.user.id;

      if (!isAdmin && !isTreasurer && !isCreator) {
        return res.status(403).json({ message: 'Only admins or treasurer can fund wallets' });
      }

      const result = await group.fundWallet(userId, amount, req.user.id, account, description);

      // Get user wallet
      const wallet = await Wallet.findOne({ user: userId });
      if (!wallet) {
        return res.status(404).json({ message: 'User wallet not found' });
      }

      // Check if wallet has sufficient funds
      if (wallet.balance < amount) {
        return res.status(400).json({ message: 'Insufficient funds in your wallet' });
      }

      // Start transaction
      // Create transaction record for wallet withdrawal
      const transaction = {
        type: 'deposit',
        amount,
        relatedEntity: {
          entityType: 'group',
          entityId: groupId
        },
        description: `Payment from ${group.name}`,
        paymentMethod: 'Internal',
        date: Date.now(),
        status: 'completed'
      };

      // Add transaction and update wallet balance
      wallet.transactions.push(transaction);
      await wallet.updateBalance(amount, 'withdrawal');

      res.status(200).json({
        message: 'Wallet funded successfully',
        result,
      });
    } catch (error) {
      console.error('Error funding wallet:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Record a cash payment to a user
   * @route POST /api/groups/:id/pay-member
   * @access Private (admin/treasurer only)
   */
  async payMember(req, res) {
    try {
      const { userId, amount, notes, account = 'savingsAccount' } = req.body;
      const group = await Group.findById(req.params.id);

      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Only admins, treasurer, or creator can pay
      const userIdReq = req.user.id;
      const isAdmin = group.admins.some(admin => admin.toString() === userIdReq);
      const isTreasurer = group.treasurer?.toString() === userIdReq;
      const isCreator = group.createdBy.toString() === userIdReq;

      if (!isAdmin && !isTreasurer && !isCreator) {
        return res.status(403).json({ message: 'Not authorized to pay members' });
      }

      // Record payment
      const result = await group.recordCashPayment(userId, amount, userIdReq, notes, account);

      res.status(200).json({
        message: 'Payment recorded successfully',
        result
      });
    } catch (error) {
      console.error('Error recording payment:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }



  /**
   * Record a cash contribution to a group
   * @route POST /api/groups/:id/contributions/cash
   * @access Private (admin or treasurer only)
   */
  async recordCashContribution(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { memberId, amount, notes, reference } = req.body;
      const verifierId = req.user.id;
      const groupId = req.params.id;

      // Validate required fields
      if (!memberId || !amount || amount <= 0) {
        return res.status(400).json({ message: 'Please provide member ID and a valid amount' });
      }

      // Find the group
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if the verifier is authorized (admin or treasurer)
      const isAdmin = group.admins.some(admin => admin.toString() === verifierId);
      const isTreasurer = group.treasurer && group.treasurer.toString() === verifierId;
      const isCreator = group.createdBy.toString() === verifierId;

      if (!isAdmin && !isTreasurer && !isCreator) {
        return res.status(403).json({ 
          message: 'Access denied. Only group admins or treasurer can record cash contributions' 
        });
      }

      // Check if member exists in the group
      const memberExists = group.members.some(m => m.user.toString() === memberId && m.status === 'active');
      if (!memberExists) {
        return res.status(404).json({ message: 'Active member not found in this group' });
      }

      // Record the cash contribution
      const contribution = await group.addCashContribution(
        memberId,
        amount,
        verifierId,
        notes || `Cash contribution recorded by ${verifierId}`,
        reference
      );

      // Get member details for response
      const member = await User.findById(memberId, 'name email phoneNumber');

      res.json({
        message: 'Cash contribution recorded successfully',
        groupSavingsBalance: group.savingsAccount.balance,
        contribution: contribution,
        member: member
      });
    } catch (error) {
      console.error('Error recording cash contribution:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Record a mobile money contribution to a group
   * @route POST /api/groups/:id/contributions/mobile
   * @access Private (admin or treasurer only)
   */
  async recordMobileMoneyContribution(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { memberId, amount, notes, reference } = req.body;
      const verifierId = req.user.id;
      const groupId = req.params.id;

      // Validate required fields
      if (!memberId || !amount || amount <= 0 || !reference) {
        return res.status(400).json({ 
          message: 'Please provide member ID, valid amount, and transaction reference' 
        });
      }

      // Find the group
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if the verifier is authorized (admin or treasurer)
      const isAdmin = group.admins.some(admin => admin.toString() === verifierId);
      const isTreasurer = group.treasurer && group.treasurer.toString() === verifierId;
      const isCreator = group.createdBy.toString() === verifierId;

      if (!isAdmin && !isTreasurer && !isCreator) {
        return res.status(403).json({ 
          message: 'Access denied. Only group admins or treasurer can record mobile money contributions' 
        });
      }

      // Check if member exists in the group
      const memberExists = group.members.some(m => m.user.toString() === memberId && m.status === 'active');
      if (!memberExists) {
        return res.status(404).json({ message: 'Active member not found in this group' });
      }

      // Record the mobile money contribution
      const contribution = await group.addMobileMoneyContribution(
        memberId,
        amount,
        verifierId,
        notes || `Mobile money contribution`,
        reference
      );

      // Get member details for response
      const member = await User.findById(memberId, 'name email phoneNumber');

      res.json({
        message: 'Mobile money contribution recorded successfully',
        groupSavingsBalance: group.savingsAccount.balance,
        contribution: contribution,
        member: member
      });
    } catch (error) {
      console.error('Error recording mobile money contribution:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get contribution history for a member
   * @route GET /api/groups/:id/contributions/member/:memberId
   * @access Private (admin, treasurer, or self)
   */
  async getMemberContributions(req, res) {
    try {
      const groupId = req.params.id;
      const memberId = req.params.memberId;
      const currentUserId = req.user.id;

      // Find the group
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if current user is authorized
      const isAdmin = group.admins.some(admin => admin.toString() === currentUserId);
      const isTreasurer = group.treasurer && group.treasurer.toString() === currentUserId;
      const isCreator = group.createdBy.toString() === currentUserId;
      const isSelf = memberId === currentUserId;

      if (!isAdmin && !isTreasurer && !isCreator && !isSelf) {
        return res.status(403).json({ 
          message: 'Access denied. You can only view your own contributions or you need admin/treasurer role' 
        });
      }

      // Get member contributions
      const contributions = group.getMemberContributionSummary(memberId);

      // Get member details
      const member = await User.findById(memberId, 'name email phoneNumber');

      res.json({
        member,
        contributions
      });
    } catch (error) {
      console.error('Error getting member contributions:', error);
      if (error.message === 'Member not found in this group') {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get all contributions for a group
   * @route GET /api/groups/:id/contributions
   * @access Private (admin or treasurer only)
   */
  async getGroupContributions(req, res) {
    try {
      const groupId = req.params.id;
      const currentUserId = req.user.id;

      // Find the group
      const group = await Group.findById(groupId)
        .populate('transactions.member', 'name email phoneNumber')
        .populate('transactions.verifiedBy', 'name email');

      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if current user is authorized
      const isAdmin = group.admins.some(admin => admin.toString() === currentUserId);
      const isTreasurer = group.treasurer && group.treasurer.toString() === currentUserId;
      const isCreator = group.createdBy.toString() === currentUserId;
      const isMember = group.members.some(m => m.user.toString() === currentUserId);

      if (!isAdmin && !isTreasurer && !isCreator && !isMember) {
        return res.status(403).json({ 
          message: 'Access denied. Only group members can view contributions' 
        });
      }

      // Get all contributions
      const contributions = group.getAllContributions();

      res.json({
        groupName: group.name,
        totalSavings: group.savingsAccount.balance,
        currency: group.savingsAccount.currency,
        contributionCount: contributions.length,
        contributions
      });
    } catch (error) {
      console.error('Error getting group contributions:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
}

module.exports = new ContributionController();