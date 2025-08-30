const Path = require('path')
const fs = require('fs-extra');
const Logger = require('./Logger')
const DailyLog = require('./DailyLog')
const LogModel = require('../models/Log') // Adjust path as needed

const { LogLevel } = require('./constants')

const TAG = '[LogManager]'

/**
 * @typedef LogObject
 * @property {string} timestamp
 * @property {string} source
 * @property {string} message
 * @property {string} levelName
 * @property {number} level
 */

class LogManager {
  constructor() {
    const basePath = global.MetadataPath || Path.join(__dirname, '..', 'metadata');
    this.DailyLogPath = Path.join(basePath, 'logs', 'daily');

    /** @type {DailyLog} */
    this.currentDailyLog = null

    /** @type {LogObject[]} */
    this.dailyLogBuffer = []

    /** @type {string[]} */
    this.dailyLogFiles = []

    // Database logging configuration
    this.dbLoggingEnabled = true
    this.dbLogBuffer = []
    this.dbBufferMaxSize = 100 // Batch insert when buffer reaches this size
    this.dbFlushInterval = 30000 // Flush buffer every 30 seconds
    this.dbFlushTimer = null
  }

  get loggerDailyLogsToKeep() {
    return global.ServerSettings?.loggerDailyLogsToKeep ?? 7;
  }

  get loggerDbLoggingEnabled() {
    return global.ServerSettings?.loggerDbLoggingEnabled ?? true;
  }

  get loggerDbLogLevel() {
    return global.ServerSettings?.loggerDbLogLevel ?? LogLevel.INFO;
  }

  async ensureLogDirs() {
    await fs.ensureDir(this.DailyLogPath)
  }

  /**
   * Initialize database logging timer
   */
  initDbLogging() {
    if (!this.loggerDbLoggingEnabled) return;
    
    // Set up periodic buffer flush
    this.dbFlushTimer = setInterval(() => {
      this.flushDbBuffer()
    }, this.dbFlushInterval);
  }

  /**
   * 1. Ensure log directories exist
   * 2. Load daily log files
   * 3. Remove old daily log files
   * 4. Create/set current daily log file
   * 5. Initialize database logging
   */
  async init() {
    await this.ensureLogDirs()

    // Load daily logs
    await this.scanLogFiles()

    // Check remove extra daily logs
    if (this.dailyLogFiles.length > this.loggerDailyLogsToKeep) {
      const dailyLogFilesCopy = [...this.dailyLogFiles]
      for (let i = 0; i < dailyLogFilesCopy.length - this.loggerDailyLogsToKeep; i++) {
        await this.removeLogFile(dailyLogFilesCopy[i])
      }
    }

    // set current daily log file or create if does not exist
    const currentDailyLogFilename = DailyLog.getCurrentDailyLogFilename()
    Logger.info(TAG, `Init current daily log filename: ${currentDailyLogFilename}`)

    this.currentDailyLog = new DailyLog(this.DailyLogPath)

    if (this.dailyLogFiles.includes(currentDailyLogFilename)) {
      Logger.debug(TAG, `Daily log file already exists - set in Logger`)
      await this.currentDailyLog.loadLogs()
    } else {
      this.dailyLogFiles.push(this.currentDailyLog.filename)
    }

    // Log buffered daily logs
    if (this.dailyLogBuffer.length) {
      this.dailyLogBuffer.forEach((logObj) => {
        this.currentDailyLog.appendLog(logObj)
      })
      this.dailyLogBuffer = []
    }

    // Initialize database logging
    this.initDbLogging()
  }

  /**
   * Clean up timers and flush remaining logs
   */
  async shutdown() {
    if (this.dbFlushTimer) {
      clearInterval(this.dbFlushTimer)
      this.dbFlushTimer = null
    }
    await this.flushDbBuffer()
  }

  /**
   * Load all daily log filenames in /metadata/logs/daily
   */
  async scanLogFiles() {
    const dailyFiles = await fs.readdir(this.DailyLogPath)
    if (dailyFiles?.length) {
      dailyFiles.forEach((logFile) => {
        if (Path.extname(logFile) === '.txt') {
          Logger.debug('Daily Log file found', logFile)
          this.dailyLogFiles.push(logFile)
        } else {
          Logger.debug(TAG, 'Unknown File in Daily log files dir', logFile)
        }
      })
    }
    this.dailyLogFiles.sort()
  }

  /**
   * 
   * @param {string} filename 
   */
  async removeLogFile(filename) {
    const fullPath = Path.join(this.DailyLogPath, filename)
    const exists = await fs.pathExists(fullPath)
    if (!exists) {
      Logger.error(TAG, 'Invalid log dne ' + fullPath)
      this.dailyLogFiles = this.dailyLogFiles.filter(dlf => dlf !== filename)
    } else {
      try {
        await fs.unlink(fullPath)
        Logger.info(TAG, 'Removed daily log: ' + filename)
        this.dailyLogFiles = this.dailyLogFiles.filter(dlf => dlf !== filename)
      } catch (error) {
        Logger.error(TAG, 'Failed to unlink log file ' + fullPath)
      }
    }
  }

