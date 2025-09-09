/**
 * Group Type Policies Engine
 * Defines specific rules and business logic for each group type
 */

class GroupTypePolicies {
  
  /**
   * CHAMA (Merry-Go-Round) Policies
   */
  static getChamaPolicies() {
    return {
      // Core business rules
      contributionModel: 'merry_go_round',
      allowPartialContributions: false,
      requiresEqualContributions: true,
      payoutSystem: 'rotation',
      
      // Financial constraints
      minMembers: 3,
      maxMembers: 50,
      contributionFrequency: ['weekly', 'monthly'],
      
      // Loan policies
      loanEligibility: {
        requiresContributionHistory: 3, // minimum cycles
        maxLoanToSavingsRatio: 2,
        interestRate: 5, // 5% per month
        requiresGuarantors: true,
        guarantorsRequired: 2
      },
      
      // Payout policies
      payoutOrder: 'rotation', // 'rotation', 'random', 'bidding'
      allowEmergencyPayouts: true,
      penaltyForMissedContribution: 0.1, // 10% of contribution amount
      
      // Account structure
      accounts: ['savingsAccount', 'loanAccount', 'finesAccount'],
      defaultAccount: 'savingsAccount',
      
      // Voting requirements
      majorDecisionThreshold: 0.75, // 75% majority
      memberExitPolicy: 'complete_cycle', // Must complete current cycle
      
      // Cycle management
      cycleTracking: true,
      autoAdvanceCycle: true,
      allowCyclePause: true
    };
  }

  /**
   * SACCO Policies (Based on Kenya Highlands SACCO model)
   */
  static getSaccoPolicies() {
    return {
      // Core business model
      contributionModel: 'continuous_savings',
      allowPartialContributions: true,
      requiresEqualContributions: false,
      payoutSystem: 'dividend_based',
      
      // Regulatory compliance
      minMembers: 10,
      maxMembers: 10000,
      minShareCapital: 1000, // KES
      contributionFrequency: ['weekly', 'monthly', 'quarterly'],
      
      // FOSA (Front Office Services) & BOSA (Back Office Services)
      serviceTypes: ['FOSA', 'BOSA'],
      allowNonMemberServices: true, // FOSA can serve non-members
      
      // Loan policies
      loanEligibility: {
        requiresContributionHistory: 6, // months
        maxLoanToSavingsRatio: 4,
        interestRate: 1.5, // 1.5% per month
        requiresGuarantors: true,
        guarantorsRequired: 3,
        maxLoanAmount: 2000000, // KES 2M
        minLoanAmount: 5000 // KES 5K
      },
      
      // Share capital management
      shareCapitalRequired: true,
      minShareValue: 100, // KES per share
      maxSharesPerMember: 10000,
      dividendDistribution: 'annual',
      
      // Account structure
      accounts: [
        'savingsAccount', 
        'shareCapitalAccount',
        'loanAccount', 
        'interestEarnedAccount',
        'finesAccount',
        'dividendAccount',
        'statutoryReserveAccount'
      ],
      defaultAccount: 'savingsAccount',
      
      // Governance
      requiresBoard: true,
      annualGeneralMeeting: true,
      auditRequired: true,
      majorDecisionThreshold: 0.67, // 67% majority
      
      // Financial ratios (regulatory)
      maxLoanToDepositRatio: 0.8,
      minCapitalAdequacyRatio: 0.08,
      maxBadDebtRatio: 0.05
    };
  }

  /**
   * TABLE BANKING Policies (Seewo model)
   */
  static getTableBankingPolicies() {
    return {
      // Core business model
      contributionModel: 'table_banking',
      allowPartialContributions: false,
      requiresEqualContributions: true,
      payoutSystem: 'immediate_lending',
      
      // Meeting-based operations
      meetingRequired: true,
      minMembers: 12,
      maxMembers: 25,
      contributionFrequency: ['weekly', 'monthly'],
      
      // Lending policies
      loanEligibility: {
        requiresContributionHistory: 2, // meetings
        maxLoanToSavingsRatio: 3,
        interestRate: 10, // 10% per month (high risk, high return)
        requiresGuarantors: false, // Group guarantee
        maxLoanAmount: null, // Based on group funds
        immediateDisbursement: true
      },
      
      // Meeting dynamics
      lendingRounds: 3, // per meeting
      biddingSystem: true,
      auctionBasedInterest: true,
      socialCollateral: true,
      
      // Account structure
      accounts: ['savingsAccount', 'loanAccount', 'interestEarnedAccount'],
      defaultAccount: 'savingsAccount',
      
      // Risk management
      groupLiability: true,
      socialPressureCollection: true,
      meetingAttendanceRequired: 0.8, // 80%
      
      // Financial discipline
      penaltyForMissedMeeting: 200, // KES
      penaltyForLatePayment: 0.05, // 5% of installment
      maxConsecutiveMissedPayments: 2
    };
  }

