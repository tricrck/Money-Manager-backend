const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // System Settings
  maintenanceMode: { type: Boolean, default: false },
  debugMode: { type: Boolean, default: false },
  autoBackup: { type: Boolean, default: true },
  maxUsersPerGroup: { type: Number, default: 50 },
  defaultInterestRate: { type: Number, default: 15 },
  maxLoanAmount: { type: Number, default: 500000 },
  minLoanAmount: { type: Number, default: 1000 },
  
  // Notification Settings
  emailNotifications: { type: Boolean, default: true },
  smsNotifications: { type: Boolean, default: true },
  pushNotifications: { type: Boolean, default: true },
  loanReminders: { type: Boolean, default: true },
  
  // Security Settings
  twoFactorAuth: { type: Boolean, default: true },
  sessionTimeout: { type: Number, default: 30 },
  passwordExpiry: { type: Number, default: 90 },
  maxLoginAttempts: { type: Number, default: 5 },
  
  // Payment Settings
  mpesaEnabled: { type: Boolean, default: true },
  stripeEnabled: { type: Boolean, default: true },
  processingFee: { type: Number, default: 2.5 },
  lateFeePercentage: { type: Number, default: 5 },
  
  // System Info (read-only)
  serverStatus: { type: String, default: 'healthy' },
  lastBackup: { type: Date, default: Date.now },
  systemVersion: { type: String, default: '2.1.0' },
  databaseSize: { type: String, default: '2.4 GB' },
  
  // API Key (should be encrypted in production)
  apiKey: { type: String, default: 'sk_live_51H7xvxvxvxvxvxvxvxvxvxvxvxvxvxv' }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);