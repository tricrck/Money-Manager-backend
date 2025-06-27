const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');
const auth = require('../middleware/auth');

// Get events for a date range
router.get('/', auth, calendarController.getUserEvents);

// Mark an event as complete
router.put('/:id/complete', auth, calendarController.markEventComplete);

// Get user's fines
router.get('/fines', auth, calendarController.getUserFines);

// Waive a fine (admin/group leader only)
router.put('/fines/:id/waive', auth, calendarController.waiveFine);

// Manual trigger to generate events for current user (useful for testing)
router.post('/generate', auth, async (req, res) => {
  try {
    await calendarController.generateUserEvents(req.user._id);
    res.json({ 
      success: true, 
      message: 'Events generated successfully' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error generating events',
      error: error.message 
    });
  }
});

module.exports = router;