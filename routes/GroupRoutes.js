const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const GroupController = require('../controllers/GroupController');
const contributionController = require('../controllers/ContributionController');

// @route   POST /api/groups
// @desc    Create a new group
// @access  Private
router.post(
  '/',
  [
    auth,
    [
      check('name', 'Group name is required').not().isEmpty(),
      check('groupType', 'Group type is required').isIn([
        'chama', 'sacco', 'table_banking', 'investment_club'
      ])
    ]
  ],
  GroupController.createGroup
);

// @route   GET /api/groups
// @desc    Get all groups
// @access  Private
router.get('/', auth, GroupController.getAllGroups);

// @route   GET /api/groups/my-groups
// @desc    Get groups created by or involving the current user
// @access  Private
router.get('/my-groups', auth, GroupController.getMyGroups);

// @route   GET /api/groups/public
// @desc    Get all public groups (for discovery)
// @access  Private
router.get('/public', auth, GroupController.getPublicGroups);

// @route   GET /api/groups/my-invitations
// @desc    Get user's pending invitations
// @access  Private
router.get('/my-invitations', auth, GroupController.getMyInvitations);

router.get('/my-join-requests', auth, GroupController.getUserJoinRequests);

// @route   GET /api/groups/:id
// @desc    Get single group by ID
// @access  Private
router.get('/:id', auth, GroupController.getGroupById);

// @route   PUT /api/groups/:id
// @desc    Update group details
// @access  Private (admin only)
router.put(
  '/:id',
  [
    auth,
    [
      check('name', 'Name must be a string').optional().isString(),
      check('groupType', 'Invalid group type').optional().isIn([
        'chama', 'sacco', 'table_banking', 'investment_club'
      ])
    ]
  ],
  GroupController.updateGroup
);

// @route   POST /api/groups/:id/members
// @desc    Add members to group
// @access  Private (admin only)
router.post('/:id/members', auth, GroupController.addMembers);

// @route   PUT /api/groups/:id/members/:memberId
// @desc    Update member details (role, status)
// @access  Private (admin only)
router.put(
  '/:id/members/:memberId', 
  [
    auth,
    [
      check('role', 'Invalid role').optional().isIn([
        'member', 'admin', 'treasurer', 'chair', 'secretary'
      ]),
      check('status', 'Invalid status').optional().isIn([
        'active', 'inactive', 'suspended'
      ])
    ]
  ],
  GroupController.updateMember
);

// @route   DELETE /api/groups/:id/members/:memberId
// @desc    Remove a member from the group
// @access  Private (admin only)
router.delete('/:id/members/:memberId', auth, GroupController.removeMember);

// @route   POST /api/groups/:id/leave
// @desc    Leave a group (for self)
// @access  Private
router.post('/:id/leave', auth, GroupController.leaveGroup);

// @route   DELETE /api/groups/:id
// @desc    Delete a group
// @access  Private (creator only)
router.delete('/:id', auth, GroupController.deleteGroup);

// @route   PUT /api/groups/:id/accounts
// @desc    Update group account balances
// @access  Private (admin or treasurer only)
router.put('/:id/accounts', auth, GroupController.updateAccounts);

// @route   PUT /api/groups/:id/transfer-ownership
// @desc    Transfer group ownership
// @access  Private (creator only)
router.put(
  '/:id/transfer-ownership',
  [
    auth,
    [
      check('newOwnerId', 'New owner ID is required').not().isEmpty()
    ]
  ],
  GroupController.transferOwnership
);
// Contribute from wallet to group
// POST /api/groups/:id/contributions/wallet
router.post(
  '/:id/contributions/wallet',
  [
    auth,
    [
      check('totalAmount', 'Amount is required and must be positive').isFloat({ min: 0.01 }),
      check('allocations', 'Allocations must be a non-empty array').isArray({ min: 1 }),
      check('allocations.*.account', 'Each allocation must have a valid account').isString().notEmpty(),
      check('allocations.*.amount', 'Each allocation must have a positive amount').isFloat({ min: 0.01 })
    ]
  ],
  contributionController.contributeFromWallet
);


// Record cash contribution
// POST /api/groups/:id/contributions/cash
router.post(
  '/:id/contributions/cash',
  [
    auth,
    [
      check('memberId', 'Member ID is required').not().isEmpty(),
      check('amount', 'Amount is required and must be positive').isFloat({ min: 0.01 }),
      check('notes').optional().isString(),
      check('reference').optional().isString()
    ]
  ],
  contributionController.recordCashContribution
);

// Record mobile money contribution
// POST /api/groups/:id/contributions/mobile
router.post(
  '/:id/contributions/mobile',
  [
    auth,
    [
      check('memberId', 'Member ID is required').not().isEmpty(),
      check('amount', 'Amount is required and must be positive').isFloat({ min: 0.01 }),
      check('reference', 'Transaction reference is required').not().isEmpty(),
      check('notes').optional().isString()
    ]
  ],
  contributionController.recordMobileMoneyContribution
);

// Get member contributions
// GET /api/groups/:id/contributions/member/:memberId
router.get(
  '/:id/contributions/member/:memberId',
  auth,
  contributionController.getMemberContributions
);

// Get all group contributions
// GET /api/groups/:id/contributions
router.get(
  '/:id/contributions',
  auth,
  contributionController.getGroupContributions
);




// @route   POST /api/groups/:id/invite
// @desc    Send invitation to user by username
// @access  Private (admin only)
router.post(
  '/:id/invite',
  [
    auth,
    [
      check('username', 'Username is required').not().isEmpty(),
      check('role', 'Invalid role').optional().isIn([
        'member', 'admin', 'treasurer', 'chair', 'secretary'
      ])
    ]
  ],
  GroupController.inviteUser
);

// @route   POST /api/groups/:id/invitations/:invitationId/respond
// @desc    Accept or decline invitation
// @access  Private
router.post(
  '/:id/invitations/:invitationId/respond',
  [
    auth,
    [
      check('response', 'Response must be "accept" or "decline"').isIn(['accept', 'decline'])
    ]
  ],
  GroupController.respondToInvitation
);

// @route   POST /api/groups/:id/join-request
// @desc    Request to join a group
// @access  Private
router.post(
  '/:id/join-request',
  [
    auth,
    [
      check('message').optional().isString()
    ]
  ],
  GroupController.requestToJoin
);

// @route   POST /api/groups/:id/join-requests/:userId/review
// @desc    Review join request (approve/reject)
// @access  Private (admin only)
router.post(
  '/:id/join-requests/:userId/review',
  [
    auth,
    [
      check('decision', 'Decision must be "approve" or "reject"').isIn(['approve', 'reject'])
    ]
  ],
  GroupController.reviewJoinRequest
);

router.get('/:id/join-requests', auth, GroupController.getJoinRequests);
router.post('/:id/fund-wallet', auth, contributionController.fundWallet);
router.post('/:id/pay-member', auth, contributionController.payMember); // cash Payment recording

module.exports = router;