const Mpesa = require('mpesa-api').Mpesa;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const moment = require("moment");
const base64 = require("base-64");
const axios = require("axios");
const express = require("express");
const Payment = require("../models/Payment");
const crypto = require('crypto');
const MpesaTransaction = require("../models/MpesaTransaction");

exports.processMpesaPayment = async (req, res) => {
  try {
    const { phoneNumber, amount, paymentPurpose, relatedItemId, relatedItemModel, metadata = {} } = req.body;

    const userId = req.user ? req.user.id : metadata.userId;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Generate Timestamp & Password
    const timestamp = moment().format("YYYYMMDDHHmmss");
    const password = base64.encode(
      process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp
    );

    // Generate OAuth Token
    const authResponse = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        auth: {
          username: process.env.MPESA_CONSUMER_KEY,
          password: process.env.MPESA_CONSUMER_SECRET,
        },
      }
    );

    const accessToken = authResponse.data.access_token;

    // Send STK Push Request
    const stkResponse = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phoneNumber,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: "MoneyManager",
        TransactionDesc: "Payment for Money Manager",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Create a new transaction record in the database
    const transaction = new MpesaTransaction({
      userId,
      phoneNumber,
      amount,
      merchantRequestId: stkResponse.data.MerchantRequestID,
      checkoutRequestId: stkResponse.data.CheckoutRequestID,
      status: 'processing',
      paymentPurpose,
      relatedItemId: relatedItemId || undefined,
      relatedItemModel: relatedItemModel || undefined,
    });

    await transaction.save();
    
    // Return both the STK response and our transaction ID
    res.json({
      ...stkResponse.data,
      transactionId: transaction._id
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
};

// Step 3: Update the callback function to update our transaction
exports.mpesaCallback = async (req, res) => {
  try {
    const { Body } = req.body;
    if (!Body || !Body.stkCallback) {
      return res.status(400).json({ error: "Invalid callback data" });
    }

    const callbackData = Body.stkCallback;
    const resultCode = callbackData.ResultCode;
    const merchantRequestId = callbackData.MerchantRequestID;
    const checkoutRequestId = callbackData.CheckoutRequestID;
    
    // Find the transaction in our database
    const transaction = await MpesaTransaction.findOne({ 
      checkoutRequestId: checkoutRequestId 
    });

    if (!transaction) {
      console.log("Transaction not found for checkoutRequestId:", checkoutRequestId);
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Extract details
    let amount, transactionId, phoneNumber, transactionDate;
    if (callbackData.CallbackMetadata && callbackData.CallbackMetadata.Item) {
      callbackData.CallbackMetadata.Item.forEach((item) => {
        if (item.Name === "Amount") amount = item.Value;
        if (item.Name === "MpesaReceiptNumber") transactionId = item.Value;
        if (item.Name === "PhoneNumber") phoneNumber = item.Value;
        if (item.Name === "TransactionDate") transactionDate = item.Value;
      });
    }

    // Update transaction status
    transaction.resultCode = resultCode;
    transaction.resultDesc = callbackData.ResultDesc;
    
    if (transaction.resultCode === 0) {
      // Success case
      transaction.status = 'completed';
      transaction.transactionId = transactionId;
      transaction.completedAt = new Date();
      
      // Also save payment to the main Payment collection
      const payment = new Payment({
        userId: transaction.userId,
        paymentMethod: "M-Pesa",
        amount: amount || transaction.amount,
        currency: "KES",
        status: "success",
        paymentPurpose: transaction.paymentPurpose,
        relatedItemId: transaction.relatedItemId,
        relatedItemModel: transaction.relatedItemModel,
        transactionId: transactionId,
        description: "M-Pesa Payment",
        metadata: {
          phoneNumber: phoneNumber || transaction.phoneNumber,
          transactionDate: transactionDate
        }
      });

      await payment.save();
      console.log("Mpesa Payment saved:", payment);
    } else {
      // Failed case
      transaction.status = 'failed';
    }

    await transaction.save();
    res.status(200).json({ message: "Callback processed successfully" });
  } catch (error) {
    console.error("Error processing callback:", error);
    res.status(500).json({ error: error.message });
  }
};

// Step 4: Implement a status check endpoint for polling
exports.checkTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await MpesaTransaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    
    // If transaction is still processing and it's been more than 1 minute,
    // let's query M-Pesa for the latest status
    const oneMinuteAgo = new Date(Date.now() - 60000);
    if (transaction.status === 'processing' && transaction.createdAt < oneMinuteAgo) {
      try {
        const status = await queryMpesaTransactionStatus(transaction.checkoutRequestId);
        if (status) {
          transaction.status = status.success ? 'completed' : 'failed';
          transaction.resultCode = status.resultCode;
          transaction.resultDesc = status.resultDesc;
          
          if (status.success && status.transactionId) {
            transaction.transactionId = status.transactionId;
            transaction.completedAt = new Date();
            
            // Create a payment record if transaction was successful
            const payment = new Payment({
              userId: transaction.userId,
              paymentMethod: "M-Pesa",
              amount: transaction.amount,
              currency: "KES",
              status: "success",
              paymentPurpose: transaction.paymentPurpose,
              relatedItemId: transaction.relatedItemId,
              relatedItemModel: transaction.relatedItemModel,
              transactionId: status.transactionId,
              description: "M-Pesa Payment"
            });
            
            await payment.save();
          }
          
          await transaction.save();
        }
      } catch (error) {
        console.error("Error querying M-Pesa status:", error);
        // Don't update status on error, just continue
      }
    }
    
    res.json({
      status: transaction.status,
      resultDesc: transaction.resultDesc || "Transaction is being processed",
      transactionId: transaction.transactionId,
      amount: transaction.amount,
      completedAt: transaction.completedAt
    });
  } catch (error) {
    console.error("Error checking transaction status:", error);
    res.status(500).json({ error: error.message });
  }
};