  /**
   * INVESTMENT CLUB Policies (MMF model)
   */
  static getInvestmentClubPolicies() {
    return {
      // Core business model
      contributionModel: 'investment_pooling',
      allowPartialContributions: true,
      requiresEqualContributions: false,
      payoutSystem: 'market_based_returns',
      
      // Investment focus
      minMembers: 5,
      maxMembers: 100,
      minInvestmentAmount: 5000, // KES
      contributionFrequency: ['monthly', 'quarterly', 'annual'],
      
      // Investment policies
      investmentTypes: [
        'money_market_funds',
        'government_bonds',
        'corporate_bonds',
        'equity_funds',
        'real_estate'
      ],
      
      // Risk management
      diversificationRequired: true,
      maxSingleInvestmentRatio: 0.25, // 25% of portfolio
      riskTolerance: 'moderate_to_aggressive',
      
      // Professional management
      requiresInvestmentCommittee: true,
      professionalAdvice: 'recommended',
      performanceReporting: 'quarterly',
      
      // Loan policies (limited)
      loanEligibility: {
        requiresContributionHistory: 12, // months
        maxLoanToSavingsRatio: 1.5,
        interestRate: 12, // 12% per annum
        requiresGuarantors: true,
        guarantorsRequired: 2,
        emergencyLoansOnly: true
      },
      
      // Account structure
      accounts: [
        'investmentAccount',
        'dividendAccount', 
        'savingsAccount',
        'loanAccount',
        'managementFeeAccount'
      ],
      defaultAccount: 'investmentAccount',
      
      // Returns and fees
      managementFee: 0.02, // 2% annually
      performanceFee: 0.1, // 10% of profits
      dividendDistribution: 'quarterly',
      minimumRetentionRatio: 0.2, // 20% retained for reinvestment
      
      // Governance
      investmentCommitteeSize: 3,
      majorDecisionThreshold: 0.6, // 60% majority
      exitNoticePeriod: 90 // days
    };
  }

  /**
   * Get policies for specific group type
   */
  static getPolicies(groupType) {
    switch (groupType) {
      case 'chama':
        return this.getChamaPolicies();
      case 'sacco':
        return this.getSaccoPolicies();
      case 'table_banking':
        return this.getTableBankingPolicies();
      case 'investment_club':
        return this.getInvestmentClubPolicies();
      default:
        throw new Error(`Unknown group type: ${groupType}`);
    }
  }

  /**
   * Validate group operation against policies
   */
  static validateOperation(groupType, operation, params) {
    const policies = this.getPolicies(groupType);
    const validations = [];

    // Common validations
    if (operation === 'contribution') {
      if (!policies.allowPartialContributions && params.amount < params.expectedAmount) {
        validations.push({
          valid: false,
          message: 'Partial contributions not allowed for this group type'
        });
      }

      if (policies.requiresEqualContributions && params.amount !== params.standardAmount) {
        validations.push({
          valid: false,
          message: 'All contributions must be equal for this group type'
        });
      }
    }

    if (operation === 'loan_application') {
      const maxLoan = params.memberSavings * policies.loanEligibility.maxLoanToSavingsRatio;
      if (params.amount > maxLoan) {
        validations.push({
          valid: false,
          message: `Loan amount exceeds maximum allowed (${maxLoan} based on savings)`
        });
      }

      if (policies.loanEligibility.requiresGuarantors && 
          params.guarantors.length < policies.loanEligibility.guarantorsRequired) {
        validations.push({
          valid: false,
          message: `Minimum ${policies.loanEligibility.guarantorsRequired} guarantors required`
        });
      }
    }

    return {
      valid: validations.every(v => v.valid),
      validations
    };
  }

