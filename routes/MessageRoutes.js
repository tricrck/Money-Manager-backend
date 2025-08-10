const express = require('express');
const { sendEmailController, sendPushNotification } = require('../controllers/messagingController');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// Admin-only routes
router.post('/sendemail', auth, sendEmailController);
router.post('/sendpush', auth, sendPushNotification);
// updatePushToken
// updatePushToken
router.post('/push-token', auth, async (req, res) => {
  const { token } = req.body;

  pushToken = token;

  if (!pushToken) {
    return res.status(400).json({ error: 'Push token is required' });
  }

  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only update if null or different
    if (!user.pushToken || user.pushToken !== pushToken) {
      user.pushToken = pushToken;
      await user.save();
      return res.json({ success: true, message: 'Push token saved/updated' });
    }

    res.json({ success: true, message: 'Push token already up-to-date' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save push token' });
  }
});


module.exports = router;