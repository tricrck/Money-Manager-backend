const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const deleteFromS3 = require('../middleware/s3Delete');
const { sendEmailController  } = require('./messagingController');
const Settings = require('../models/Settings');
const Logger = require('../middleware/Logger');
const crypto = require('crypto');
const { sendSMS } = require('./messagingController')
const { issueTokensAndCreateSession } = require("../middleware/authUtils")

const getSettings = async () => {
  const sysSettings = await Settings.findOne();
  return sysSettings;
}

const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};


// Register a new user
exports.registerUser = async (req, res) => {
  try {
    const { name, phoneNumber, password, email } = req.body;

    // Check if user already exists by phoneNumber
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      Logger.warn('Registration failed - phone number already exists', { phoneNumber });
      return res.status(400).json({ message: 'User with this phone number already exists' });
    }

    // Check if email is provided and unique
    if (email) {
      const existingEmailUser = await User.findOne({ email });
      if (existingEmailUser) {
        Logger.warn('Registration failed - email already exists', { email });
        return res.status(400).json({ message: 'User with this email already exists' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({ 
      name, 
      phoneNumber,
      email: email || undefined, // Optional field
      password: hashedPassword 
    });

    // Return user without sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.notificationPreferences;
    const settings = await getSettings();

    // Generate JWT token
    const token = jwt.sign(
      { user: { id: user._id } }, 
      process.env.JWT_SECRET, 
      { expiresIn: `${settings.passwordExpiry}d` }
    );
    Logger.debug('JWT token generated', { userId: user._id });

    res.json({ token, user: userResponse });
    Logger.info('User registration completed successfully', { userId: user._id });
  } catch (error) {
    Logger.error('User registration failed', error);
    res.status(400).json({ error: error.message });
  }
};

exports.uploadProfilePicture = async (req, res) => {
  try {
    const userId = req?.params?.userId;
    const user = await User.findById(req?.params?.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    Logger.info('Uploading profile picture', { userId });

    if (!req.file || !req.file.location) {
      Logger.warn('Profile picture upload failed - no file uploaded', { userId });
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Optional: delete old picture
    if (user.profilePicture) {
      Logger.debug('Deleting old profile picture', { userId, oldPicture: user.profilePicture });
      await deleteFromS3(user.profilePicture);
    }

    user.profilePicture = req.file.location;
    await user.save();
    Logger.info('Profile picture updated successfully', { userId, newPicture: user.profilePicture });

    res.status(200).json({ message: 'Profile picture updated', url: user.profilePicture });
  } catch (err) {
    Logger.error('Profile picture upload failed', err, { userId: req.params.userId });
    res.status(500).json({ error: err.message });
  }
};

// User login
exports.loginUser = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    // Find user by phoneNumber
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      Logger.warn('Login failed - invalid phone number', { phoneNumber });
      return res.status(400).json({ message: 'Invalid phone number' });
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      Logger.warn('Login failed - invalid password', { userId: user._id });
      return res.status(400).json({ message: 'Invalid password' });
    }

    // Use the auth utility to issue tokens and create session
    const data = await issueTokensAndCreateSession(user, req);

    Logger.info('User logged in successfully', { userId: user._id });
    res.json(data);
  } catch (error) {
    Logger.error('Login failed', error);
    res.status(500).json({ error: error.message });
  }
};

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password'); 
    Logger.info('Retrieved all users', { count: users.length });
    res.json(users);
  } catch (error) {
    Logger.error('Failed to fetch all users', error);
    res.status(500).json({ error: error.message });
  }
};

// Get a user by ID
exports.getUser = async (req, res) => {
  try {
    let id = req.params?.id;
    if (!id || id === 'undefined') {
      id = req.user?.id;
    }
    Logger.debug('Fetching user by ID', { userId: id });
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    const user = await User.findById(id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    Logger.info('User retrieved successfully', { userId: id });
    res.json(user);
  } catch (error) {
    Logger.error('Failed to fetch user', error, { userId: req.params.id });
    res.status(500).json({ error: error.message });
  }
};

// Update a user by ID
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    Logger.info('Updating user', { userId: id, updates: Object.keys(req.body) });
    
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    // If updating password, hash it first
    if (req.body.password) {
      req.body.password = await bcrypt.hash(req.body.password, 10);
    }
    
    const user = await User.findByIdAndUpdate(
      id, 
      req.body, 
      { new: true, runValidators: true }
    ).select('-password');
    console.log('Updated user:', user);
    
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    res.json(user);
  } catch (error) {
    Logger.error('Failed to update user', error, { userId: req.params.id });
    res.status(400).json({ error: error.message });
  }
};

// Delete a user by ID
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    Logger.info('Deleting user', { userId: id });
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    Logger.info('User deleted successfully', { userId: id });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    Logger.error('Failed to delete user', error, { userId: req.params.id });
    res.status(500).json({ error: error.message });
  }
};