  /**
   * Apply group-specific business logic
   */
  static applyBusinessLogic(groupType, operation, group, params) {
    const policies = this.getPolicies(groupType);
    
    switch (groupType) {
      case 'chama':
        return this.applyChamaLogic(operation, group, params, policies);
      case 'sacco':
        return this.applySaccoLogic(operation, group, params, policies);
      case 'table_banking':
        return this.applyTableBankingLogic(operation, group, params, policies);
      case 'investment_club':
        return this.applyInvestmentClubLogic(operation, group, params, policies);
      default:
        throw new Error(`Business logic not implemented for ${groupType}`);
    }
  }

  /**
   * Chama-specific business logic
   */
  static applyChamaLogic(operation, group, params, policies) {
    switch (operation) {
      case 'contribution':
        // Check if it's member's turn to receive payout
        const currentCycle = group.chamaData?.currentCycle || 1;
        const memberIndex = group.members.findIndex(m => m.user.toString() === params.memberId);
        const currentRecipientIndex = (currentCycle - 1) % group.members.length;
        
        if (memberIndex === currentRecipientIndex) {
          // This member should receive the payout
          const totalContributions = group.members.length * params.amount;
          return {
            action: 'payout',
            recipientId: params.memberId,
            amount: totalContributions,
            nextCycle: currentRecipientIndex === group.members.length - 1 ? currentCycle + 1 : currentCycle
          };
        }
        break;
        
      case 'cycle_advance':
        // Automatically advance to next cycle
        const nextRecipientIndex = (group.chamaData.currentRecipientIndex + 1) % group.members.length;
        return {
          action: 'advance_cycle',
          nextRecipientIndex,
          cycleComplete: nextRecipientIndex === 0
        };
    }
    
    return null;
  }

  /**
   * SACCO-specific business logic
   */
  static applySaccoLogic(operation, group, params, policies) {
    switch (operation) {
      case 'dividend_calculation':
        // Calculate dividends based on share capital and savings
        const totalSavings = group.savingsAccount.balance;
        const totalShares = group.shareCapitalAccount?.balance || 0;
        const netIncome = group.interestEarnedAccount.balance - group.expenses;
        
        return {
          action: 'calculate_dividends',
          dividendRate: netIncome / (totalSavings + totalShares),
          eligibleMembers: group.members.filter(m => m.contributions.total > 0)
        };
        
      case 'loan_application':
        // SACCO loan processing
        const memberSavings = params.memberSavings;
        const memberShares = params.memberShares || 0;
        const maxLoanAmount = (memberSavings + memberShares) * policies.loanEligibility.maxLoanToSavingsRatio;
        
        return {
          action: 'process_sacco_loan',
          maxAmount: maxLoanAmount,
          interestRate: policies.loanEligibility.interestRate,
          processingFee: params.amount * 0.01 // 1% processing fee
        };
    }
    
    return null;
  }

  /**
   * Table Banking-specific business logic
   */
  static applyTableBankingLogic(operation, group, params, policies) {
    switch (operation) {
      case 'meeting_lending':
        // Table banking meeting-based lending
        const availableFunds = group.savingsAccount.balance;
        const interestRate = params.biddedRate || policies.loanEligibility.interestRate;
        
        return {
          action: 'immediate_loan_disbursement',
          amount: Math.min(params.requestedAmount, availableFunds),
          interestRate,
          repaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          socialGuarantee: true
        };
        
      case 'auction_interest':
        // Interest rate bidding system
        const baseBid = policies.loanEligibility.interestRate;
        return {
          action: 'start_interest_auction',
          minimumRate: baseBid,
          biddingRounds: 3
        };
    }
    
    return null;
  }

  /**
   * Investment Club-specific business logic
   */
  static applyInvestmentClubLogic(operation, group, params, policies) {
    switch (operation) {
      case 'investment_decision':
        // Investment club portfolio management
        const totalInvestmentFunds = group.investmentAccount.balance;
        const maxSingleInvestment = totalInvestmentFunds * policies.maxSingleInvestmentRatio;
        
        return {
          action: 'process_investment',
          maxInvestmentAmount: maxSingleInvestment,
          requiresCommitteeApproval: params.amount > maxSingleInvestment * 0.5,
          managementFee: params.amount * policies.managementFee / 12 // monthly fee
        };
        
      case 'performance_review':
        // Quarterly performance review
        return {
          action: 'generate_performance_report',
          period: 'quarterly',
          calculateROI: true,
          distributeDividends: params.quarter === 4 // Annual dividend
        };
    }
    
    return null;
  }
}

module.exports = GroupTypePolicies;