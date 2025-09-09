const express = require('express');
const {
  registerUser,
  loginUser,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  uploadProfilePicture,
  sendPasswordResetLink,
  resetPassword,
  refreshToken,
  sendOTP, 
  verifyOTP, 
  resendOTP, 
  checkVerificationStatus,
  logoutUser,
  getUserSessions,
  revokeSession
} = require('../controllers/userController');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require("../models/User");
const upload = require('../middleware/upload'); // Assuming you have a middleware for handling file uploads
const passport = require('passport');
require('../services/passport');
Logger = require('../middleware/Logger');

// Auth routes - these should come BEFORE any ID-based routes
router.post('/register', registerUser);
router.post('/upload-profile/:userId', upload.single('profilePicture'), uploadProfilePicture);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/send-reset-link', sendPasswordResetLink);
router.post('/reset-password/:token', resetPassword);
router.post('/auth/refresh', refreshToken);
router.post('/send-otp', auth, sendOTP);
router.post('/verify-otp', auth, verifyOTP);
router.post('/resend-otp', auth, resendOTP);
router.get('/verification-status/:phoneNumber', auth, checkVerificationStatus);
const { issueTokensAndCreateSession } = require("../middleware/authUtils");

// Social Authentication Routes
// Google
router.get('/auth/google', 
  passport.authenticate('google', { 
    scope: ['profile', 'email'] 
  })
);

router.get('/auth/google/callback',
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      if (req.user) {
        // Ensure req.user is a full Mongoose document
        const user = await User.findById(req.user._id);

        if (!user) {
          return res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
        }

        const data = await issueTokensAndCreateSession(user, req);
        
        // You can redirect to your frontend with the token
        // For mobile apps, you might want to use a different approach
        res.redirect(`${process.env.URL_ORIGIN}/auth/success?` +
        `accessToken=${data.accessToken}&refreshToken=${data.refreshToken}&user=${encodeURIComponent(JSON.stringify(data.user))}`);
      } else {
        res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
      }
    } catch (error) {
      console.error('Google callback error:', error);
      res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
    }
  }
);

// Facebook
router.get('/auth/facebook', 
  passport.authenticate('facebook', { 
    scope: ['email'] 
  })
);

router.get('/auth/facebook/callback',
  passport.authenticate('facebook', { session: false }),
  async (req, res) => {
    try {
      if (req.user) {
        // Ensure req.user is a full Mongoose document
        const user = await User.findById(req.user._id);

        if (!user) {
          return res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
        }

        const data = await issueTokensAndCreateSession(user, req);
        
        // You can redirect to your frontend with the token
        // For mobile apps, you might want to use a different approach
        res.redirect(`${process.env.URL_ORIGIN}/auth/success?` +
        `accessToken=${data.accessToken}&refreshToken=${data.refreshToken}&user=${encodeURIComponent(JSON.stringify(data.user))}`);
      } else {
        res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
      }
    } catch (error) {
      console.error('Facebook callback error:', error);
      res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
    }
  }
);

// Twitter (X)
router.get('/auth/twitter', 
  passport.authenticate('twitter')
);

router.get('/auth/twitter/callback',
  passport.authenticate('twitter', { session: false }),
  async (req, res) => {
    try {
      if (req.user) {
        // Ensure req.user is a full Mongoose document
        const user = await User.findById(req.user._id);

        if (!user) {
          return res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
        }

        const data = await issueTokensAndCreateSession(user, req);
        
        // You can redirect to your frontend with the token
        // For mobile apps, you might want to use a different approach
        res.redirect(`${process.env.URL_ORIGIN}/auth/success?` +
        `accessToken=${data.accessToken}&refreshToken=${data.refreshToken}&user=${encodeURIComponent(JSON.stringify(data.user))}`);
      } else {
        res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
      }
    } catch (error) {
      console.error('Twitter callback error:', error);
      res.redirect(`${process.env.URL_ORIGIN}/auth/error`);
    }
  }
);


// Collection route
router.get('/', auth, getAllUsers);
// Sessions
router.get('/sessions', auth, getUserSessions);
router.delete('/sessions/:sessionId', auth, revokeSession);

// Dynamic ID-based routes - these should come AFTER any specific routes
router.get('/:id', auth, getUser);
router.put('/:id', auth,  updateUser);
router.delete('/:id', auth, deleteUser);


module.exports = router;