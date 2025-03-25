const express = require('express');
const { 
    processMpesaPayment, 
    processStripePayment,
    mpesaCallback,
    checkTransactionStatus,
    processStripePayout,
    getStripePayoutDetails,
    stripePayoutWebhook,
    checkStripeBalance,
    getPaymentDetails,
    stripeWebhook} = require('../controllers/paymentController');
const { 
        handleBalanceResult,
        handleBalanceTimeout,
        checkMpesaBalance} = require('../controllers/MpesaBalanceController');
const { 
            processMpesaWithdrawal,
            mpesaWithdrawalCallback,
            mpesaWithdrawalTimeout,
            checkWithdrawalStatus } = require('../controllers/MpesaWithdrawalController');
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
router.post('/mpesa/balance/callback', handleBalanceResult);
router.post('/mpesa/balance/timeout', handleBalanceTimeout);
router.get('/mpesa/withdrawal/status/:transactionId', checkWithdrawalStatus);
router.post('/mpesa/checkbalance', checkMpesaBalance);

// Stripe Payment Endpoints
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
router.get('/stripe/payment/:paymentIntentId', getPaymentDetails);

// Stripe Payout Endpoints
router.post('/stripe/payout', processStripePayout);
router.get('/stripe/payout/:payoutId', getStripePayoutDetails);
router.post('/stripe/payout/webhook', express.raw({ type: 'application/json' }), stripePayoutWebhook);

// Utility Endpoint: Check Stripe Account Balance
router.get('/stripe/balance', checkStripeBalance);

module.exports = router;