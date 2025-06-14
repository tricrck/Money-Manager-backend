const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const { body, query, param, validationResult } = require('express-validator');
const reportingController = require('../controllers/reportingController');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Common validation rules
const dateValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date')
    .custom((endDate, { req }) => {
      if (req.query.startDate && endDate && new Date(endDate) < new Date(req.query.startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    })
];

const periodValidation = [
  query('type')
    .optional()
    .isIn(['daily', 'weekly', 'monthly', 'custom'])
    .withMessage('Type must be one of: daily, weekly, monthly, custom')
];

const statusValidation = [
  query('status')
    .optional()
    .isIn(['pending', 'success', 'failed', 'refunded', 'cancelled'])
    .withMessage('Status must be one of: pending, success, failed, refunded, cancelled')
];

const paymentMethodValidation = [
  query('paymentMethod')
    .optional()
    .isIn(['mpesa', 'card', 'bank_transfer', 'paypal', 'stripe', 'flutterwave'])
    .withMessage('Payment method must be one of: mpesa, card, bank_transfer, paypal, stripe, flutterwave')
];

// ================================
// USER STATEMENT ROUTES
// ================================

/**
 * @route   GET /api/reports/user/:userId/statement
 * @desc    Generate user statement for a specific period
 * @access  Private (User can only access their own statement, Admin can access any)
 * @query   {string} startDate - Start date (ISO 8601)
 * @query   {string} endDate - End date (ISO 8601)
 * @query   {string} type - Period type (daily, weekly, monthly, custom)
 * @query   {string} paymentMethod - Filter by payment method
 * @query   {string} status - Filter by status
 * @query   {string} format - Export format (json, csv, pdf)
 */
router.get('/user/:userId/statement',
  auth,
  [
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required'),
    ...dateValidation,
    ...periodValidation,
    ...statusValidation,
    ...paymentMethodValidation,
    query('format')
      .optional()
      .isIn(['json', 'csv', 'pdf'])
      .withMessage('Format must be one of: json, csv, pdf'),
    handleValidationErrors,
    // Custom middleware to check if user can access this statement
    (req, res, next) => {
      const requestedUserId = req.params.userId;
      const currentUserId = req.user.id;
      const isAdminUser = req.user.role === 'admin' || req.user.isAdmin;
      
      // Users can only access their own statements unless they're admin
      if (!isAdminUser && requestedUserId !== currentUserId) {
        return res.status(403).json({ 
          error: 'Access denied. You can only view your own statement.' 
        });
      }
      next();
    }
  ],
  reportingController.getUserStatement
);

/**
 * @route   GET /api/reports/my-statement
 * @desc    Generate current user's statement (convenience route)
 * @access  Private
 */
router.get('/my-statement',
  auth,
  [
    ...dateValidation,
    ...periodValidation,
    ...statusValidation,
    ...paymentMethodValidation,
    query('format')
      .optional()
      .isIn(['json', 'csv', 'pdf'])
      .withMessage('Format must be one of: json, csv, pdf'),
    handleValidationErrors
  ],
  (req, res, next) => {
    // Set the userId to current user's ID
    req.params.userId = req.user.id;
    next();
  },
  reportingController.getUserStatement
);

// ================================
// ADMIN REPORTING ROUTES
// ================================

/**
 * @route   GET /api/reports/admin/transactions
 * @desc    Generate admin transaction report with advanced filtering and grouping
 * @access  Private (Admin only)
 * @query   {string} startDate - Start date (ISO 8601)
 * @query   {string} endDate - End date (ISO 8601)
 * @query   {string} type - Period type (daily, weekly, monthly, custom)
 * @query   {string} paymentMethod - Filter by payment method
 * @query   {string} status - Filter by status
 * @query   {string} groupBy - Group data by (day, week, month, paymentMethod, status)
 */
router.get('/admin/transactions',
  auth,
  isAdmin,
  [
    ...dateValidation,
    ...periodValidation,
    ...statusValidation,
    ...paymentMethodValidation,
    query('groupBy')
      .optional()
      .isIn(['day', 'week', 'month', 'paymentMethod', 'status'])
      .withMessage('GroupBy must be one of: day, week, month, paymentMethod, status'),
    handleValidationErrors
  ],
  reportingController.getAdminTransactionReport
);

/**
 * @route   GET /api/reports/admin/analytics
 * @desc    Get advanced analytics dashboard data with aggregations and insights
 * @access  Private (Admin only)
 * @query   {string} period - Analysis period (7d, 30d, 90d, 1y)
 */
router.get('/admin/analytics',
  auth,
  isAdmin,
  [
    query('period')
      .optional()
      .isIn(['7d', '30d', '90d', '1y'])
      .withMessage('Period must be one of: 7d, 30d, 90d, 1y'),
    handleValidationErrors
  ],
  reportingController.getAdvancedAnalytics
);

/**
 * @route   GET /api/reports/admin/metrics/realtime
 * @desc    Get real-time transaction metrics and system health
 * @access  Private (Admin only)
 */
router.get('/admin/metrics/realtime',
  auth,
  isAdmin,
  reportingController.getRealTimeMetrics
);

/**
 * @route   GET /api/reports/admin/fraud-insights
 * @desc    Get fraud detection insights and suspicious pattern analysis
 * @access  Private (Admin only)
 * @query   {string} period - Analysis period (24h, 7d, 30d)
 */
router.get('/admin/fraud-insights',
  auth,
  isAdmin,
  [
    query('period')
      .optional()
      .isIn(['24h', '7d', '30d'])
      .withMessage('Period must be one of: 24h, 7d, 30d'),
    handleValidationErrors
  ],
  reportingController.getFraudInsights
);

// ================================
// DATA EXPORT ROUTES
// ================================

/**
 * @route   GET /api/reports/export/transactions
 * @desc    Export transaction data in various formats (CSV, Excel, JSON)
 * @access  Private (Admin only)
 * @query   {string} format - Export format (json, csv, excel)
 * @query   {string} startDate - Start date (ISO 8601)
 * @query   {string} endDate - End date (ISO 8601)
 * @query   {string} userId - Filter by specific user
 * @query   {string} paymentMethod - Filter by payment method
 * @query   {string} status - Filter by status
 * @query   {boolean} includeMetadata - Include transaction metadata
 */
router.get('/export/transactions',
  auth,
  isAdmin,
  [
    query('format')
      .optional()
      .isIn(['json', 'csv', 'excel'])
      .withMessage('Format must be one of: json, csv, excel'),
    ...dateValidation,
    query('userId')
      .optional()
      .isMongoId()
      .withMessage('User ID must be a valid MongoDB ObjectId'),
    ...paymentMethodValidation,
    ...statusValidation,
    query('includeMetadata')
      .optional()
      .isBoolean()
      .withMessage('includeMetadata must be a boolean value'),
    handleValidationErrors
  ],
  reportingController.exportTransactionData
);

/**
 * @route   GET /api/reports/export/user/:userId/transactions
 * @desc    Export specific user's transaction data (User can export their own, Admin can export any)
 * @access  Private
 */
router.get('/export/user/:userId/transactions',
  auth,
  [
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required'),
    query('format')
      .optional()
      .isIn(['json', 'csv', 'excel'])
      .withMessage('Format must be one of: json, csv, excel'),
    ...dateValidation,
    ...paymentMethodValidation,
    ...statusValidation,
    query('includeMetadata')
      .optional()
      .isBoolean()
      .withMessage('includeMetadata must be a boolean value'),
    handleValidationErrors,
    // Check access permissions
    (req, res, next) => {
      const requestedUserId = req.params.userId;
      const currentUserId = req.user.id;
      const isAdminUser = req.user.role === 'admin' || req.user.isAdmin;
      
      if (!isAdminUser && requestedUserId !== currentUserId) {
        return res.status(403).json({ 
          error: 'Access denied. You can only export your own transaction data.' 
        });
      }
      next();
    }
  ],
  reportingController.exportTransactionData
);

// ================================
// UTILITY ROUTES
// ================================

/**
 * @route   GET /api/reports/health
 * @desc    Get reporting service health status
 * @access  Private (Admin only)
 */
router.get('/health',
  auth,
  isAdmin,
  (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0'
    });
  }
);

