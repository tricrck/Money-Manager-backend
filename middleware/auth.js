const jwt = require('jsonwebtoken');

/**
 * Authentication middleware
 * Verifies the JWT token from the Authorization header
 * and sets the authenticated user in the request object
 */
module.exports = function (req, res, next) {
  // Get token from Authorization header
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  const token = authHeader.split(' ')[1]; // Extract token

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Extract user ID from token payload
    const userId = decoded.user?.id || decoded.id;
    
    // Set user object with both id and _id for compatibility
    req.user = {
      id: userId,
      _id: userId  // Add _id property that your controllers expect
    };

    next();
  } catch (err) {
    console.error('JWT verification error:', err);
    return res.status(401).json({ message: 'Token is not valid' });
  }
};