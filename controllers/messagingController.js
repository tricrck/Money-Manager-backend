const nodemailer = require('nodemailer');
const admin = require("../config/firebase"); // Firebase admin SDK for push notifications
const User = require("../models/User");
const Logger = require('../middleware/Logger');

// Create transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Your Gmail address
    pass: process.env.GMAIL_APP_PASSWORD, // Your Gmail App Password
  },
});

const sendEmail = async (to, subject, body) => {
  const mailOptions = {
    from: process.env.GMAIL_USER, // Sender address
    to: to, // Recipient address
    subject: subject,
    text: body, // Plain text body
    // html: body // If you want to send HTML content instead
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

exports.sendEmail = sendEmail;
