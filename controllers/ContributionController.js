const Group = require('../models/Group');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const { sendEmail, sendPushNotification } = require('./messagingController');
const { repayLoan } = require('./loanController');
const Logger = require('../middleware/Logger');


/**
 * Contribution Controller
 * Handles all group contribution operations
 */
class ContributionController {
  /**
   * Make a contribution from member's wallet to a group
   * @route POST /api/groups/:id/contributions/wallet
   * @access Private
   */
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

    try {
      const { totalAmount, allocations, verifiedBy } = req.body;
      const userId = req.user.id;
      const groupId = req.params.id;

      // Validate allocations
      if (!Array.isArray(allocations) || allocations.length === 0) {
        Logger.error('Invalid allocations provided', { allocations });
        return res.status(400).json({ message: 'Please provide valid allocations' });
      }

      const calculatedTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
      if (!totalAmount || totalAmount <= 0 || totalAmount !== calculatedTotal) {
        Logger.error('Total amount does not match allocations', { totalAmount, calculatedTotal, allocations });
        return res.status(400).json({ message: 'Total amount must match sum of allocations' });
      }

      // Find the group
      const group = await Group.findById(groupId);
      if (!group) {
        Logger.error('Group not found', { groupId });
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is a member of the group
      const isMember = group.members.some(member =>
        member.user.toString() === userId && member.status === 'active'
      );
      if (!isMember) {
        Logger.error('User is not an active member of the group', { userId, groupId });
        return res.status(403).json({ message: 'Access denied. Not an active member of this group' });
      }

      // Get user wallet
      const wallet = await Wallet.findOne({ user: userId });
      if (!wallet) {
        Logger.error('User wallet not found', { userId });
        return res.status(404).json({ message: 'User wallet not found' });
      }

      // Check if wallet has sufficient funds
      if (wallet.balance < totalAmount) {
        Logger.error('Insufficient funds in wallet', { userId, walletBalance: wallet.balance, requiredAmount: totalAmount });
        return res.status(400).json({ message: 'Insufficient funds in your wallet' });
      }

      // Start transaction
      const transaction = {
        type: 'withdrawal',
        amount: totalAmount,
        relatedEntity: {
          entityType: 'group',
          entityId: groupId
        },
        description: `Contribution to ${group.name}`,
        paymentMethod: 'Internal',
        date: Date.now(),
        status: 'completed'
      };

      // Apply wallet transaction and update balance
      wallet.transactions.push(transaction);
      await wallet.updateBalance(totalAmount, 'withdrawal');

      // Add contribution to group
      const contribution = await group.addWalletContribution(
        userId,
        totalAmount,
        verifiedBy || userId, // treasurer/admin or self
        allocations
      );

      for (const alloc of allocations) {
        if (alloc.account === 'loanAccount' && alloc.loanIds?.length) {
          for (const loanId of alloc.loanIds) {
            const fakeReq = {
              params: { id: loanId },
              body: { amount: alloc.amount, method: 'wallet' },
              user: { id: userId }
            };
            const fakeRes = {
              status: (code) => ({ json: (data) => console.log('RepayLoan', code, data) }),
              json: (data) => console.log('RepayLoan', data)
            };

            await repayLoan(fakeReq, fakeRes);
          }
        }
      }


      const user = await User.findById(userId);
      const message = {
        title: 'Contribution Received',
        body: `Your contribution of KES ${totalAmount} to ${group.name} has been received and recorded.`
      };
      // Send push notification and handle the result
      const notificationResult = await sendPushNotification(user._id, message);
      
      if (notificationResult.success) {
        Logger.info('Push notification sent successfully', { userId: user._id });
      } else {
        Logger.error('Failed to send push notification', { userId: user._id, reason: notificationResult.reason });
      }
      const emailresult = await sendEmail(user.email, message.title, message.body);
      if (emailresult.success) {
        Logger.info('Email sent successfully', { email: user.email });
      }
      else {
        Logger.error('Email sending failed', { email: user.email, reason: emailresult.reason });
      }
      Logger.info('Contribution recorded successfully');

      res.json({
        message: 'Contribution successful',
        walletBalance: wallet.balance,
        groupBalances: {
          savings: group.savingsAccount.balance,
          loan: group.loanAccount.balance,
          group: group.groupAccount.balance
        },
        contribution
      });
    } catch (error) {
      Logger.error('Error processing wallet contribution', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
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