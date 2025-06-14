const Settings = require('../models/Settings');
const mongoose = require('mongoose');
const si = require('systeminformation');

// Get current settings
exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = await Settings.create({});
    }
    
    // Helper function to determine server status
    const getServerStatus = async () => {
      const checks = {
        database: false,
        memory: false,
        responseTime: false,
        uptime: false
      };
      
      let status = 'healthy';
      const issues = [];
      
      try {
        // Database health check
        const startTime = Date.now();
        await mongoose.connection.db.admin().ping();
        const dbResponseTime = Date.now() - startTime;
        
        checks.database = dbResponseTime < 1000; // Less than 1 second
        if (!checks.database) {
          issues.push(`Database slow (${dbResponseTime}ms)`);
        }
        
        // Memory usage check
        const memInfo = await si.mem().catch(() => null);
        if (memInfo) {
          const memoryUsagePercent = (memInfo.used / memInfo.total) * 100;
          checks.memory = memoryUsagePercent < 85; // Less than 85%
          if (!checks.memory) {
            issues.push(`High memory usage (${memoryUsagePercent.toFixed(1)}%)`);
          }
        }
        
        // Response time check (simple timing)
        const responseStartTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 1));
        const responseTime = Date.now() - responseStartTime;
        checks.responseTime = responseTime < 100;
        
        // Uptime check (consider healthy if up for more than 1 minute)
        const uptimeSeconds = process.uptime();
        checks.uptime = uptimeSeconds > 60;
        if (!checks.uptime) {
          issues.push('Recently restarted');
        }
        
        // Determine overall status
        const healthyChecks = Object.values(checks).filter(Boolean).length;
        const totalChecks = Object.keys(checks).length;
        
        if (healthyChecks === totalChecks) {
          status = 'healthy';
        } else if (healthyChecks >= totalChecks * 0.75) {
          status = 'warning';
        } else {
          status = 'critical';
        }
        
      } catch (error) {
        status = 'critical';
        issues.push('System check failed');
      }
      
      return { status, checks, issues };
    };
    
    // Get system information
    const [dbStats, systemInfo, serverStatus] = await Promise.all([
      mongoose.connection.db.stats().catch(() => null),
      si.mem().catch(() => null),
      getServerStatus()
    ]);
    
    // Calculate uptime in a readable format
    const formatUptime = (seconds) => {
      const days = Math.floor(seconds / (24 * 60 * 60));
      const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((seconds % (60 * 60)) / 60);
      
      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    };
    
    const enhancedSettings = {
      ...settings.toObject(),
      systemInfo: {
        serverStatus: serverStatus.status,
        statusChecks: serverStatus.checks,
        issues: serverStatus.issues,
        lastBackup: settings.lastBackup,
        systemVersion: process.env.npm_package_version || '1.0.0',
        uptime: formatUptime(process.uptime()),
        uptimeSeconds: Math.floor(process.uptime()),
        databaseSize: dbStats ? 
          `${(dbStats.dataSize / (1024 * 1024)).toFixed(2)} MB` : 
          'Unknown',
        memoryUsage: systemInfo ? {
          percentage: `${((systemInfo.used / systemInfo.total) * 100).toFixed(2)}%`,
          used: `${(systemInfo.used / (1024 * 1024 * 1024)).toFixed(2)} GB`,
          total: `${(systemInfo.total / (1024 * 1024 * 1024)).toFixed(2)} GB`,
          available: `${(systemInfo.available / (1024 * 1024 * 1024)).toFixed(2)} GB`
        } : 'Unknown',
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        pid: process.pid,
        timestamp: new Date().toISOString()
      }
    };
    
    res.json(enhancedSettings);
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ 
      message: error.message,
      systemInfo: {
        serverStatus: 'critical',
        issues: ['Failed to fetch system information'],
        timestamp: new Date().toISOString()
      }
    });
  }
};