// Step 5: Implement function to query M-Pesa for transaction status
async function queryMpesaTransactionStatus(checkoutRequestId) {
  try {
    // Generate OAuth Token
    const authResponse = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        auth: {
          username: process.env.MPESA_CONSUMER_KEY,
          password: process.env.MPESA_CONSUMER_SECRET,
        },
      }
    );

    const accessToken = authResponse.data.access_token;
    
    // Generate timestamp
    const timestamp = moment().format("YYYYMMDDHHmmss");
    const password = base64.encode(
      process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp
    );

    // Query transaction status
    const statusResponse = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query",
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const resultCode = statusResponse.data.ResultCode;
    return {
      success: resultCode === '0',
      resultCode: resultCode,
      resultDesc: statusResponse.data.ResultDesc,
      transactionId: resultCode === '0' ? statusResponse.data.CheckoutRequestID : null
    };
  } catch (error) {
    console.error("Error querying M-Pesa:", error);
    throw error;
  }
}


/**
 * Process a Stripe payment and save to database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Payment intent or error response
 */
exports.processStripePayment = async (req, res) => {
  try {
    // Extract and validate payment details
    const { amount, currency, paymentMethodId, description, paymentPurpose, relatedItemId, relatedItemModel, metadata = {} } = req.body;
    
    // Input validation
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount. Amount must be a positive number.' 
      });
    }
    
    if (!paymentMethodId) {
      return res.status(400).json({ 
        error: 'Payment method ID is required.' 
      });
    }
    
    const userId = req.user ? req.user.id : metadata.userId; // Get user ID from authenticated user or metadata
    
    // Validate currency (including support for Kenya's currency)
    const supportedCurrencies = ['usd', 'eur', 'gbp', 'kes']; // Added KES for Kenya
    if (!currency || !supportedCurrencies.includes(currency.toLowerCase())) {
      return res.status(400).json({ 
        error: `Currency not supported. Please use one of: ${supportedCurrencies.join(', ')}.` 
      });
    }
    
    // Create payment intent with enhanced options
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount), // Ensure amount is an integer (cents/smallest currency unit)
      currency: currency.toLowerCase(),
      payment_method: paymentMethodId,
      confirm: true,
      return_url: process.env.STRIPE_CALLBACK_URL,
      description: description || 'Payment transaction',
      metadata: {
        ...metadata,
        userId, // Include userId in metadata for webhook processing
        processedAt: new Date().toISOString(),
        paymentPurpose,
        relatedItemId: relatedItemId || '',
        relatedItemModel: relatedItemModel || '',
        ipAddress: req.ip || 'unknown'
      },
      receipt_email: req.body.email // Optional: send receipt if email is provided
    });
    
    // Save payment to database if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      try {
        const payment = new Payment({
          userId,
          paymentMethod: 'Stripe',
          amount: amount,
          currency: currency.toUpperCase(),
          status: 'success',
          transactionId: paymentIntent.id,
          paymentPurpose,
          relatedItemId: relatedItemId || undefined,
          relatedItemModel: relatedItemModel || undefined,
          description,
          receiptNumber: paymentIntent.charges?.data[0]?.receipt_number || null,
          metadata: {
            stripeEventId: paymentIntent.id,
            ip: req.ip
          }
        });

        await payment.save();
        console.log("Stripe Payment saved to database:", payment._id);
      } catch (dbError) {
        console.error("Error saving payment to database:", dbError.message);
        // Continue execution even if DB save fails
      }
    }
    
    // Return sanitized payment intent
    res.json({
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      client_secret: paymentIntent.client_secret,
      created: paymentIntent.created,
      receiptNumber: paymentIntent.receiptNumber,
      paymentSaved: paymentIntent.status === 'succeeded' // Indicate if payment was saved to DB
    });
    
  } catch (error) {
    // Enhanced error handling with specific status codes
    let statusCode = 500;
    let errorMessage = 'An error occurred while processing payment.';
    
    if (error.type) {
      switch (error.type) {
        case 'StripeCardError':
          // Card was declined
          statusCode = 400;
          errorMessage = error.message || 'Your card was declined.';
          break;
        case 'StripeInvalidRequestError':
          // Invalid parameters were supplied
          statusCode = 400;
          errorMessage = error.message || 'Invalid payment parameters.';
          break;
        case 'StripeAuthenticationError':
          // Authentication with Stripe failed
          statusCode = 401;
          errorMessage = 'Payment service authentication failed.';
          break;
        case 'StripeRateLimitError':
          statusCode = 429;
          errorMessage = 'Too many payment requests. Please try again later.';
          break;
        case 'StripeAPIError':
        case 'StripeConnectionError':
          statusCode = 503;
          errorMessage = 'Payment service unavailable. Please try again later.';
          break;
      }
    }
    
    // Log the error to console
    console.error(`Payment error: ${error.type || 'Unknown'} - ${error.message}`);
    
    // Return appropriate error response
    res.status(statusCode).json({ 
      error: errorMessage,
      code: error.code || 'unknown_error'
    });
  }
};

