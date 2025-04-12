const User = require('../models/User');
/**
 * Admin authorization middleware
 * Checks if the authenticated user has admin role
 * Must be used after the auth middleware
 */
const isAdmin = async (req, res, next) => {
    try {
      // Assuming User model has been imported
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Check if user has admin role
      if (user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied: Admin privileges required' });
      }
      
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
  
  module.exports = isAdmin;