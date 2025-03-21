const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Register a new user
// Register a new user
exports.registerUser = async (req, res) => {
  try {
    const { name, phoneNumber, password, email } = req.body;

    // Check if user already exists by phoneNumber
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this phone number already exists' });
    }

    // Check if email is provided and unique
    if (email) {
      const existingEmailUser = await User.findOne({ email });
      if (existingEmailUser) {
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

    res.status(201).json({ 
      message: 'User registered successfully', 
      user: userResponse 
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// User login
exports.loginUser = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    // Find user by phoneNumber
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(400).json({ message: 'Invalid phone number' });
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { user: { id: user._id } }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password'); // Exclude passwords
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get a user by ID
exports.getUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    const user = await User.findById(id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a user by ID
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    
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
    
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete a user by ID
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};