/**
 * Stripe webhook handler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
exports.stripeWebhook = async (req, res) => {
  let event;
  try {
    // Get the signature sent by Stripe
    
    const secret = process.env.STRIPE_WEBHOOK_SECRET; // Your webhook secret

    const payload = JSON.stringify(req.body); // Your test payload
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    
    // Verify the event came from Stripe
    event = stripe.webhooks.constructEvent(
      req.body, // raw body
      signature,
      secret
    );
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle different event types
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;

      // Check if payment already exists to avoid duplicates
      try {
        const existingPayment = await Payment.findOne({ transactionId: paymentIntent.id });
        
        if (!existingPayment) {
          // Save the payment details to DB
          const payment = new Payment({
            userId: paymentIntent.metadata.userId, // Using userId from metadata
            paymentMethod: "Stripe",
            amount: paymentIntent.amount / 100, // Convert cents to dollars
            currency: paymentIntent.currency,
            status: "success",
            transactionId: paymentIntent.id,
            description: paymentIntent.description,
            metadata: paymentIntent.metadata
          });

          await payment.save();
          console.log("Stripe Payment saved from webhook:", payment._id);
        } else {
          console.log("Payment already exists in database:", existingPayment._id);
        }
      } catch (dbError) {
        console.error("Database error in webhook:", dbError.message);
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      
      try {
        // Log failed payments
        const payment = new Payment({
          userId: paymentIntent.metadata.userId,
          paymentMethod: "Stripe",
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
          status: "failed",
          transactionId: paymentIntent.id,
          failureReason: paymentIntent.last_payment_error?.message || "Unknown failure reason",
          metadata: paymentIntent.metadata
        });
        
        await payment.save();
        console.log("Failed payment recorded:", payment._id);
      } catch (dbError) {
        console.error("Error recording failed payment:", dbError.message);
      }
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook: ${error.message}`);
    res.status(500).json({ error: "Error processing webhook" });
  }
};

 

/**
 * Retrieve payment details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Payment details or error response
 */
