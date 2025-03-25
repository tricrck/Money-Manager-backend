const express = require('express');
const { 
  getWallet, 
  updateWallet, 
  depositToWallet, 
  withdrawFromWallet 
} = require('../controllers/walletController');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

// Get wallet details for a specific user
router.get('/:userId', auth, getWallet);

// Update wallet details (if needed)
router.put('/:userId', [auth, isAdmin], updateWallet);

// Deposit funds to wallet
router.post('/deposit/:userId', auth, depositToWallet);

// Withdraw funds from wallet
router.post('/withdraw/:userId', auth, withdrawFromWallet);

module.exports = router;