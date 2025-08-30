const express = require('express')
const router = express.Router()
const LogController = require('../controllers/LogController')

// Middleware for authentication (adjust based on your auth system)
const requireAuth = (req, res, next) => {
  // Add your authentication logic here
  // For example:
  // if (!req.user || !req.user.isAdmin) {
  //   return res.status(403).json({ error: 'Access denied' })
  // }
  next()
}

// Apply auth middleware to all log routes
router.use(requireAuth)

// Get logs with filtering
// GET /api/logs?limit=500&level=ERROR&source=LogManager&startDate=2024-01-01&endDate=2024-01-31
router.get('/', LogController.getLogs)

// Get error and fatal logs
// GET /api/logs/errors?limit=100
router.get('/errors', LogController.getErrorLogs)

// Get log statistics
// GET /api/logs/stats?days=7
router.get('/stats', LogController.getLogStats)

// Search logs
// GET /api/logs/search?q=database&limit=100
router.get('/search', LogController.searchLogs)

// Get log timeline with aggregation
// GET /api/logs/timeline?startDate=2024-01-01&endDate=2024-01-31&interval=day
router.get('/timeline', LogController.getLogTimeline)

// Cleanup old logs (admin only)
// DELETE /api/logs/cleanup
router.delete('/cleanup', LogController.cleanupLogs)

module.exports = router