const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const deleteFromS3 = require('../middleware/s3Delete');
const { sendEmailController  } = require('./messagingController');
const Settings = require('../models/Settings');
const Logger = require('../middleware/Logger');


const getSettings = async () => {
  const sysSettings = await Settings.findOne();
  return sysSettings;
}
// Register a new user
// Register a new user
exports.registerUser = async (req, res) => {
  try {
    const { name, phoneNumber, password, email } = req.body;
    Logger.info('Registering new user', { phoneNumber, email: email ? 'provided' : 'not provided' });

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
    Logger.debug('Password hashed successfully');

    // Create user
    const user = await User.create({ 
      name, 
      phoneNumber,
      email: email || undefined, // Optional field
      password: hashedPassword 
    });
    Logger.info('User created successfully', { userId: user._id });

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
    const user = await User.findById(req.params.userId);
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
    Logger.info('Login attempt', { phoneNumber });

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

    // Convert user to plain object and remove password and notificationPreferences
    const userObject = user.toObject();
    delete userObject.password;
    delete userObject.notificationPreferences;
    const settings = await getSettings();
    if (!settings) {
      Logger.error('Login failed - settings not found');
      return res.status(500).json({ message: 'Settings not found' });
    }
    
    let expiry = settings.passwordExpiry;
    if (typeof expiry === 'number') {
      expiry = `${expiry}d`; // convert to "7d", "1d", etc.
    }


    // Generate JWT token
    const token = jwt.sign(
      { user: { id: user._id } }, 
      process.env.JWT_SECRET, 
      { expiresIn: expiry }
    );
    Logger.debug('Login token generated', { userId: user._id });

    res.json({ token, user: userObject });
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
