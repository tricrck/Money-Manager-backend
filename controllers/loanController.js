const Loan = require('../models/Loan');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Group = require('../models/Group');

// Create a new loan (admin only)
exports.createLoan = async (req, res) => {
  try {
    const {
      user,
      group,
      loanType,
      principalAmount,
      repaymentPeriod,
      interestRate,
      interestType,
      processingFee,
      purpose,
      guarantors,
      collateral
    } = req.body;

    // Validate required fields
    if (!user || !principalAmount || !repaymentPeriod) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Create the loan
    const loan = await Loan.create({
      user,
      group,
      loanType: loanType || 'personal',
      principalAmount,
      repaymentPeriod,
      interestRate: interestRate || 10,
      interestType: interestType || 'simple',
      processingFee: processingFee || 0,
      purpose,
      guarantors: guarantors || [],
      collateral: collateral || {},
      status: 'pending'
    });

    // Calculate the repayment schedule
    loan.calculateRepaymentSchedule();
    await loan.save();

    res.status(201).json(loan);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get a specific loan by its ID
exports.getLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('group', 'name description')
      .populate('approvedBy', 'name email')
      .populate('guarantors.user', 'name email phone');

    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    res.json(loan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all loans with filtering options
exports.getAllLoans = async (req, res) => {
  try {
    const {
      status,
      loanType,
      user,
      group,
      minAmount,
      maxAmount,
      startDate,
      endDate,
      sort = 'applicationDate',
      order = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    // Build query
    let query = {};
    
    if (status) query.status = status;
    if (loanType) query.loanType = loanType;
    if (user) query.user = user;
    if (group) query.group = group;
    
    // Amount range
    if (minAmount || maxAmount) {
      query.principalAmount = {};
      if (minAmount) query.principalAmount.$gte = Number(minAmount);
      if (maxAmount) query.principalAmount.$lte = Number(maxAmount);
    }
    
    // Date range
    if (startDate || endDate) {
      query.applicationDate = {};
      if (startDate) query.applicationDate.$gte = new Date(startDate);
      if (endDate) query.applicationDate.$lte = new Date(endDate);
    }

    // Count total documents for pagination
    const totalLoans = await Loan.countDocuments(query);
    
    // Execute query with pagination and sorting
    const loans = await Loan.find(query)
      .populate('user', 'name email')
      .populate('group', 'name')
      .sort({ [sort]: order === 'desc' ? -1 : 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));
    
    res.json({
      loans,
      pagination: {
        total: totalLoans,
        page: Number(page),
        pages: Math.ceil(totalLoans / Number(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get loans for a specific user
exports.getUserLoans = async (req, res) => {
  try {
    const userId = req.params.userId;
    const loans = await Loan.find({ user: userId })
      .populate('group', 'name description')
      .sort({ applicationDate: -1 });
    
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get loans for a specific group
exports.getGroupLoans = async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const loans = await Loan.find({ group: groupId })
      .populate('user', 'name email phone')
      .sort({ applicationDate: -1 });
    
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update loan details
exports.updateLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Prevent status changes through this endpoint
    if (updateData.status) delete updateData.status;
    
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Check if we need to recalculate repayment schedule
    const needsRecalculation = [
      'principalAmount',
      'repaymentPeriod',
      'interestRate',
      'interestType',
      'processingFee',
      'disbursementDate'
    ].some(field => updateData[field] !== undefined);
    
    // Update the loan
    Object.assign(loan, updateData);
    
    // Recalculate repayment schedule if needed
    if (needsRecalculation && loan.status !== 'completed' && loan.status !== 'defaulted') {
      loan.calculateRepaymentSchedule();
    }
    
    // Add note about the update if provided
    if (req.body.noteText) {
      loan.notes.push({
        text: req.body.noteText,
        author: req.user._id // Assuming req.user is set by authentication middleware
      });
    }
    
    await loan.save();
    res.json(loan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a loan
exports.deleteLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Only allow deletion of pending loans
    if (loan.status !== 'pending') {
      return res.status(400).json({ 
        message: 'Only pending loans can be deleted' 
      });
    }
    
    await Loan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Loan deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// User applies for a loan
exports.applyForLoan = async (req, res) => {
  try {
    const userId = req.params.userId; // User applying for loan
    const {
      loanType,
      principalAmount,
      repaymentPeriod,
      interestRate,
      interestType,
      purpose,
      guarantors,
      collateral,
      group
    } = req.body;

    // Validate required fields
    if (!principalAmount || !repaymentPeriod) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // If group loan, validate group
    if (loanType === 'group' && group) {
      const groupExists = await Group.findById(group);
      if (!groupExists) {
        return res.status(404).json({ message: 'Group not found' });
      }
      
      // Check if user is member of the group
      const isMember = await Group.findOne({ 
        _id: group, 
        members: { $elemMatch: { user: userId } } 
      });
      
      if (!isMember) {
        return res.status(403).json({ 
          message: 'User is not a member of this group' 
        });
      }
    }

    // Create new loan application
    const loan = new Loan({
      user: userId,
      group: group || null,
      loanType: loanType || 'personal',
      principalAmount,
      repaymentPeriod,
      interestRate: interestRate || 10,
      interestType: interestType || 'simple',
      purpose: purpose || '',
      guarantors: guarantors || [],
      collateral: collateral || {},
      status: 'pending',
      applicationDate: new Date()
    });

    // Calculate initial repayment schedule (this will be recalculated on approval)
    loan.calculateRepaymentSchedule();
    await loan.save();

    res.status(201).json({ 
      message: 'Loan application submitted successfully', 
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add guarantor to a loan
exports.addGuarantor = async (req, res) => {
  try {
    const { loanId, userId } = req.params;
    
    // Check if loan exists
    const loan = await Loan.findById(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Check if loan is still in a status where guarantors can be added
    if (!['pending', 'approved'].includes(loan.status)) {
      return res.status(400).json({ 
        message: 'Guarantors can only be added to pending or approved loans' 
      });
    }
    
    // Check if user is already a guarantor
    const existingGuarantor = loan.guarantors.find(g => 
      g.user.toString() === userId.toString()
    );
    
    if (existingGuarantor) {
      return res.status(400).json({ 
        message: 'User is already a guarantor for this loan' 
      });
    }
    
    // Add guarantor
    loan.guarantors.push({
      user: userId,
      approved: false
    });
    
    await loan.save();
    
    res.json({ 
      message: 'Guarantor added successfully', 
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Guarantor approves a loan
exports.guarantorApproval = async (req, res) => {
  try {
    const { loanId, guarantorId } = req.params;
    const { approved } = req.body;
    
    const loan = await Loan.findById(loanId);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Find guarantor in the loan
    const guarantorIndex = loan.guarantors.findIndex(g => 
      g.user.toString() === guarantorId.toString()
    );
    
    if (guarantorIndex === -1) {
      return res.status(404).json({ 
        message: 'User is not a guarantor for this loan' 
      });
    }
    
    // Update guarantor approval status
    loan.guarantors[guarantorIndex].approved = approved;
    loan.guarantors[guarantorIndex].approvalDate = new Date();
    
    // Add note about guarantor approval
    loan.notes.push({
      text: `Guarantor ${guarantorId} ${approved ? 'approved' : 'declined'} the loan`,
      author: guarantorId
    });
    
    await loan.save();
    
    res.json({ 
      message: `Guarantor ${approved ? 'approved' : 'declined'} the loan`,
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Approve or reject loan application (admin action)
exports.reviewLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason, noteText } = req.body;
    const adminId = req.user._id; // Assuming req.user is set by authentication middleware
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ 
        message: 'Status must be either approved or rejected' 
      });
    }
    
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Ensure loan is in pending status
    if (loan.status !== 'pending') {
      return res.status(400).json({ 
        message: `Cannot ${status} loan that is not in pending status` 
      });
    }
    
    // If rejecting, require a reason
    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({ 
        message: 'Rejection reason is required'
      });
    }
    
    // For group loans, check if all required guarantors have approved
    if (loan.loanType === 'group' && status === 'approved') {
      const pendingGuarantors = loan.guarantors.filter(g => !g.approved);
      if (pendingGuarantors.length > 0) {
        return res.status(400).json({ 
          message: 'All guarantors must approve before the loan can be approved' 
        });
      }
    }
    
    // Update loan status
    loan.status = status;
    
    if (status === 'approved') {
      loan.approvalDate = new Date();
      loan.approvedBy = adminId;
    } else {
      loan.rejectionReason = rejectionReason;
    }
    
    // Add note
    if (noteText || status === 'rejected') {
      loan.notes.push({
        text: noteText || `Loan ${status}: ${rejectionReason || ''}`,
        author: adminId
      });
    }
    
    await loan.save();
    
    res.json({ 
      message: `Loan ${status} successfully`, 
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Disburse approved loan (admin action)
exports.disburseLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { disbursedAmount, noteText } = req.body;
    const adminId = req.user._id; // Assuming req.user is set by authentication middleware
    
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Ensure loan is in approved status
    if (loan.status !== 'approved') {
      return res.status(400).json({ 
        message: 'Only approved loans can be disbursed' 
      });
    }
    
    // Set the disbursed amount, defaulting to principal minus processing fee if not specified
    const processingFee = loan.processingFee || 0;
    loan.disbursedAmount = disbursedAmount || (loan.principalAmount - processingFee);
    loan.disbursementDate = new Date();
    loan.status = 'disbursed';
    
    // Recalculate repayment schedule now that we have the actual disbursement date
    loan.calculateRepaymentSchedule();
    
    // Set the first payment due date and amount
    if (loan.repaymentSchedule.length > 0) {
      const firstPayment = loan.repaymentSchedule[0];
      loan.nextPaymentDue = {
        amount: firstPayment.totalAmount,
        dueDate: firstPayment.dueDate
      };
    }
    
    // Add note
    if (noteText) {
      loan.notes.push({
        text: noteText,
        author: adminId
      });
    }
    
    await loan.save();
    
    // Credit the user's wallet
    try {
      const wallet = await Wallet.findOne({ user: loan.user });
      if (wallet) {
        wallet.balance += loan.disbursedAmount;
        wallet.transactions.push({
          type: 'credit',
          amount: loan.disbursedAmount,
          description: `Loan disbursement for loan ID: ${loan._id}`,
          date: new Date()
        });
        await wallet.save();
      }
    } catch (walletError) {
      // Continue with the disbursement even if wallet update fails
      // but add a note about the issue
      loan.notes.push({
        text: `Failed to credit wallet: ${walletError.message}`,
        author: adminId
      });
      await loan.save();
    }
    
    res.json({ 
      message: 'Loan disbursed successfully', 
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Process loan repayment
exports.repayLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, receiptNumber, noteText } = req.body;
    const userId = req.user._id; // Assuming req.user is set by authentication middleware
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }
    
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    // Ensure loan is in a status where repayment is possible
    if (!['disbursed', 'active'].includes(loan.status)) {
      return res.status(400).json({ 
        message: 'Loan must be disbursed or active to accept repayments' 
      });
    }
    
    // Update loan status to active if it was just disbursed
    if (loan.status === 'disbursed') {
      loan.status = 'active';
    }
    
    // Update amount repaid
    const previousAmountRepaid = loan.amountRepaid || 0;
    loan.amountRepaid = previousAmountRepaid + amount;
    
    // Process payment against the repayment schedule
    let remainingAmount = amount;
    const today = new Date();
    
    for (let i = 0; i < loan.repaymentSchedule.length; i++) {
      const installment = loan.repaymentSchedule[i];
      
      // Skip if already fully paid
      if (installment.paid) continue;
      
      const remainingInstallmentAmount = installment.totalAmount - installment.paidAmount;
      
      if (remainingAmount >= remainingInstallmentAmount) {
        // Full payment for this installment
        installment.paidAmount = installment.totalAmount;
        installment.paid = true;
        installment.paidDate = today;
        remainingAmount -= remainingInstallmentAmount;
      } else {
        // Partial payment
        installment.paidAmount += remainingAmount;
        remainingAmount = 0;
      }
      
      // Update the loan's repayment schedule
      loan.repaymentSchedule[i] = installment;
      
      if (remainingAmount <= 0) break;
    }
    
    // Check if loan is fully repaid
    const isFullyRepaid = loan.repaymentSchedule.every(installment => installment.paid);
    
    if (isFullyRepaid) {
      loan.status = 'completed';
      loan.completionDate = today;
    } else {
      // Update next payment due
      const nextUnpaidInstallment = loan.repaymentSchedule.find(installment => !installment.paid);
      if (nextUnpaidInstallment) {
        loan.nextPaymentDue = {
          amount: nextUnpaidInstallment.totalAmount - nextUnpaidInstallment.paidAmount,
          dueDate: nextUnpaidInstallment.dueDate
        };
      }
    }
    
    // Add note about payment
    loan.notes.push({
      text: noteText || `Payment of ${amount} received${receiptNumber ? ` (Receipt: ${receiptNumber})` : ''}${paymentMethod ? ` via ${paymentMethod}` : ''}`,
      author: userId
    });
    
    await loan.save();
    
    res.json({ 
      message: isFullyRepaid ? 'Loan fully repaid' : 'Payment processed successfully', 
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Mark late fees for overdue payments
exports.assessLateFees = async (req, res) => {
  try {
    const { id } = req.params;
    const { lateFeePercentage, assessmentDate, noteText } = req.body;
    const adminId = req.user._id; // Assuming req.user is set by authentication middleware
    
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    const assessDate = assessmentDate ? new Date(assessmentDate) : new Date();
    let lateFeesAssessed = false;
    
    // Iterate through repayment schedule and assess late fees
    loan.repaymentSchedule.forEach((installment, index) => {
      if (!installment.paid && new Date(installment.dueDate) < assessDate) {
        const percentageRate = lateFeePercentage || 5; // Default 5% late fee
        const lateFee = (installment.totalAmount - installment.paidAmount) * (percentageRate / 100);
        
        // Only add late fee if not previously assessed
        if (installment.lateFee === 0) {
          installment.lateFee = lateFee;
          lateFeesAssessed = true;
          
          // Update total repayable amount
          loan.totalRepayableAmount += lateFee;
        }
      }
    });
    
    if (lateFeesAssessed) {
      // Add note about late fees
      loan.notes.push({
        text: noteText || `Late fees assessed on ${assessDate.toISOString().split('T')[0]}`,
        author: adminId
      });
      
      await loan.save();
      
      res.json({ 
        message: 'Late fees assessed successfully', 
        loan 
      });
    } else {
      res.json({ 
        message: 'No new late fees to assess', 
        loan 
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Mark loan as defaulted
exports.markDefaulted = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user._id; // Assuming req.user is set by authentication middleware
    
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    
    if (!['active', 'disbursed'].includes(loan.status)) {
      return res.status(400).json({ 
        message: 'Only active or disbursed loans can be marked as defaulted' 
      });
    }
    
    loan.status = 'defaulted';
    
    // Add note about default
    loan.notes.push({
      text: `Loan marked as defaulted. Reason: ${reason || 'Not specified'}`,
      author: adminId
    });
    
    await loan.save();
    
    res.json({ 
      message: 'Loan marked as defaulted', 
      loan 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get loan statistics
exports.getLoanStatistics = async (req, res) => {
  try {
    const { startDate, endDate, loanType, groupId } = req.query;
    
    // Build date range query
    let dateQuery = {};
    if (startDate || endDate) {
      dateQuery = {};
      if (startDate) dateQuery.$gte = new Date(startDate);
      if (endDate) dateQuery.$lte = new Date(endDate);
    }
    
    // Build overall query
    let query = {};
    if (Object.keys(dateQuery).length > 0) query.applicationDate = dateQuery;
    if (loanType) query.loanType = loanType;
    if (groupId) query.group = groupId;
    
    // Get aggregate statistics
    const stats = await Loan.aggregate([
      { $match: query },
      { $group: {
        _id: null,
        totalLoans: { $sum: 1 },
        totalAmount: { $sum: '$principalAmount' },
        totalDisbursed: { 
          $sum: { 
            $cond: [
              { $in: ['$status', ['disbursed', 'active', 'completed', 'defaulted']] }, 
              '$disbursedAmount', 
              0
            ] 
          } 
        },
        totalRepaid: { $sum: '$amountRepaid' },
        avgInterestRate: { $avg: '$interestRate' },
        avgRepaymentPeriod: { $avg: '$repaymentPeriod' },
        disbursedCount: { 
          $sum: { 
            $cond: [
              { $in: ['$status', ['disbursed', 'active', 'completed', 'defaulted']] }, 
              1, 0
            ] 
          } 
        },
        completedCount: { 
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } 
        },
        defaultedCount: { 
          $sum: { $cond: [{ $eq: ['$status', 'defaulted'] }, 1, 0] } 
        },
        pendingCount: { 
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } 
        },
        approvedCount: { 
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } 
        },
        activeCount: { 
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } 
        }
      }}
    ]);
    
    // Get loan stats by type
    const statsByType = await Loan.aggregate([
      { $match: query },
      { $group: {
        _id: '$loanType',
        count: { $sum: 1 },
        totalAmount: { $sum: '$principalAmount' },
        avgInterestRate: { $avg: '$interestRate' }
      }}
    ]);
    
    // Calculate default rate
    const defaultRate = stats.length > 0 && stats[0].disbursedCount > 0 
      ? (stats[0].defaultedCount / stats[0].disbursedCount) * 100 
      : 0;
    
    // Calculate completion rate
    const completionRate = stats.length > 0 && stats[0].disbursedCount > 0 
      ? (stats[0].completedCount / stats[0].disbursedCount) * 100 
      : 0;
    
    res.json({
      overall: stats.length > 0 ? {
        ...stats[0],
        defaultRate,
        completionRate
      } : {
        totalLoans: 0,
        totalAmount: 0,
        totalDisbursed: 0,
        totalRepaid: 0,
        defaultRate: 0,
        completionRate: 0
      },
      byType: statsByType.map(type => ({
        loanType: type._id,
        count: type.count,
        totalAmount: type.totalAmount,
        avgInterestRate: type.avgInterestRate
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};