exports.sendPasswordResetLink = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const resetLink = `${process.env.URL_ORIGIN}/reset-password/${token}`;

    await sendEmailController(
      email,
      'Password Reset Request, expires in 15 minutes',
      `Click this link to reset your password: ${resetLink}`
    );
    Logger.info('Password reset link sent', { email, userId: user._id });

    res.json({ message: 'Password reset link sent' });
  } catch (error) {
    Logger.error('Failed to send password reset link', error);
    res.status(500).json({ error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      Logger.warn('Password reset failed - user not found', { userId: decoded.userId });
      return res.status(404).json({ message: 'Invalid token or user not found' });
    } 

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    Logger.info('Password reset successfully', { userId: user._id });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    Logger.error('Failed to reset password', error);
    res.status(400).json({ error: 'Token expired or invalid' });
  }
};

// LOGOUT USER (invalidate session)
exports.logoutUser = async (req, res) => {
  const authHeader = req.header('Authorization');

  // If no header, just skip and return success
  if (!authHeader) {
    return res.json({ message: 'No session found, already logged out' });
  }
  try {
    const refreshToken = req.header('Authorization').split(' ')[1];
    console.log('Logout request received', refreshToken);

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    const user = await User.findById(decoded.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Remove the session
    user.sessions = user.sessions.filter(s => s.token !== refreshToken);
    user.isOnline = user.sessions.length > 0;
    user.lastActive = new Date();
    await user.save();

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    Logger.error('Logout failed', err);
    res.status(500).json({ error: err.message });
  }
};

// GET ACTIVE SESSIONS
exports.getUserSessions = async (req, res) => {
  Logger.info('Fetching user sessions', { userId: req.user.id });
  try {
    // Ensure only admins can view all sessions
    const requestingUser = await User.findById(req.user.id).select('role');
    Logger.debug('Requesting user role', { userId: req.user.id, role: requestingUser?.role });
    
    if (!requestingUser || requestingUser.role !== 'Admin') {
      Logger.warn('Unauthorized access attempt', { userId: req.user.id, role: requestingUser?.role });
      return res.status(403).json({ message: 'Access denied. Admins only.' });
    }

    Logger.debug('Requesting user is admin', { role: requestingUser.role });

    // Get only users who have sessions
    const users = await User.find({
      $and: [
        { sessions: { $exists: true } },
        { sessions: { $not: { $size: 0 } } }
      ]
    })
      .select('name email role sessions')
      .lean();

    Logger.debug('Found users with sessions', { count: users.length });

    // Map users with their session count and details
    const result = users.map(user => {
      // Handle case where sessions might be undefined or not an array
      const sessions = Array.isArray(user.sessions) ? user.sessions : [];
      
      return {
        name: user.name,
        email: user.email,
        role: user.role,
        totalSessions: sessions.length,
        activeSessions: sessions.filter(s => s && s.isActive).length,
        sessions: sessions.map(s => ({
          deviceId: s?.deviceId || 'Unknown',
          ip: s?.ip || 'Unknown',
          deviceInfo: s?.deviceInfo || 'Unknown',
          location: s?.location || 'Unknown',
          createdAt: s?.createdAt,
          lastActive: s?.lastActive,
          isActive: s?.isActive || false
        }))
      };
    });

    Logger.info('Successfully fetched user sessions', { totalUsers: result.length });
    res.json(result);
    
  } catch (err) {
    // Log the full error for debugging
    Logger.error('Error fetching user sessions', { 
      error: err.message, 
      stack: err.stack, 
      userId: req.user?.id 
    });
    res.status(500).json({ error: 'Failed to fetch user sessions' });
  }
};



// REVOKE SPECIFIC SESSION (like Gmail/Netflix)
exports.revokeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const user = await User.findById(req.user.id);
    user.sessions = user.sessions.filter(s => s._id.toString() !== sessionId);
    await user.save();
    res.json({ message: 'Session revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    const user = await User.findById(decoded.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const accessToken = jwt.sign({ user: { id: user._id } }, process.env.JWT_SECRET, { expiresIn: '15m' });

    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
};

// Send OTP to user's phone number
exports.sendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    // Find user by phone number
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      Logger.warn('OTP request failed - user not found', { phoneNumber });
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is already verified
    if (user.isVerified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    // Rate limiting: Check if OTP was sent recently (within 1 minute)
    if (user.otp?.lastSentAt) {
      const timeSinceLastOTP = Date.now() - user.otp.lastSentAt.getTime();
      const oneMinute = 60 * 1000;
      
      if (timeSinceLastOTP < oneMinute) {
        const waitTime = Math.ceil((oneMinute - timeSinceLastOTP) / 1000);
        return res.status(429).json({ 
          message: `Please wait ${waitTime} seconds before requesting another OTP` 
        });
      }
    }

    // Generate new OTP
    const otpCode = generateOTP();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Update user with OTP details
    user.otp = {
      code: otpCode,
      expiresAt: expiryTime,
      attempts: 0,
      maxAttempts: 5,
      lastSentAt: new Date()
    };

    await user.save();

    // Format phone number for SMS
    const formattedPhone = user.getFormattedPhone();
    
    // Send SMS
    const smsContent = `Your verification code is: ${otpCode}. This code will expire in 10 minutes. Do not share this code with anyone.`;
    
    const smsResult = await sendSMS(formattedPhone, smsContent);
    
    if (!smsResult.success) {
      Logger.error('Failed to send OTP SMS', smsResult.error, { userId: user._id, phoneNumber });
      return res.status(500).json({ 
        message: 'Failed to send OTP. Please try again later.',
        error: smsResult.error 
      });
    }

    Logger.info('OTP sent successfully', { 
      userId: user._id, 
      phoneNumber: formattedPhone,
      expiresAt: expiryTime 
    });

    res.json({ 
      message: 'OTP sent successfully to your phone number',
      expiresAt: expiryTime,
      phoneNumber: `****${formattedPhone.slice(-4)}` // Show only last 4 digits for security
    });

  } catch (error) {
    Logger.error('Send OTP failed', error);
    res.status(500).json({ error: error.message });
  }
};

// Verify OTP and update user verification status
exports.verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({ message: 'Phone number and OTP are required' });
    }

    // Find user by phone number
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      Logger.warn('OTP verification failed - user not found', { phoneNumber });
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is already verified
    if (user.isVerified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    // Check if OTP exists
    if (!user.otp || !user.otp.code) {
      return res.status(400).json({ message: 'No OTP found. Please request a new one.' });
    }

    // Check if OTP has expired
    if (new Date() > user.otp.expiresAt) {
      Logger.warn('OTP verification failed - expired', { userId: user._id });
      
      // Clear expired OTP
      user.otp = undefined;
      await user.save();
      
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    // Check if maximum attempts exceeded
    if (user.otp.attempts >= user.otp.maxAttempts) {
      Logger.warn('OTP verification failed - max attempts exceeded', { userId: user._id });
      
      // Clear OTP after max attempts
      user.otp = undefined;
      await user.save();
      
      return res.status(400).json({ 
        message: 'Maximum OTP attempts exceeded. Please request a new OTP.' 
      });
    }

    // Increment attempts
    user.otp.attempts += 1;

    // Verify OTP
    if (user.otp.code !== otp.toString()) {
      await user.save(); // Save incremented attempts
      
      const remainingAttempts = user.otp.maxAttempts - user.otp.attempts;
      Logger.warn('OTP verification failed - incorrect code', { 
        userId: user._id, 
        attempts: user.otp.attempts,
        remainingAttempts 
      });
      
      return res.status(400).json({ 
        message: `Invalid OTP. ${remainingAttempts} attempts remaining.` 
      });
    }

    // OTP is valid - verify user and clear OTP
    user.isVerified = true;
    user.otp = undefined; // Clear OTP data
    await user.save();

    Logger.info('User verified successfully via OTP', { userId: user._id, phoneNumber });

    // Return user data without sensitive information
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.notificationPreferences;
    delete userResponse.otp;

    res.json({ 
      message: 'Phone number verified successfully',
      user: userResponse 
    });

  } catch (error) {
    Logger.error('OTP verification failed', error);
    res.status(500).json({ error: error.message });
  }
};