exports.getPaymentDetails = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }
    
    // First check if we have the payment in our database
    const localPayment = await Payment.findOne({ transactionId: paymentIntentId });
    
    if (localPayment) {
      return res.json({
        ...localPayment.toObject(),
        source: 'database'
      });
    }
    
    // If not in our database, retrieve from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    res.json({
      ...paymentIntent,
      source: 'stripe'
    });
  } catch (error) {
    console.error(`Error retrieving payment: ${error.message}`);
    res.status(404).json({ error: 'Payment not found or not accessible' });
  }
};

/**
 * Process Stripe Payout to customer bank account
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Payout details or error response
 */
exports.processStripePayout = async (req, res) => {
  try {
    const { 
      amount, 
      currency, 
      destination,
      withdrawalPurpose, 
      relatedItemId, 
      relatedItemModel, 
      description,
      metadata = {} 
    } = req.body;

    // Input validation
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount. Amount must be a positive number.' 
      });
    }
    
    if (!destination) {
      return res.status(400).json({ 
        error: 'Bank account or card ID (destination) is required.' 
      });
    }
    
    const userId = req.user ? req.user.id : metadata.userId;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    
    // Validate currency
    const supportedCurrencies = ['usd', 'eur', 'gbp', 'kes'];
    if (!currency || !supportedCurrencies.includes(currency.toLowerCase())) {
      return res.status(400).json({ 
        error: `Currency not supported. Please use one of: ${supportedCurrencies.join(', ')}.` 
      });
    }

    // Create the payout using Stripe
    const payout = await stripe.payouts.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      destination: destination,
      method: 'standard', // or 'instant' for instant payouts (fees apply)
      description: description || `Withdrawal - ${withdrawalPurpose || "Funds transfer"}`,
      metadata: {
        ...metadata,
        userId,
        withdrawalPurpose: withdrawalPurpose || "Funds transfer",
        relatedItemId: relatedItemId || '',
        relatedItemModel: relatedItemModel || '',
        processedAt: new Date().toISOString()
      }
    });

    // Log the withdrawal as a negative payment
    const payment = new Payment({
      userId,
      paymentMethod: 'Stripe',
      amount: -Math.abs(amount), // Negative to indicate outflow
      currency: currency.toUpperCase(),
      status: payout.status === 'paid' ? 'success' : 'pending',
      transactionId: payout.id,
      paymentPurpose: withdrawalPurpose || "Funds transfer",
      relatedItemId: relatedItemId || undefined,
      relatedItemModel: relatedItemModel || undefined,
      description: description || "Stripe Withdrawal",
      metadata: {
        stripePayoutId: payout.id,
        destination: payout.destination,
        arrivalDate: new Date(payout.arrival_date * 1000)
      }
    });

    await payment.save();
    
    // Return sanitized payout details
    res.json({
      id: payout.id,
      amount: payout.amount / 100, // Convert back to dollars
      currency: payout.currency,
      status: payout.status,
      destination: payout.destination,
      arrivalDate: new Date(payout.arrival_date * 1000),
      description: payout.description,
      method: payout.method,
      paymentId: payment._id
    });
  } catch (error) {
    // Enhanced error handling with specific status codes
    let statusCode = 500;
    let errorMessage = 'An error occurred while processing the withdrawal.';
    
    if (error.type) {
      switch (error.type) {
        case 'StripeInvalidRequestError':
          statusCode = 400;
          errorMessage = error.message || 'Invalid withdrawal parameters.';
          break;
        case 'StripeAuthenticationError':
          statusCode = 401;
          errorMessage = 'Payment service authentication failed.';
          break;
        case 'StripeRateLimitError':
          statusCode = 429;
          errorMessage = 'Too many withdrawal requests. Please try again later.';
          break;
        case 'StripeAPIError':
        case 'StripeConnectionError':
          statusCode = 503;
          errorMessage = 'Payment service unavailable. Please try again later.';
          break;
      }
    }
    
    console.error(`Withdrawal error: ${error.type || 'Unknown'} - ${error.message}`);
    
    res.status(statusCode).json({ 
      error: errorMessage,
      code: error.code || 'unknown_error'
    });
  }
};