// Update settings
exports.updateSettings = async (req, res) => {
  try {
    // Prevent updating read-only fields
    const { serverStatus, lastBackup, systemVersion, databaseSize, apiKey, ...updatableFields } = req.body;
    
    const settings = await Settings.findOneAndUpdate(
      {}, 
      updatableFields, 
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reset to default settings
exports.resetSettings = async (req, res) => {
  try {
    const defaultSettings = new Settings();
    const settings = await Settings.findOneAndUpdate(
      {}, 
      defaultSettings.toObject(), 
      { new: true, upsert: true }
    );
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get system info (for dashboard cards)
exports.getSystemInfo = async (req, res) => {
  try {
    const settings = await Settings.findOne();
    const { serverStatus, lastBackup, systemVersion, databaseSize } = settings;
    
    res.json({ serverStatus, lastBackup, systemVersion, databaseSize });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getMongoDBStats = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    
    // Get database stats
    const stats = await db.stats();
    
    // Get collection list with sizes
    const collections = await db.listCollections().toArray();
    const collectionDetails = await Promise.all(
      collections.map(async (collection) => {
        try {
          // Use db.runCommand instead of collection.stats()
          const collStats = await db.runCommand({ 
            collStats: collection.name 
          });
          
          return {
            name: collection.name,
            size: collStats.size ? (collStats.size / (1024 * 1024)).toFixed(2) + ' MB' : '0 MB',
            count: collStats.count || 0,
            storageSize: collStats.storageSize ? (collStats.storageSize / (1024 * 1024)).toFixed(2) + ' MB' : '0 MB'
          };
        } catch (collError) {
          // If collStats fails for a specific collection, return basic info
          return {
            name: collection.name,
            size: 'Unknown',
            count: 'Unknown',
            storageSize: 'Unknown'
          };
        }
      })
    );
    
    res.json({
      dbStats: {
        databaseName: stats.db,
        storageSize: (stats.storageSize / (1024 * 1024)).toFixed(2) + ' MB',
        dataSize: (stats.dataSize / (1024 * 1024)).toFixed(2) + ' MB',
        collections: stats.collections,
        indexes: stats.indexes
      },
      collectionDetails
    });
  } catch (error) {
    console.error('MongoDB stats error:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.getSystemInfo = async (req, res) => {
  try {
    const [
      cpu,
      mem,
      osInfo,
      currentLoad,
      diskLayout,
      fsSize,
      networkInterfaces,
      processes,
      services
    ] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.osInfo(),
      si.currentLoad(),
      si.diskLayout(),
      si.fsSize(),
      si.networkInterfaces(),
      si.processes(),
      si.services('*')
    ]);
    
    const simplifiedDisk = diskLayout.map(disk => ({
      name: disk.name,
      size: (disk.size / (1024 ** 3)).toFixed(2) + ' GB',
      type: disk.type
    }));
    
    const simplifiedFs = fsSize.map(fs => ({
      fs: fs.fs,
      size: (fs.size / (1024 ** 3)).toFixed(2) + ' GB',
      used: (fs.used / (1024 ** 3)).toFixed(2) + ' GB',
      use: fs.use + '%',
      mount: fs.mount
    }));
    
    res.json({
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        speed: cpu.speed + ' GHz'
      },
      memory: {
        total: (mem.total / (1024 ** 3)).toFixed(2) + ' GB',
        free: (mem.free / (1024 ** 3)).toFixed(2) + ' GB',
        used: (mem.used / (1024 ** 3)).toFixed(2) + ' GB'
      },
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch
      },
      load: {
        currentLoad: currentLoad.currentLoad.toFixed(2) + '%',
        avgLoad: currentLoad.avgLoad
      },
      disks: simplifiedDisk,
      fileSystems: simplifiedFs,
      network: networkInterfaces.map(net => ({
        iface: net.iface,
        ip4: net.ip4,
        speed: net.speed + ' Mbps'
      })),
      processes: {
        all: processes.all,
        running: processes.running,
        blocked: processes.blocked
      },
      services: services.map(service => ({
        name: service.name,
        running: service.running
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
