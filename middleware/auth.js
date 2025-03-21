const jwt = require('jsonwebtoken');

/**
 * Authentication middleware
 * Verifies the JWT token from the request header
 * and sets the authenticated user in the request object
 */
module.exports = function(req, res, next) {
  // Get token from header
  const token = req.header('x-auth-token');

  // Check if no token
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Set user data in req.user
    // If token has { id: user._id } structure, make it accessible as req.user.id
    req.user = {
      id: decoded.id || (decoded.user && decoded.user.id)
    };
    
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};