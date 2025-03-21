const express = require('express');
const { 
    processMpesaPayment, 
    processStripePayment,
    mpesaCallback,
    checkTransactionStatus,
    processMpesaWithdrawal,
    mpesaWithdrawalCallback,
    mpesaWithdrawalTimeout,
    checkWithdrawalStatus,
    processStripePayout,
    getStripePayoutDetails,
    stripePayoutWebhook,
    handleBalanceResult,
    handleBalanceTimeout} = require('../controllers/paymentController');
const router = express.Router();

router.post('/mpesa', processMpesaPayment);

router.post('/stripe', processStripePayment);

// Handle Payment Callbacks
//router.post("/stripe-webhook", express.raw({ type: "application/json" }), stripeWebhook);
router.post("/callback", mpesaCallback);
router.get('/mpesa/transaction/:transactionId', checkTransactionStatus);

// M-Pesa routes
router.post('/mpesa/withdrawal', processMpesaWithdrawal);
router.post('/mpesa/withdrawal/callback', mpesaWithdrawalCallback);
router.post('/mpesa/withdrawal/timeout', mpesaWithdrawalTimeout);
router.post('/mpesa/balance/callback', handleBalanceTimeout);
router.post('/mpesa/balance/timeout', handleBalanceResult);
router.get('/mpesa/withdrawal/status/:transactionId', checkWithdrawalStatus);

// Stripe routes
router.post('/stripe/payout', processStripePayout);
router.get('/stripe/payout/:payoutId', getStripePayoutDetails);
router.post('/stripe/webhook', stripePayoutWebhook);

module.exports = router;