  /**
   * Log to database
   * @param {LogObject} logObj 
   */
  async logToDatabase(logObj) {
    if (!this.loggerDbLoggingEnabled || logObj.level < this.loggerDbLogLevel) {
      return
    }

    try {
      // Add to buffer for batch processing
      this.dbLogBuffer.push({
        ...logObj,
        date: new Date(logObj.timestamp)
      })

      // Flush if buffer is full
      if (this.dbLogBuffer.length >= this.dbBufferMaxSize) {
        await this.flushDbBuffer()
      }
    } catch (error) {
      console.error('[LogManager] Error adding log to database buffer:', error)
    }
  }

  /**
   * Flush database buffer
   */
  async flushDbBuffer() {
    if (this.dbLogBuffer.length === 0) return

    try {
      const logsToInsert = [...this.dbLogBuffer]
      this.dbLogBuffer = []

      // Batch insert logs
      await LogModel.insertMany(logsToInsert, { ordered: false })
      
      console.debug(`[LogManager] Flushed ${logsToInsert.length} logs to database`)
    } catch (error) {
      console.error('[LogManager] Error flushing logs to database:', error)
      // In case of error, we could choose to re-add to buffer or discard
      // For now, we'll discard to prevent infinite growth
    }
  }

  /**
   * 
   * @param {LogObject} logObj 
   */
  async logToFile(logObj) {
    // Fatal crashes get logged to a separate file
    if (logObj.level === LogLevel.FATAL) {
      await this.logCrashToFile(logObj)
    }

    // Log to database (non-blocking)
    this.logToDatabase(logObj).catch(error => {
      console.error('[LogManager] Database logging failed:', error)
    })

    // Buffer when logging before daily logs have been initialized
    if (!this.currentDailyLog) {
      this.dailyLogBuffer.push(logObj)
      return
    }

    // Check log rolls to next day
    if (this.currentDailyLog.id !== DailyLog.getCurrentDateString()) {
      this.currentDailyLog = new DailyLog(this.DailyLogPath)
      if (this.dailyLogFiles.length > this.loggerDailyLogsToKeep) {
        // Remove oldest log
        this.removeLogFile(this.dailyLogFiles[0])
      }
    }

    // Append log line to log file
    return this.currentDailyLog.appendLog(logObj)
  }

  /**
   * 
   * @param {LogObject} logObj 
   */
  async logCrashToFile(logObj) {
    const line = JSON.stringify(logObj) + '\n'

    const logsDir = Path.join(global.MetadataPath, 'logs')
    await fs.ensureDir(logsDir)
    const crashLogPath = Path.join(logsDir, 'crash_logs.txt')
    return fs.writeFile(crashLogPath, line, { flag: "a+" }).catch((error) => {
      console.log('[LogManager] Appended crash log', error)
    })
  }

  /**
   * Most recent 5000 daily logs
   * 
   * @returns {string}
   */
  getMostRecentCurrentDailyLogs() {
    return this.currentDailyLog?.logs.slice(-5000) || ''
  }

  /**
   * Get logs from database
   * @param {Object} options Query options
   * @param {string} options.level Log level filter
   * @param {string} options.source Source filter
   * @param {Date} options.startDate Start date filter
   * @param {Date} options.endDate End date filter
   * @param {number} options.limit Limit results (default: 500)
   * @returns {Promise<Array>}
   */
  async getLogsFromDatabase(options = {}) {
    if (!this.loggerDbLoggingEnabled) {
      return []
    }

    try {
      const { level, source, startDate, endDate, limit = 500 } = options
      
      if (startDate && endDate) {
        return await LogModel.findByDateRange(startDate, endDate, limit)
      } else if (level) {
        return await LogModel.findByLevel(level, limit)
      } else if (source) {
        return await LogModel.findBySource(source, limit)
      } else {
        return await LogModel.findRecentLogs(limit)
      }
    } catch (error) {
      console.error('[LogManager] Error querying logs from database:', error)
      return []
    }
  }

  /**
   * Get error and fatal logs from database
   * @param {number} limit 
   * @returns {Promise<Array>}
   */
  async getErrorLogsFromDatabase(limit = 100) {
    if (!this.loggerDbLoggingEnabled) {
      return []
    }

    try {
      return await LogModel.findErrorsAndFatals(limit)
    } catch (error) {
      console.error('[LogManager] Error querying error logs from database:', error)
      return []
    }
  }

  /**
   * Clean up old logs from database
   * @param {number} daysToKeep Number of days to keep logs (default: 30)
   */
  async cleanupOldDatabaseLogs(daysToKeep = 30) {
    if (!this.loggerDbLoggingEnabled) {
      return
    }

    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

      const result = await LogModel.deleteMany({
        date: { $lt: cutoffDate }
      })

      console.log(`[LogManager] Cleaned up ${result.deletedCount} old database logs`)
    } catch (error) {
      console.error('[LogManager] Error cleaning up old database logs:', error)
    }
  }
}
module.exports = LogManager