const express = require('express');
const {
  registerUser,
  loginUser,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
const router = express.Router();

// Auth routes - these should come BEFORE any ID-based routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Collection route
router.get('/', getAllUsers);

// Dynamic ID-based routes - these should come AFTER any specific routes
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;