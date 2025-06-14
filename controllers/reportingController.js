const Payment = require('../models/Payment');
const Wallet = require('../models/Wallet');
const mongoose = require('mongoose');
const moment = require('moment');

/**
 * Generate user statement for a specific period
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserStatement = async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      startDate, 
      endDate, 
      type = 'monthly', // monthly, weekly, daily, custom
      paymentMethod, 
      status,
      format = 'json' // json, csv, pdf
    } = req.query;

    // Calculate date range based on type
    let dateRange = {};
    const now = moment();
    
    switch (type) {
      case 'daily':
        dateRange = {
          startDate: moment().startOf('day').toDate(),
          endDate: moment().endOf('day').toDate()
        };
        break;
      case 'weekly':
        dateRange = {
          startDate: moment().startOf('week').toDate(),
          endDate: moment().endOf('week').toDate()
        };
        break;
      case 'monthly':
        dateRange = {
          startDate: moment().startOf('month').toDate(),
          endDate: moment().endOf('month').toDate()
        };
        break;
      case 'custom':
        if (!startDate || !endDate) {
          return res.status(400).json({ error: 'Start date and end date are required for custom range' });
        }
        dateRange = {
          startDate: moment(startDate).startOf('day').toDate(),
          endDate: moment(endDate).endOf('day').toDate()
        };
        break;
      default:
        dateRange = {
          startDate: moment().startOf('month').toDate(),
          endDate: moment().endOf('month').toDate()
        };
    }

    // Build query filters
    const filters = {
    userId: new mongoose.Types.ObjectId(userId),
    createdAt: {
        $gte: dateRange.startDate,
        $lte: dateRange.endDate
    }
    };

    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (status) filters.status = status;


    // Get payments
    const payments = await Payment.find(filters)
      .sort({ createdAt: -1 })
      .populate('userId', 'name email phone');

    // Get wallet transactions for the same period
    const wallet = await Wallet.findOne({ user: userId });
    let walletTransactions = [];
    
    if (wallet) {
      walletTransactions = wallet.transactions.filter(transaction => {
        const transactionDate = moment(transaction.date);
        return transactionDate.isBetween(dateRange.startDate, dateRange.endDate, null, '[]');
      });
    }

    // Calculate summary statistics
    const summary = {
      totalTransactions: payments.length,
      totalAmount: payments.reduce((sum, payment) => sum + Math.abs(payment.amount), 0),
      totalDeposits: payments.filter(p => p.amount > 0).reduce((sum, p) => sum + p.amount, 0),
      totalWithdrawals: payments.filter(p => p.amount < 0).reduce((sum, p) => sum + Math.abs(p.amount), 0),
      successfulTransactions: payments.filter(p => p.status === 'success').length,
      failedTransactions: payments.filter(p => p.status === 'failed').length,
      pendingTransactions: payments.filter(p => p.status === 'pending').length,
      currentBalance: wallet ? wallet.balance : 0,
      currency: wallet ? wallet.currency : 'KES'
    };

    // Group by payment method
    const paymentMethodBreakdown = payments.reduce((acc, payment) => {
      const method = payment.paymentMethod;
      if (!acc[method]) {
        acc[method] = { count: 0, amount: 0 };
      }
      acc[method].count += 1;
      acc[method].amount += Math.abs(payment.amount);
      return acc;
    }, {});

    // Group by status
    const statusBreakdown = payments.reduce((acc, payment) => {
      const status = payment.status;
      if (!acc[status]) {
        acc[status] = { count: 0, amount: 0 };
      }
      acc[status].count += 1;
      acc[status].amount += Math.abs(payment.amount);
      return acc;
    }, {});

    const statement = {
      user: payments[0]?.userId || { _id: userId },
      period: {
        type,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      },
      summary,
      paymentMethodBreakdown,
      statusBreakdown,
      transactions: payments,
      walletTransactions,
      generatedAt: new Date()
    };

    res.json(statement);
  } catch (error) {
    console.error('Error generating user statement:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generate admin transaction report
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAdminTransactionReport = async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      type = 'monthly',
      paymentMethod, 
      status,
      groupBy = 'day' // day, week, month, paymentMethod, status
    } = req.query;

    // Calculate date range
    let dateRange = {};
    
    switch (type) {
      case 'daily':
        dateRange = {
          startDate: moment().startOf('day').toDate(),
          endDate: moment().endOf('day').toDate()
        };
        break;
      case 'weekly':
        dateRange = {
          startDate: moment().startOf('week').toDate(),
          endDate: moment().endOf('week').toDate()
        };
        break;
      case 'monthly':
        dateRange = {
          startDate: moment().startOf('month').toDate(),
          endDate: moment().endOf('month').toDate()
        };
        break;
      case 'custom':
        if (!startDate || !endDate) {
          return res.status(400).json({ error: 'Start date and end date are required for custom range' });
        }
        dateRange = {
          startDate: moment(startDate).startOf('day').toDate(),
          endDate: moment(endDate).endOf('day').toDate()
        };
        break;
      default:
        dateRange = {
          startDate: moment().startOf('month').toDate(),
          endDate: moment().endOf('month').toDate()
        };
    }

    // Build query filters
    const filters = {
      createdAt: {
        $gte: dateRange.startDate,
        $lte: dateRange.endDate
      }
    };

    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (status) filters.status = status;

    // Get all payments
    const payments = await Payment.find(filters)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 });

    // Calculate overall summary
    const summary = {
      totalTransactions: payments.length,
      totalAmount: payments.reduce((sum, payment) => sum + Math.abs(payment.amount), 0),
      totalDeposits: payments.filter(p => p.amount > 0).reduce((sum, p) => sum + p.amount, 0),
      totalWithdrawals: payments.filter(p => p.amount < 0).reduce((sum, p) => sum + Math.abs(p.amount), 0),
      successfulTransactions: payments.filter(p => p.status === 'success').length,
      failedTransactions: payments.filter(p => p.status === 'failed').length,
      pendingTransactions: payments.filter(p => p.status === 'pending').length,
      refundedTransactions: payments.filter(p => p.status === 'refunded').length,
      averageTransactionAmount: payments.length > 0 ? payments.reduce((sum, p) => sum + Math.abs(p.amount), 0) / payments.length : 0
    };

    // Group data based on groupBy parameter
    let groupedData = {};
    
    switch (groupBy) {
      case 'day':
        groupedData = payments.reduce((acc, payment) => {
          const day = moment(payment.createdAt).format('YYYY-MM-DD');
          if (!acc[day]) {
            acc[day] = { count: 0, amount: 0, transactions: [] };
          }
          acc[day].count += 1;
          acc[day].amount += Math.abs(payment.amount);
          acc[day].transactions.push(payment);
          return acc;
        }, {});
        break;
        
      case 'week':
        groupedData = payments.reduce((acc, payment) => {
          const week = moment(payment.createdAt).format('YYYY-[W]WW');
          if (!acc[week]) {
            acc[week] = { count: 0, amount: 0, transactions: [] };
          }
          acc[week].count += 1;
          acc[week].amount += Math.abs(payment.amount);
          acc[week].transactions.push(payment);
          return acc;
        }, {});
        break;
        
      case 'month':
        groupedData = payments.reduce((acc, payment) => {
          const month = moment(payment.createdAt).format('YYYY-MM');
          if (!acc[month]) {
            acc[month] = { count: 0, amount: 0, transactions: [] };
          }
          acc[month].count += 1;
          acc[month].amount += Math.abs(payment.amount);
          acc[month].transactions.push(payment);
          return acc;
        }, {});
        break;
        
      case 'paymentMethod':
        groupedData = payments.reduce((acc, payment) => {
          const method = payment.paymentMethod;
          if (!acc[method]) {
            acc[method] = { count: 0, amount: 0, transactions: [] };
          }
          acc[method].count += 1;
          acc[method].amount += Math.abs(payment.amount);
          acc[method].transactions.push(payment);
          return acc;
        }, {});
        break;
        
      case 'status':
        groupedData = payments.reduce((acc, payment) => {
          const status = payment.status;
          if (!acc[status]) {
            acc[status] = { count: 0, amount: 0, transactions: [] };
          }
          acc[status].count += 1;
          acc[status].amount += Math.abs(payment.amount);
          acc[status].transactions.push(payment);
          return acc;
        }, {});
        break;
    }

    // Payment method breakdown
    const paymentMethodBreakdown = payments.reduce((acc, payment) => {
      const method = payment.paymentMethod;
      if (!acc[method]) {
        acc[method] = { count: 0, amount: 0, successRate: 0 };
      }
      acc[method].count += 1;
      acc[method].amount += Math.abs(payment.amount);
      return acc;
    }, {});

    // Calculate success rates
    Object.keys(paymentMethodBreakdown).forEach(method => {
      const methodPayments = payments.filter(p => p.paymentMethod === method);
      const successfulPayments = methodPayments.filter(p => p.status === 'success');
      paymentMethodBreakdown[method].successRate = methodPayments.length > 0 ? 
        (successfulPayments.length / methodPayments.length) * 100 : 0;
    });

    const report = {
      period: {
        type,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      },
      summary,
      groupedData,
      paymentMethodBreakdown,
      recentTransactions: payments.slice(0, 50), // Last 50 transactions
      generatedAt: new Date()
    };

    res.json(report);
  } catch (error) {
    console.error('Error generating admin report:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get advanced analytics dashboard data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAdvancedAnalytics = async (req, res) => {
  try {
    const { period = '30d' } = req.query; // 7d, 30d, 90d, 1y

    let startDate;
    switch (period) {
      case '7d':
        startDate = moment().subtract(7, 'days').startOf('day').toDate();
        break;
      case '30d':
        startDate = moment().subtract(30, 'days').startOf('day').toDate();
        break;
      case '90d':
        startDate = moment().subtract(90, 'days').startOf('day').toDate();
        break;
      case '1y':
        startDate = moment().subtract(1, 'year').startOf('day').toDate();
        break;
      default:
        startDate = moment().subtract(30, 'days').startOf('day').toDate();
    }

    const endDate = moment().endOf('day').toDate();

    // Aggregate pipeline for advanced analytics
    const analyticsData = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
            paymentMethod: '$paymentMethod',
            status: '$status'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
          avgAmount: { $avg: { $abs: '$amount' } }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Time series data for charts
    const timeSeriesData = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
          successfulTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failedTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Top users by transaction volume
    const topUsers = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
          avgAmount: { $avg: { $abs: '$amount' } }
        }
      },
      {
        $sort: { totalAmount: -1 }
      },
      {
        $limit: 10
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      }
    ]);

    // Payment method performance
    const paymentMethodPerformance = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
          successfulTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failedTransactions: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          avgAmount: { $avg: { $abs: '$amount' } },
          avgProcessingTime: { $avg: '$processingTime' }
        }
      },
      {
        $addFields: {
          successRate: {
            $multiply: [
              { $divide: ['$successfulTransactions', '$totalTransactions'] },
              100
            ]
          }
        }
      }
    ]);

    // Hour-by-hour transaction patterns
    const hourlyPattern = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Day-of-week patterns
    const dayOfWeekPattern = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $dayOfWeek: '$createdAt' },
          count: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Currency breakdown
    const currencyBreakdown = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } }
        }
      }
    ]);

    // Calculate growth rates
    const previousPeriodStart = moment(startDate).subtract(moment(endDate).diff(startDate)).toDate();
    const previousPeriodData = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: previousPeriodStart, $lt: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } }
        }
      }
    ]);

    const currentPeriodData = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } }
        }
      }
    ]);

    const growthRates = {
      transactionGrowth: 0,
      amountGrowth: 0
    };

    if (previousPeriodData.length > 0 && currentPeriodData.length > 0) {
      const prev = previousPeriodData[0];
      const curr = currentPeriodData[0];
      
      growthRates.transactionGrowth = prev.totalTransactions > 0 ? 
        ((curr.totalTransactions - prev.totalTransactions) / prev.totalTransactions) * 100 : 0;
      growthRates.amountGrowth = prev.totalAmount > 0 ? 
        ((curr.totalAmount - prev.totalAmount) / prev.totalAmount) * 100 : 0;
    }

    const analytics = {
      period: {
        startDate,
        endDate,
        duration: period
      },
      rawData: analyticsData,
      timeSeriesData,
      topUsers,
      paymentMethodPerformance,
      hourlyPattern,
      dayOfWeekPattern,
      currencyBreakdown,
      growthRates,
      generatedAt: new Date()
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error generating advanced analytics:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Export transaction data in various formats
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.exportTransactionData = async (req, res) => {
  try {
    const { 
      format = 'json', // json, csv, excel
      startDate, 
      endDate,
      userId,
      paymentMethod,
      status,
      includeMetadata = false
    } = req.query;

    // Build query filters
    const filters = {};
    
    if (startDate && endDate) {
      filters.createdAt = {
        $gte: moment(startDate).startOf('day').toDate(),
        $lte: moment(endDate).endOf('day').toDate()
      };
    }
    
    if (userId) filters.userId = mongoose.Types.ObjectId(userId);
    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (status) filters.status = status;

    // Get transactions
    const transactions = await Payment.find(filters)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .lean();

    // Format data based on export format
    let exportData;
    
    switch (format.toLowerCase()) {
      case 'csv':
        // Convert to CSV format
        const csvHeaders = [
          'Transaction ID',
          'User Name',
          'User Email',
          'Payment Method',
          'Amount',
          'Currency',
          'Status',
          'Purpose',
          'Date',
          'Description'
        ];
        
        if (includeMetadata === 'true') {
          csvHeaders.push('Metadata');
        }
        
        const csvRows = transactions.map(transaction => {
          const row = [
            transaction.transactionId,
            transaction.userId?.name || 'N/A',
            transaction.userId?.email || 'N/A',
            transaction.paymentMethod,
            transaction.amount,
            transaction.currency,
            transaction.status,
            transaction.paymentPurpose,
            moment(transaction.createdAt).format('YYYY-MM-DD HH:mm:ss'),
            transaction.description || ''
          ];
          
          if (includeMetadata === 'true') {
            row.push(JSON.stringify(transaction.metadata || {}));
          }
          
          return row;
        });
        
        exportData = [csvHeaders, ...csvRows]
          .map(row => row.map(cell => `"${cell}"`).join(','))
          .join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=transactions_${moment().format('YYYY-MM-DD')}.csv`);
        break;
        
      case 'excel':
        // For Excel, we'll return JSON that can be converted to Excel on the client side
        exportData = {
          worksheets: [
            {
              name: 'Transactions',
              data: transactions.map(transaction => ({
                'Transaction ID': transaction.transactionId,
                'User Name': transaction.userId?.name || 'N/A',
                'User Email': transaction.userId?.email || 'N/A',
                'Payment Method': transaction.paymentMethod,
                'Amount': transaction.amount,
                'Currency': transaction.currency,
                'Status': transaction.status,
                'Purpose': transaction.paymentPurpose,
                'Date': moment(transaction.createdAt).format('YYYY-MM-DD HH:mm:ss'),
                'Description': transaction.description || '',
                ...(includeMetadata === 'true' && { 'Metadata': JSON.stringify(transaction.metadata || {}) })
              }))
            }
          ]
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=transactions_${moment().format('YYYY-MM-DD')}.json`);
        break;
        
      default:
        // JSON format
        exportData = {
          exportedAt: new Date(),
          totalRecords: transactions.length,
          filters: {
            startDate,
            endDate,
            userId,
            paymentMethod,
            status
          },
          data: transactions
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=transactions_${moment().format('YYYY-MM-DD')}.json`);
    }

    res.send(exportData);
  } catch (error) {
    console.error('Error exporting transaction data:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get real-time transaction metrics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getRealTimeMetrics = async (req, res) => {
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    // Get real-time metrics
    const [
      totalTransactionsToday,
      totalAmountToday,
      transactionsLastHour,
      pendingTransactions,
      failedTransactionsToday,
      activeUsers
    ] = await Promise.all([
      Payment.countDocuments({
        createdAt: { $gte: moment().startOf('day').toDate() }
      }),
      Payment.aggregate([
        { $match: { createdAt: { $gte: moment().startOf('day').toDate() } } },
        { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
      ]),
      Payment.countDocuments({
        createdAt: { $gte: lastHour }
      }),
      Payment.countDocuments({
        status: 'pending'
      }),
      Payment.countDocuments({
        status: 'failed',
        createdAt: { $gte: moment().startOf('day').toDate() }
      }),
      Payment.distinct('userId', {
        createdAt: { $gte: last24Hours }
      })
    ]);

    // System health metrics
    const systemHealth = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date()
    };

    const metrics = {
      transactionMetrics: {
        totalTransactionsToday,
        totalAmountToday: totalAmountToday[0]?.total || 0,
        transactionsLastHour,
        pendingTransactions,
        failedTransactionsToday,
        activeUsers: activeUsers.length
      },
      systemHealth,
      lastUpdated: new Date()
    };

    res.json(metrics);
  } catch (error) {
    console.error('Error getting real-time metrics:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get fraud detection insights
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getFraudInsights = async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    let startDate;
    switch (period) {
      case '24h':
        startDate = moment().subtract(1, 'day').toDate();
        break;
      case '7d':
        startDate = moment().subtract(7, 'days').toDate();
        break;
      case '30d':
        startDate = moment().subtract(30, 'days').toDate();
        break;
      default:
        startDate = moment().subtract(7, 'days').toDate();
    }

    // Detect suspicious patterns
    const suspiciousPatterns = await Payment.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: {
          _id: '$userId',
          transactionCount: { $sum: 1 },
          totalAmount: { $sum: { $abs: '$amount' } },
          failedTransactions: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          avgAmount: { $avg: { $abs: '$amount' } },
          uniquePaymentMethods: { $addToSet: '$paymentMethod' },
          transactions: { $push: '$$ROOT' }
        }
      },
      { $addFields: {
          failureRate: { $multiply: [{ $divide: ['$failedTransactions', '$transactionCount'] }, 100] },
          paymentMethodCount: { $size: '$uniquePaymentMethods' }
        }
      },
      { $match: {
          $or: [
            { failureRate: { $gt: 50 } },
            { transactionCount: { $gt: 20 } },
            { avgAmount: { $gt: 10000 } },
            { paymentMethodCount: { $gt: 2 } }
          ]
        }
      },
      { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $sort: { failureRate: -1, transactionCount: -1 } },
      { $limit: 20 }
    ]);

    // Velocity checks: users with more than 10 transactions in the last hour
    const velocityAlerts = await Payment.aggregate([
      { $match: { createdAt: { $gte: moment().subtract(1, 'hour').toDate() } } },
      { $group: {
          _id: '$userId',
          count: { $sum: 1 },
          transactions: { $push: '$$ROOT' }
        }
      },
      { $match: { count: { $gt: 10 } } },
      { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $project: {
          _id: 0,
          user: { $arrayElemAt: ['$user', 0] },
          count: 1,
          transactions: 1
        }
      }
    ]);

    res.json({
      suspiciousPatterns,
      velocityAlerts,
      generatedAt: new Date()
    });
  } catch (error) {
    console.error('Error generating fraud insights:', error);
    res.status(500).json({ error: error.message });
  }
};