// Resend OTP (same as sendOTP but with different messaging)
exports.resendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    // Rate limiting for resend (2 minutes)
    if (user.otp?.lastSentAt) {
      const timeSinceLastOTP = Date.now() - user.otp.lastSentAt.getTime();
      const twoMinutes = 2 * 60 * 1000;
      
      if (timeSinceLastOTP < twoMinutes) {
        const waitTime = Math.ceil((twoMinutes - timeSinceLastOTP) / 1000);
        return res.status(429).json({ 
          message: `Please wait ${Math.ceil(waitTime / 60)} minute(s) before requesting another OTP` 
        });
      }
    }

    // Generate new OTP
    const otpCode = generateOTP();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

    user.otp = {
      code: otpCode,
      expiresAt: expiryTime,
      attempts: 0,
      maxAttempts: 5,
      lastSentAt: new Date()
    };

    await user.save();

    const formattedPhone = user.getFormattedPhone();
    const smsContent = `Your new verification code is: ${otpCode}. This code will expire in 10 minutes.`;
    
    const smsResult = await sendSMS(formattedPhone, smsContent);
    
    if (!smsResult.success) {
      Logger.error('Failed to resend OTP SMS', smsResult.error, { userId: user._id });
      return res.status(500).json({ 
        message: 'Failed to resend OTP. Please try again later.' 
      });
    }

    Logger.info('OTP resent successfully', { userId: user._id, phoneNumber: formattedPhone });

    res.json({ 
      message: 'OTP resent successfully',
      expiresAt: expiryTime 
    });

  } catch (error) {
    Logger.error('Resend OTP failed', error);
    res.status(500).json({ error: error.message });
  }
};

// Check verification status
exports.checkVerificationStatus = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    const user = await User.findOne({ phoneNumber }).select('isVerified phoneNumber');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ 
      phoneNumber: user.phoneNumber,
      isVerified: user.isVerified 
    });

  } catch (error) {
    Logger.error('Check verification status failed', error);
    res.status(500).json({ error: error.message });
  }
};