const LogModel = require('../models/Log')

class LogController {
  /**
   * Get recent logs
   * GET /api/logs
   * Query params: limit, level, source, startDate, endDate
   */
  static async getLogs(req, res) {
    try {
      const { 
        limit = 500, 
        level, 
        source, 
        startDate, 
        endDate 
      } = req.query

      let query = {}
      let sort = { date: -1 }

      // Apply filters
      if (level) {
        query.levelName = level
      }

      if (source) {
        query.source = { $regex: source, $options: 'i' }
      }

      if (startDate || endDate) {
        query.date = {}
        if (startDate) {
          query.date.$gte = new Date(startDate)
        }
        if (endDate) {
          query.date.$lte = new Date(endDate)
        }
      }

      const logs = await LogModel.find(query)
        .sort(sort)
        .limit(parseInt(limit))
        .lean()

      res.json({
        success: true,
        data: logs,
        count: logs.length,
        query: req.query
      })
    } catch (error) {
      console.error('Error fetching logs:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch logs',
        message: error.message
      })
    }
  }

  /**
   * Get error and fatal logs
   * GET /api/logs/errors
   */
  static async getErrorLogs(req, res) {
    try {
      const { limit = 100 } = req.query

      const logs = await LogModel.find({
        $or: [
          { levelName: 'ERROR' },
          { levelName: 'FATAL' }
        ]
      })
        .sort({ date: -1 })
        .limit(parseInt(limit))
        .lean()

      res.json({
        success: true,
        data: logs,
        count: logs.length
      })
    } catch (error) {
      console.error('Error fetching error logs:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch error logs',
        message: error.message
      })
    }
  }

  /**
   * Get log statistics
   * GET /api/logs/stats
   */
  static async getLogStats(req, res) {
    try {
      const { days = 7 } = req.query
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days))

      const stats = await LogModel.aggregate([
        {
          $match: {
            date: { $gte: cutoffDate }
          }
        },
        {
          $group: {
            _id: '$levelName',
            count: { $sum: 1 },
            latestLog: { $max: '$date' }
          }
        },
        {
          $sort: { count: -1 }
        }
      ])

      const totalLogs = await LogModel.countDocuments({
        date: { $gte: cutoffDate }
      })

      const topSources = await LogModel.aggregate([
        {
          $match: {
            date: { $gte: cutoffDate }
          }
        },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 10
        }
      ])

      res.json({
        success: true,
        data: {
          period: `${days} days`,
          totalLogs,
          levelStats: stats,
          topSources
        }
      })
    } catch (error) {
      console.error('Error fetching log stats:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch log statistics',
        message: error.message
      })
    }
  }

  /**
   * Search logs by message content
   * GET /api/logs/search
   * Query params: q (search query), limit
   */
  static async searchLogs(req, res) {
    try {
      const { q, limit = 100 } = req.query

      if (!q) {
        return res.status(400).json({
          success: false,
          error: 'Search query parameter "q" is required'
        })
      }

      const logs = await LogModel.find({
        $or: [
          { message: { $regex: q, $options: 'i' } },
          { source: { $regex: q, $options: 'i' } }
        ]
      })
        .sort({ date: -1 })
        .limit(parseInt(limit))
        .lean()

      res.json({
        success: true,
        data: logs,
        count: logs.length,
        searchQuery: q
      })
    } catch (error) {
      console.error('Error searching logs:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to search logs',
        message: error.message
      })
    }
  }

  /**
   * Delete old logs
   * DELETE /api/logs/cleanup
   * Body: { daysToKeep: number }
   */
  static async cleanupLogs(req, res) {
    try {
      const { daysToKeep = 30 } = req.body

      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(daysToKeep))

      const result = await LogModel.deleteMany({
        date: { $lt: cutoffDate }
      })

      res.json({
        success: true,
        message: `Deleted ${result.deletedCount} old logs`,
        deletedCount: result.deletedCount,
        cutoffDate
      })
    } catch (error) {
      console.error('Error cleaning up logs:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup logs',
        message: error.message
      })
    }
  }

  /**
   * Get logs by date range with aggregation
   * GET /api/logs/timeline
   */
  static async getLogTimeline(req, res) {
    try {
      const { 
        startDate, 
        endDate, 
        interval = 'hour' // hour, day, week
      } = req.query

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate parameters are required'
        })
      }

      let dateFormat
      switch (interval) {
        case 'hour':
          dateFormat = '%Y-%m-%d %H:00'
          break
        case 'day':
          dateFormat = '%Y-%m-%d'
          break
        case 'week':
          dateFormat = '%Y-%U'
          break
        default:
          dateFormat = '%Y-%m-%d %H:00'
      }

      const timeline = await LogModel.aggregate([
        {
          $match: {
            date: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $group: {
            _id: {
              period: { $dateToString: { format: dateFormat, date: '$date' } },
              level: '$levelName'
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.period',
            levels: {
              $push: {
                level: '$_id.level',
                count: '$count'
              }
            },
            totalCount: { $sum: '$count' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ])

      res.json({
        success: true,
        data: timeline,
        interval,
        period: { startDate, endDate }
      })
    } catch (error) {
      console.error('Error fetching log timeline:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch log timeline',
        message: error.message
      })
    }
  }
}

module.exports = LogController