/**
 * Get Stripe payout details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Payout details or error response
 */
exports.getStripePayoutDetails = async (req, res) => {
  try {
    const { payoutId } = req.params;
    
    if (!payoutId) {
      return res.status(400).json({ error: 'Payout ID is required' });
    }
    
    // First check if we have the payment record in our database
    const paymentRecord = await Payment.findOne({ 
      transactionId: payoutId,
      paymentMethod: 'Stripe'
    });
    
    // Then get the latest status from Stripe
    const payout = await stripe.payouts.retrieve(payoutId);
    
    let response = {
      id: payout.id,
      amount: payout.amount / 100, // Convert cents to dollars
      currency: payout.currency,
      status: payout.status,
      destination: payout.destination,
      description: payout.description,
      arrivalDate: new Date(payout.arrival_date * 1000),
      created: new Date(payout.created * 1000),
      metadata: payout.metadata,
      method: payout.method
    };
    
    // Add our internal data if available
    if (paymentRecord) {
      response.internalId = paymentRecord._id;
      response.userId = paymentRecord.userId;
      response.paymentPurpose = paymentRecord.paymentPurpose;
      response.relatedItemId = paymentRecord.relatedItemId;
      response.relatedItemModel = paymentRecord.relatedItemModel;
    }
    
    res.json(response);
  } catch (error) {
    console.error(`Error retrieving payout: ${error.message}`);
    res.status(404).json({ error: 'Payout not found or not accessible' });
  }
};

