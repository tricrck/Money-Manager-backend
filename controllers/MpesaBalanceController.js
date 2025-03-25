const axios = require('axios');
const base64 = require('base-64');
const MpesaBalanceRequest = require('../models/mpesaBalanceRequest');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const Payment = require("../models/Payment");

class MpesaBalanceController {
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
      console.error('OAuth Token Error:', error.response?.data || error.message);
      throw new Error('Failed to generate token');
    }
  }

  static async checkMpesaBalance(req, res) {
    try {
      // Load initiator password
      const initiatorPassword = process.env.MPESA_INITIATOR_PASSWORD;
      if (!initiatorPassword) throw new Error("Initiator password not set.");

      // Load and validate certificate
      const certificatePath = path.join(__dirname, '../certs/sandbox-cert.cer');
      if (!fs.existsSync(certificatePath)) {
        throw new Error(`Certificate missing: ${certificatePath}`);
      }
      let publicKey = fs.readFileSync(certificatePath, 'utf8');
      if (!publicKey.includes('BEGIN CERTIFICATE')) {
        publicKey = `-----BEGIN CERTIFICATE-----\n${publicKey}\n-----END CERTIFICATE-----`;
      }

      // Encrypt password
      const encrypted = crypto.publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(initiatorPassword)
      );
      const securityCredential = encrypted.toString('base64');

      // Get access token
      const accessToken = await MpesaBalanceController.generateOAuthToken();
      // Send balance request
      const response = await axios.post(
        'https://sandbox.safaricom.co.ke/mpesa/accountbalance/v1/query',
        {
          Initiator: process.env.MPESA_INITIATOR_NAME,
          SecurityCredential: securityCredential,
          CommandID: 'AccountBalance',
          PartyA: process.env.MPESA_SHORTCODE,
          IdentifierType: '4',
          Remarks: 'Balance check',
          QueueTimeOutURL: process.env.MPESA_BALANCE_TIMEOUT_URL,
          ResultURL: process.env.MPESA_BALANCE_RESULT_URL,
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Extract response data
      const responseData = response.data;

      const newBalanceRequest = new MpesaBalanceRequest({
        originatorConversationId: responseData.OriginatorConversationID,
        initiator: process.env.MPESA_INITIATOR_NAME, // Replace with actual initiator data
        status: responseData.ResponseCode === "0" ? "success" : "failed",
        balanceInfo: {}, // Will be updated later if needed
        errorDetails: responseData.ResponseCode !== "0" ? {
          resultCode: responseData.ResponseCode,
          resultDescription: responseData.ResponseDescription
        } : {},
        requestedAt: new Date(),
        completedAt: responseData.ResponseCode === "0" ? new Date() : null
      });
      
      // Save the new request in MongoDB
      await newBalanceRequest.save();

      res.json({
        message: 'Request initiated',
        data: response.data
      });

    } catch (error) {
      console.error('Error:', error.response?.data || error.message);
      res.status(500).json({
        error: 'Failed to check balance',
        details: error.message
      });
    }
  }

  /**
   * Handle the timeout response from M-Pesa Account Balance API
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async handleBalanceTimeout(req, res) {
    try {
      const { 
        OriginatorConversationID, 
        ResultCode, 
        ResultDesc, 
        ConversationID, 
        TransactionID,
        ResultParameters,
        ReferenceData
      } = req.body;
  
      // Find and update the corresponding balance request
      const balanceRequest = await MpesaBalanceRequest.findOne({ 
        originatorConversationId: OriginatorConversationID 
      });
  
      if (balanceRequest) {
        // Check if it's a non-zero result code (error scenario)
        if (ResultCode !== 0) {
          await balanceRequest.updateWithResult({
            ResultCode,
            ResultDesc,
            ConversationID,
            TransactionID,
            ResultParameters: ResultParameters || {}
          });
        } else {
          // If no error, mark as timeout
          await balanceRequest.markAsTimeout({
            conversationId: ConversationID,
            transactionId: TransactionID,
            referenceData: ReferenceData,
            originalPayload: req.body
          });
        }
      } else {
        console.warn('No matching balance request found for:', OriginatorConversationID);
      }
  
      // Always respond with a success message to M-Pesa
      res.status(200).json({
        ResponseCode: '00000000',
        ResponseDesc: 'Notification received successfully'
      });
    } catch (error) {
      console.error('Error handling M-Pesa balance result/timeout:', error);
      res.status(200).json({
        ResponseCode: '00000000',
        ResponseDesc: 'Received'
      });
    }
  }

  /**
   * Handle the result response from M-Pesa Account Balance API
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async handleBalanceResult(req, res) {
    try {
      const resultParams = req.body.Result;
  
      // Find the corresponding balance request in MongoDB
      const balanceRequest = await MpesaBalanceRequest.findOne({
        originatorConversationId: resultParams.OriginatorConversationID
      });
  
      if (!balanceRequest) {
        console.warn('No matching request found for:', resultParams.OriginatorConversationID);
        return res.status(200).json({
          ResponseCode: '00000000',
          ResponseDesc: 'Balance result received successfully, but no matching request found'
        });
      }
  
      // Handle different response cases
      if (resultParams.ResultCode === 0) {
        // Successful response
        await balanceRequest.updateWithResult(resultParams);
      } else if (resultParams.ResultCode === 2001) {
        // Failed request (e.g., invalid initiator)
        await balanceRequest.updateOne({
          status: 'failed',
          errorDetails: {
            resultCode: resultParams.ResultCode,
            resultDescription: resultParams.ResultDesc
          },
          completedAt: new Date()
        });
      } else if (resultParams.ReferenceData?.ReferenceItem?.Key === 'QueueTimeoutURL') {
        // Timeout case
        await balanceRequest.markAsTimeout({
          timeoutReason: 'QueueTimeout',
          timeoutURL: resultParams.ReferenceData.ReferenceItem.Value
        });
      } else {
        // General failure case
        await balanceRequest.updateOne({
          status: 'failed',
          errorDetails: {
            resultCode: resultParams.ResultCode,
            resultDescription: resultParams.ResultDesc
          },
          completedAt: new Date()
        });
      }
  
      // Always respond with a success acknowledgment to M-Pesa
      res.status(200).json({
        ResponseCode: '00000000',
        ResponseDesc: 'Balance result processed successfully'
      });
  
    } catch (error) {
      console.error('Error handling M-Pesa balance result:', error);
      
      res.status(200).json({
        ResponseCode: '00000000',
        ResponseDesc: 'Received but error occurred'
      });
    }
  }  
}

module.exports = MpesaBalanceController;