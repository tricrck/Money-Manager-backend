const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const GroupController = require('../controllers/GroupController');

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

module.exports = router;