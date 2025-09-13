const nodemailer = require('nodemailer');
const admin = require("../config/firebase"); // Firebase admin SDK for push notifications
const User = require("../models/User");
const Logger = require('../middleware/Logger');
const axios = require('axios');

// Create transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Your Gmail address
    pass: process.env.GMAIL_APP_PASSWORD, // Your Gmail App Password
  },
});

const sendEmail = async (to, subject, body, isHtml = false, extraOptions = {}) => {
  const mailOptions = {
    from: process.env.GMAIL_USER, // Sender address
    to: to, // Recipient address
    subject: subject,
     ...(isHtml ? { html: body } : { text: body }),
    ...extraOptions
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    Logger.info('Email sent successfully', { to, subject, messageId: info.messageId });
    return { success: true, info };
  } catch (error) {
    Logger.error('Failed to send email', error, { to, subject });
    // Return an object indicating failure instead of throwing
    return { success: false, error };
  }
};

// Controller function to handle email sending
exports.sendEmailController = async (req, res) => {
  try {
    // Extract email data from request body
    const { to, subject, body } = req.body;

    // Validate required fields
    if (!to || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to, subject, and body are required'
      });
    }

    // Send email
    const result = await sendEmail(to, subject, body);

    // Send success response
    res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      messageId: result.messageId
    });

  } catch (error) {
    Logger.error('Error in sendEmailController', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send email',
      error: error.message
    });
  }
};


exports.sendPushNotification = async (userId, message) => {
  try {
    const user = await User.findById(userId);
    
    if (!user || !user.pushToken || !user.notificationPreferences.push) {
      Logger.warn('User not found or push notifications disabled', { userId });
      return { success: false, reason: 'No valid token or notifications disabled' };
    }

    const payload = {
      notification: {
        title: message.title,
        body: message.body,
      },
      token: user.pushToken,
    };

    const response = await admin.messaging().send(payload);
    Logger.info('Push notification sent successfully', { userId, response });
    return { success: true, response };
    
  } catch (error) {
    Logger.error('Failed to send push notification', error, { userId });
    
    // Handle specific FCM errors
    switch (error.code) {
      case 'messaging/registration-token-not-registered':
      case 'messaging/invalid-registration-token':
        Logger.warn('Invalid push token - removing from user', { userId, error });
        await User.findByIdAndUpdate(userId, { $unset: { pushToken: 1 } });
        return { success: false, reason: 'Invalid token - removed from database' };
        
      case 'messaging/message-rate-exceeded':
        return { success: false, reason: 'Rate limit exceeded' };
        
      case 'messaging/device-message-rate-exceeded':
        return { success: false, reason: 'Device rate limit exceeded' };
        
      case 'messaging/invalid-argument':
        return { success: false, reason: 'Invalid message format' };
        
      default:
        Logger.error('Unknown error sending push notification', error, { userId });
        return { success: false, reason: error.message };
    }
    
    // DON'T throw the error - return a failure response instead
    // This prevents the error from crashing the calling function
  }
};

const formatToE164 = (phone) => {
  // Strip non-digits
  let cleaned = phone.replace(/\D/g, '');

  // If already starts with country code
  if (cleaned.startsWith('254')) {
    return `+${cleaned}`;
  }

  // If starts with 0, replace with +254
  if (cleaned.startsWith('0')) {
    return `+254${cleaned.slice(1)}`;
  }

  throw new Error('Invalid phone number format');
};

// Function to send SMS via httpsms.com
const sendSMS = async (to, content) => {
  try {
    const formattedTo = formatToE164(to);

    const response = await axios.post(
      'https://api.httpsms.com/v1/messages/send',
      {
        content,
        to: formattedTo,
        from: process.env.HTTPSMS_FROM || '+25475550100' // ✅ required
      },
      {
        headers: {
          'x-api-key': process.env.HTTPSMS_API_KEY,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    return { success: true, data: response.data };
  } catch (error) {
    Logger.error(
      'Failed to send SMS',
      error.response ? error.response.data : error.message,
      { to, content }
    );
    return {
      success: false,
      error: error.response ? error.response.data : error.message
    };
  }
};

// Controller for handling SMS send requests
exports.sendSMSController = async (req, res) => {
  try {
    const { to, content } = req.body;

    if (!to || !content) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to and content are required'
      });
    }

    const result = await sendSMS(to, content);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'SMS sent successfully',
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send SMS',
        error: result.error
      });
    }
  } catch (error) {
    Logger.error('Error in sendSMSController', error);
    res.status(500).json({
      success: false,
      message: 'Unexpected error while sending SMS',
      error: error.message
    });
  }
};
exports.sendSMS = sendSMS;
exports.sendEmail = sendEmail;
