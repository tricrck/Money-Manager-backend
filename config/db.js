require('dotenv').config();
const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const Logger = require('../middleware/Logger');

// MongoDB connection configuration with options
const mongoOptions = {
  serverApi: {
    version: '1',
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  bufferCommands: false
};

const initializeSettings = async () => {
  try {
    const count = await Settings.countDocuments();
    if (count === 0) {
      await Settings.create({});
      Logger.info('Default settings document created');
    } else {
      Logger.info('Settings document already exists');
    }
  } catch (error) {
    Logger.error('Error initializing settings:', error);
    throw error;
  }
};

const connectToDatabase = async () => {
  try {
    // Validate environment variable
    if (!process.env.MONGO_URI) {
      const errorMsg = 'MONGO_URI environment variable is not defined';
      Logger.fatal(errorMsg);
      throw new Error(errorMsg);
    }

    Logger.info('Attempting to connect to MongoDB...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, mongoOptions);
    
    // Test the connection
    await mongoose.connection.db.admin().ping();
    Logger.info('MongoDB connected successfully and ping test passed');
    
    // Initialize settings after successful connection
    await initializeSettings();
    
    return mongoose;
  } catch (error) {
    Logger.error('MongoDB connection error:', error);
    throw error;
  }
};

// Handle connection events
mongoose.connection.on('connected', () => {
  Logger.info('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (error) => {
  Logger.error('Mongoose connection error:', error);
});

mongoose.connection.on('disconnected', () => {
  Logger.warn('Mongoose disconnected from MongoDB');
});

// Handle application termination
process.on('SIGINT', async () => {
  try {
    Logger.info('Received SIGINT, closing MongoDB connection...');
    await mongoose.connection.close();
    Logger.info('MongoDB connection closed through app termination');
    process.exit(0);
  } catch (error) {
    Logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

// Start the database connection
connectToDatabase().catch((error) => {
  Logger.fatal('Failed to connect to database:', error);
  process.exit(1);
});

module.exports = mongoose;