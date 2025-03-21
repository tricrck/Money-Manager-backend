const express = require('express');
const { 
  createLoan, 
  getLoan, 
  getAllLoans, 
  updateLoan, 
  deleteLoan, 
  applyForLoan, 
  addGuarantor,
  guarantorApproval,
  reviewLoan,
  disburseLoan,
  repayLoan,
  getUserLoans,
  getGroupLoans,
  assessLateFees,
  markDefaulted,
  getLoanStatistics
} = require('../controllers/loanController');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const router = express.Router();

// Admin-only routes
router.post('/', [auth, isAdmin], createLoan);
router.get('/', [auth, isAdmin], getAllLoans);
router.put('/:id', [auth, isAdmin], updateLoan);
router.delete('/:id', [auth, isAdmin], deleteLoan);
router.post('/:id/review', [auth, isAdmin], reviewLoan);
router.post('/:id/disburse', [auth, isAdmin], disburseLoan);
router.post('/:id/late-fees', [auth, isAdmin], assessLateFees);
router.post('/:id/default', [auth, isAdmin], markDefaulted);
router.get('/statistics', [auth, isAdmin], getLoanStatistics);

// User-accessible routes (still requires authentication)
router.get('/:id', auth, getLoan); // Allow users to view their own loans
router.get('/user/:userId', auth, getUserLoans);
router.post('/apply/:userId', auth, applyForLoan);
router.get('/group/:groupId', auth, getGroupLoans);
router.post('/:loanId/guarantor/:userId', auth, addGuarantor);
router.post('/:loanId/guarantor/:guarantorId/approval', auth, guarantorApproval);
router.post('/:id/repay', auth, repayLoan);

module.exports = router;