const axios = require('axios');
const moment = require('moment');
const base64 = require('base-64');
const MpesaTransaction = require('../models/MpesaTransaction');
const Payment = require('../models/Payment');

class MpesaWithdrawalController {
  /**
   * Generate OAuth Token for M-Pesa API
   * @returns {Promise<string>} Access token
   */
  static async generateOAuthToken() {
    try {
      const response = await axios.get(
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
          auth: {
            username: process.env.MPESA_CONSUMER_KEY,
            password: process.env.MPESA_CONSUMER_SECRET,
          },
        }
      );
      return response.data.access_token;
    } catch (error) {
      console.error('OAuth Token Generation Error:', error.response?.data || error.message);
      throw new Error('Failed to generate OAuth token');
    }
  }

  /**
   * Process M-Pesa withdrawal (B2C) from business account to customer
   */
  static async processMpesaWithdrawal(req, res) {
    try {
      const { 
        phoneNumber, 
        amount, 
        reason, 
        withdrawalPurpose, 
        relatedItemId, 
        relatedItemModel, 
        metadata = {} 
      } = req.body;

      const userId = req.user ? req.user.id : metadata.userId;
      
      // Input validation
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      if (!phoneNumber || !amount || amount <= 0) {
        return res.status(400).json({ 
          error: "Valid phone number and amount are required" 
        });
      }

      // Validate command ID
      const commandId = reason || "BusinessPayment";
      const validReasons = ["BusinessPayment", "SalaryPayment", "PromotionPayment"];
      
      if (!validReasons.includes(commandId)) {
        return res.status(400).json({ 
          error: `Invalid reason. Must be one of: ${validReasons.join(', ')}` 
        });
      }

    //   // Create transaction record
    //   const transaction = await MpesaTransaction.createWithdrawal({
    //     userId,
    //     phoneNumber,
    //     amount,
    //     reason: commandId,
    //     withdrawalPurpose,
    //     relatedItemId,
    //     relatedItemModel
    //   });

      // Generate security credentials
      const password = base64.encode(process.env.MPESA_INITIATOR_PASSWORD);

      // Generate OAuth Token
      const accessToken = await MpesaWithdrawalController.generateOAuthToken();

      // Send B2C Request
      const b2cResponse = await axios.post(
        "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
        {
          InitiatorName: process.env.MPESA_INITIATOR_NAME,
          SecurityCredential: password,
          CommandID: commandId,
          Amount: amount,
          PartyA: process.env.MPESA_SHORTCODE,
          PartyB: phoneNumber,
          Remarks: `Withdrawal - ${withdrawalPurpose || "Funds transfer"}`,
          QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
          ResultURL: process.env.MPESA_B2C_RESULT_URL,
          Occasion: withdrawalPurpose || "Withdrawal"
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
            reason: commandId,
            paymentPurpose: withdrawalPurpose || "Withdrawal",
            status: "pending",
            relatedItemId: relatedItemId || undefined,
            relatedItemModel: relatedItemModel || undefined,
            originatorConversationId: b2cResponse.data.OriginatorConversationID,
            transactionId: b2cResponse.data.ConversationID,});
      
      await transaction.save();
      
      // Return response
      res.json({
        ...b2cResponse.data,
        transactionId: transaction._id
      });
    } catch (error) {
      console.error("M-Pesa withdrawal error:", error.response?.data || error.message);
      res.status(500).json({ 
        error: error.response?.data || error.message 
      });
    }
  }

  /**
   * Handle M-Pesa B2C result callback
   */
  static async mpesaWithdrawalCallback(req, res) {
    try {
      const { Result } = req.body;
      if (!Result) {
        return res.status(400).json({ error: "Invalid callback data" });
      }

      // Find the transaction
      const transaction = await MpesaTransaction.findOne({ 
        originatorConversationId: Result.OriginatorConversationID 
      });

      if (!transaction) {
        console.log("Transaction not found for conversation ID:", Result.OriginatorConversationID);
        return res.status(404).json({ error: "Transaction not found" });
      }

      // Update transaction status
      await transaction.updateStatus(Result);

      // Create payment record if transaction was successful
      if (transaction.status === 'completed') {
        const params = Result.ResultParameters?.ResultParameter.reduce((acc, param) => {
          acc[param.Key] = param.Value;
          return acc;
        }, {});

        const payment = new Payment({
          userId: transaction.userId,
          paymentMethod: "M-Pesa",
          amount: -Math.abs(transaction.amount),
          currency: "KES",
          status: "success",
          paymentPurpose: transaction.paymentPurpose,
          relatedItemId: transaction.relatedItemId,
          relatedItemModel: transaction.relatedItemModel,
          transactionId: transaction.transactionId,
          description: "M-Pesa Withdrawal",
          metadata: {
            phoneNumber: transaction.phoneNumber,
            receiverName: params.ReceiverPartyPublicName,
            completionTime: params.TransactionCompletedDateTime
          }
        });

        await payment.save();
        console.log("Mpesa Withdrawal recorded:", payment);
      }

      res.status(200).json({ message: "Withdrawal callback processed successfully" });
    } catch (error) {
      console.error("Error processing withdrawal callback:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle M-Pesa B2C timeout callback
   */
  static async mpesaWithdrawalTimeout(req, res) {
    try {
      const { Result } = req.body;
      if (!Result) {
        return res.status(400).json({ error: "Invalid timeout data" });
      }

      // Find the transaction
      const transaction = await MpesaTransaction.findOne({ 
        originatorConversationId: Result.OriginatorConversationID 
      });

      if (transaction) {
        // Mark transaction as timed out
        await transaction.markAsTimeout();
      }

      res.status(200).json({ message: "Timeout notification received" });
    } catch (error) {
      console.error("Error processing withdrawal timeout:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Check M-Pesa withdrawal transaction status
   */
  static async checkWithdrawalStatus(req, res) {
    try {
      const { transactionId } = req.params;
      
      const transaction = await MpesaTransaction.findById(transactionId);
      
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      
      // Additional status checking logic can be added here if needed
      
      res.json({
        status: transaction.status,
        resultDesc: transaction.resultDesc || "Transaction is being processed",
        transactionId: transaction.transactionId,
        amount: transaction.amount,
        phoneNumber: transaction.phoneNumber,
        completedAt: transaction.completedAt
      });
    } catch (error) {
      console.error("Error checking withdrawal status:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = MpesaWithdrawalController;