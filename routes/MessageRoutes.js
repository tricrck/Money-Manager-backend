// routes/MessageRoutes.js
const express = require('express');
const { sendEmailController, sendPushNotification } = require('../controllers/messagingController');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Logger = require('../middleware/Logger');

module.exports = (logManager) => {
  const router = express.Router();

  router.post('/sendemail', auth, sendEmailController);
  router.post('/sendpush', auth, sendPushNotification);

  router.post('/push-token', auth, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Push token is required' });
    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.pushToken || user.pushToken !== token) {
        user.pushToken = token;
        await user.save();
        return res.json({ success: true, message: 'Push token saved/updated' });
      }
      res.json({ success: true, message: 'Push token already up-to-date' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save push token' });
    }
  });

  router.get('/admin/logs', async (req, res) => {
    try {
      const recentLogs = logManager.getMostRecentCurrentDailyLogs();
      res.json({ logs: recentLogs });
    } catch (error) {
      Logger.error('Failed to fetch logs', error);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  return router;
};
