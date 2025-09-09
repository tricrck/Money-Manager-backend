const express = require('express');
const {
  sendMessage,
  getMessages,
  markMessagesAsRead,
  getUnreadCount,
  getAllSupportMessages
}  = require('../controllers/chatController.js');
const auth = require('../middleware/auth');
const authorizeRoles = require('../middleware/authorizeRoles.js');

const router = express.Router();

router.post('/send', auth, authorizeRoles('Member', 'Admin', 'Treasurer', 'Secretary', 'Chairperson', 'Support'), sendMessage);
router.post('/messages', auth, authorizeRoles('Member', 'Admin', 'Treasurer', 'Secretary', 'Chairperson', 'Support'), getMessages);
router.put('/mark-read', auth, authorizeRoles('Member', 'Admin', 'Treasurer', 'Secretary', 'Chairperson', 'Support'), markMessagesAsRead);
router.get('/unread-count', auth, authorizeRoles('Member', 'Admin', 'Treasurer', 'Secretary', 'Chairperson', 'Support'), getUnreadCount);
router.post('/support/messages', auth, getAllSupportMessages);

module.exports = router;