require('dotenv').config();
const mongoose = require('mongoose');
const Settings = require('../models/Settings');

const initializeSettings = async () => {
  try {
    const count = await Settings.countDocuments();
    if (count === 0) {
      await Settings.create({});
      console.log('Default settings document created');
    }
  } catch (error) {
    console.error('Error initializing settings:', error);
  }
};

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    await initializeSettings();
  })
  .catch((error) => console.error('MongoDB connection error:', error));

module.exports = mongoose;