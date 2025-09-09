// middlewares/authorizeRoles.js
const User = require('../models/User');

const authorizeRoles = (...roles) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'Unauthorized: No user info found' });
      }

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (!roles.includes(user.role)) {
        return res.status(403).json({ message: `Access denied: Requires one of [${roles.join(', ')}]` });
      }

      // Attach role to request if needed
      req.user.role = user.role;

      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
};

module.exports = authorizeRoles;