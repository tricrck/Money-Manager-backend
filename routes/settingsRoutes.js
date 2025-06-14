const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const { getSettings, updateSettings, resetSettings, getSystemInfo, getMongoDBStats} = require('../controllers/settingsController');

// Settings routes
router.get('/', [auth, isAdmin], getSettings);
router.put('/', [auth, isAdmin], updateSettings);
router.get('/reset', [auth, isAdmin], resetSettings);
router.get('/server-info', [auth, isAdmin], getSystemInfo);
router.get('/db-info', [auth, isAdmin], getMongoDBStats);
module.exports = router;