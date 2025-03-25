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
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

// Auth routes - these should come BEFORE any ID-based routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Collection route
router.get('/', [auth, isAdmin], getAllUsers);

// Dynamic ID-based routes - these should come AFTER any specific routes
router.get('/:id', auth, getUser);
router.put('/:id', auth,  updateUser);
router.delete('/:id', auth, deleteUser);

module.exports = router;