/**
 * @route   GET /api/reports/config
 * @desc    Get reporting configuration and available options
 * @access  Private
 */
router.get('/config',
  auth,
  (req, res) => {
    res.json({
      periods: ['daily', 'weekly', 'monthly', 'custom'],
      formats: ['json', 'csv', 'excel', 'pdf'],
      paymentMethods: ['mpesa', 'card', 'bank_transfer', 'paypal', 'stripe', 'flutterwave'],
      statuses: ['pending', 'success', 'failed', 'refunded', 'cancelled'],
      groupByOptions: ['day', 'week', 'month', 'paymentMethod', 'status'],
      analyticsPeriods: ['7d', '30d', '90d', '1y'],
      fraudInsightsPeriods: ['24h', '7d', '30d'],
      maxExportRecords: 10000,
      timezone: 'UTC'
    });
  }
);

// ================================
// CUSTOM REPORT ROUTES
// ================================

/**
 * @route   POST /api/reports/custom
 * @desc    Generate custom report with advanced filtering
 * @access  Private (Admin only)
 * @body    {object} filters - Custom filter object
 * @body    {object} grouping - Custom grouping configuration
 * @body    {array} fields - Fields to include in report
 */
router.post('/custom',
  auth,
  isAdmin,
  [
    body('filters')
      .optional()
      .isObject()
      .withMessage('Filters must be an object'),
    body('grouping')
      .optional()
      .isObject()
      .withMessage('Grouping must be an object'),
    body('fields')
      .optional()
      .isArray()
      .withMessage('Fields must be an array'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { filters = {}, grouping = {}, fields = [] } = req.body;
      
      // This would implement custom reporting logic
      // For now, we'll return a placeholder response
      res.json({
        message: 'Custom reporting endpoint - implementation pending',
        requestedFilters: filters,
        requestedGrouping: grouping,
        requestedFields: fields,
        generatedAt: new Date()
      });
    } catch (error) {
      console.error('Error generating custom report:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ================================
// SCHEDULED REPORTS ROUTES (Future Enhancement)
// ================================

/**
 * @route   POST /api/reports/schedule
 * @desc    Schedule automated report generation
 * @access  Private (Admin only)
 */
router.post('/schedule',
  auth,
  isAdmin,
  [
    body('reportType')
      .isIn(['user_statement', 'admin_transactions', 'analytics', 'fraud_insights'])
      .withMessage('Invalid report type'),
    body('schedule')
      .matches(/^(\*|[0-5]?\d) (\*|[01]?\d|2[0-3]) (\*|[12]?\d|3[01]) (\*|[1-9]|1[0-2]) (\*|[0-6])$/)
      .withMessage('Schedule must be a valid cron expression'),
    body('recipients')
      .isArray({ min: 1 })
      .withMessage('Recipients must be a non-empty array'),
    body('recipients.*')
      .isEmail()
      .withMessage('All recipients must be valid email addresses'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      // Placeholder for scheduled reports functionality
      res.json({
        message: 'Scheduled reports endpoint - implementation pending',
        scheduledReport: {
          id: 'schedule_' + Date.now(),
          ...req.body,
          createdAt: new Date(),
          status: 'scheduled'
        }
      });
    } catch (error) {
      console.error('Error scheduling report:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Error handling middleware for this route group
router.use((error, req, res, next) => {
  console.error('Reporting routes error:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.message
    });
  }
  
  if (error.name === 'CastError') {
    return res.status(400).json({
      error: 'Invalid ID format',
      details: error.message
    });
  }
  
  res.status(500).json({
    error: 'Internal server error in reporting service',
    message: error.message
  });
});

module.exports = router;