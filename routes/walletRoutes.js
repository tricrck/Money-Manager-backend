const express = require('express');
const { 
  getWallet, 
  updateWallet, 
  depositToWallet, 
  withdrawFromWallet 
} = require('../controllers/walletController');
const router = express.Router();

// Get wallet details for a specific user
router.get('/:userId', getWallet);

// Update wallet details (if needed)
router.put('/:userId', updateWallet);

// Deposit funds to wallet
router.post('/deposit/:userId', depositToWallet);

// Withdraw funds from wallet
router.post('/withdraw/:userId', withdrawFromWallet);

module.exports = router;