/**
 * Stripe payout webhook handler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
exports.stripePayoutWebhook = async (req, res) => {
  let event;
  try {
    // Get the signature sent by Stripe
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const payload = JSON.stringify(req.body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    
    // Verify the event came from Stripe
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      secret
    );
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle payout events
    if (event.type === "payout.paid" || event.type === "payout.failed") {
      const payout = event.data.object;
      
      // Find the corresponding payment record
      const payment = await Payment.findOne({ 
        transactionId: payout.id,
        paymentMethod: 'Stripe'
      });
      
      if (payment) {
        // Update payment status
        payment.status = event.type === "payout.paid" ? "success" : "failed";
        if (event.type === "payout.failed") {
          payment.failureReason = payout.failure_message || "Payout failed";
        }
        
        await payment.save();
        console.log(`Payout ${payout.id} status updated to ${payment.status}`);
      } else {
        console.log(`Payment record not found for payout: ${payout.id}`);
        
        // Create a new record if it doesn't exist
        if (payout.metadata && payout.metadata.userId) {
          const newPayment = new Payment({
            userId: payout.metadata.userId,
            paymentMethod: 'Stripe',
            amount: -Math.abs(payout.amount / 100), // Negative to indicate outflow
            currency: payout.currency.toUpperCase(),
            status: event.type === "payout.paid" ? "success" : "failed",
            transactionId: payout.id,
            description: payout.description || "Stripe Withdrawal",
            failureReason: event.type === "payout.failed" ? (payout.failure_message || "Payout failed") : undefined,
            metadata: {
              stripePayoutId: payout.id,
              destination: payout.destination,
              arrivalDate: new Date(payout.arrival_date * 1000),
              ...payout.metadata
            }
          });
          
          await newPayment.save();
          console.log(`New payment record created for payout: ${payout.id}`);
        }
      }
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
  } catch (error) {
    console.error(`Error processing payout webhook: ${error.message}`);
    res.status(500).json({ error: "Error processing webhook" });
  }
};

/**
 * Modified query function to handle both STK and B2C transaction status queries
 * @param {string} requestId - Either checkoutRequestId for STK or conversationId for B2C
 * @param {string} type - 'stk' or 'b2c' to determine which API to call
 * @returns {Promise<Object>} Status information
 */
async function queryMpesaTransactionStatus(requestId, type = 'stk') {
  try {
    // Generate OAuth Token
    const authResponse = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        auth: {
          username: process.env.MPESA_CONSUMER_KEY,
          password: process.env.MPESA_CONSUMER_SECRET,
        },
      }
    );

    const accessToken = authResponse.data.access_token;
    
    if (type === 'stk') {
      // STK Push query
      const timestamp = moment().format("YYYYMMDDHHmmss");
      const password = base64.encode(
        process.env.MPESA_SHORTCODE + process.env.MPESA_PASSKEY + timestamp
      );

      const statusResponse = await axios.post(
        "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query",
        {
          BusinessShortCode: process.env.MPESA_SHORTCODE,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: requestId
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const resultCode = statusResponse.data.ResultCode;
      return {
        success: resultCode === '0',
        resultCode: resultCode,
        resultDesc: statusResponse.data.ResultDesc,
        transactionId: resultCode === '0' ? statusResponse.data.CheckoutRequestID : null
      };
    } else if (type === 'b2c') {
      // B2C transaction query
      const password = base64.encode(
        process.env.MPESA_INITIATOR_PASSWORD
      );

      const statusResponse = await axios.post(
        "https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query",
        {
          Initiator: process.env.MPESA_INITIATOR_NAME,
          SecurityCredential: password,
          CommandID: "TransactionStatusQuery",
          TransactionID: requestId,
          PartyA: process.env.MPESA_SHORTCODE,
          IdentifierType: "4", // Organization shortcode
          ResultURL: process.env.MPESA_B2C_RESULT_URL,
          QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
          Remarks: "Transaction status query",
          Occasion: "Status check"
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return {
        success: statusResponse.data.ResponseCode === "0",
        resultCode: statusResponse.data.ResponseCode,
        resultDesc: statusResponse.data.ResponseDescription,
        transactionId: requestId
      };
    }
  } catch (error) {
    console.error(`Error querying M-Pesa (${type}):`, error.response?.data || error.message);
    throw error;
  }
};
/**
   * Check the Stripe account balance
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Promise<Object>} Balance details or error response
   * 
   * 
   */
exports.checkStripeBalance = async (req, res) => {
  try {
    const balance = await stripe.balance.retrieve();
    res.json(balance);
  } catch (error) {
    console.error("Stripe balance error:", error);
    res.status(500).json({ error: error.message });
  }
};
