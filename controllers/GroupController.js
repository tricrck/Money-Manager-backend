const Group = require('../models/Group');
const User = require('../models/User');
const { validationResult } = require('express-validator');

/**
 * Group Controller
 */
class GroupController {
  /**
   * Create a new group
   * @route POST /api/groups
   * @access Private
   */
  async createGroup(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        name,
        groupType,
        description,
        admins,
        treasurer,
        settings,
        privacy = 'private'
      } = req.body;

      // Check if group with same name already exists
      const existingGroup = await Group.findOne({ name });
      if (existingGroup) {
        return res.status(400).json({ message: 'Group with this name already exists' });
      }

      // Create new group object
      const groupData = {
        name,
        groupType,
        description,
        privacy,
        createdBy: req.user.id,
        members: [
          {
            user: req.user.id,
            role: 'admin',
            status: 'active',
            joinedDate: Date.now()
          }
        ]
      };

      // Add optional fields if provided
      if (admins && admins.length > 0) {
        groupData.admins = admins;
      } else {
        groupData.admins = [req.user.id];
      }

      if (treasurer) {
        groupData.treasurer = treasurer;
      }

      if (settings) {
        groupData.settings = settings;
      }

      // Create and save the new group
      const group = new Group(groupData);
      await group.save();

      // Populate user data for response
      const populatedGroup = await Group.findById(group._id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email');

      res.status(201).json(populatedGroup);
    } catch (error) {
      console.error('Error creating group:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get all public groups (for discovery)
   * @route GET /api/groups/public
   * @access Private
   */
  async getPublicGroups(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10, search } = req.query;
      const skip = (page - 1) * limit;

      // Base query: public and active
      const query = {
        privacy: 'public',
        isActive: true,
        members: { $not: { $elemMatch: { user: userId } } }, // Exclude groups where user is a member
        joinRequests: { $not: { $elemMatch: { requestedBy: userId } } } // Exclude groups already requested
      };

      // Optional search filter
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }

      const groups = await Group.find(query)
        .populate('createdBy', 'name email username')
        .populate('admins', 'name email username')
        .select('name groupType description createdBy admins members privacy createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Group.countDocuments(query);

      const groupsWithStats = groups.map(group => ({
        ...group.toObject(),
        memberCount: group.members.length
      }));

      res.json({
        groups: groupsWithStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      console.error('Error fetching public groups:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get all groups
   * @route GET /api/groups
   * @access Private
   */
  async getAllGroups(req, res) {
    try {
      const groups = await Group.find()
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .sort({ createdAt: -1 });

      res.json(groups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get groups created by or involving the current user
   * @route GET /api/groups/my-groups
   * @access Private
   */
  async getMyGroups(req, res) {
    try {
      const userId = req.user.id;

      // Find groups where user is creator, admin, or member
      const groups = await Group.find({
        $or: [
          { createdBy: userId },
          { admins: userId },
          { treasurer: userId },
          { 'members.user': userId }
        ]
      })
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('invitations.invitedUser', 'name email username')
        .populate('invitations.invitedBy', 'name email username')
        .populate('joinRequests.requestedBy', 'name email username')
        .populate('joinRequests.reviewedBy', 'name email username')
        .sort({ createdAt: -1 });

      res.json(groups);
    } catch (error) {
      console.error('Error fetching user groups:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get user's pending invitations
   * @route GET /api/groups/my-invitations
   * @access Private
   */
  async getMyInvitations(req, res) {
    try {
      const userId = req.user.id;

      const groups = await Group.find({
        'invitations.invitedUser': userId,
        'invitations.status': 'pending'
      })
        .populate('createdBy', 'name email username')
        .populate('invitations.invitedBy', 'name email username')
        .select('name groupType description createdBy invitations privacy createdAt');

      // Extract only the relevant invitations
      const invitations = [];
      groups.forEach(group => {
        const userInvitations = group.invitations.filter(inv => 
          inv.invitedUser.toString() === userId && inv.status === 'pending'
        );
        userInvitations.forEach(invitation => {
          invitations.push({
            ...invitation.toObject(),
            group: {
              _id: group._id,
              name: group.name,
              groupType: group.groupType,
              description: group.description,
              createdBy: group.createdBy,
              privacy: group.privacy,
              createdAt: group.createdAt
            }
          });
        });
      });

      res.json(invitations);
    } catch (error) {
      console.error('Error fetching user invitations:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Send invitation to user by username
   * @route POST /api/groups/:id/invite
   * @access Private (admin only)
   */
  async inviteUser(req, res) {
    try {
      const { username, role = 'member', message = '' } = req.body;

      if (!username) {
        return res.status(400).json({ message: 'Username is required' });
      }

      // Find the user by username
      const invitedUser = await User.findOne({ username });
      if (!invitedUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if current user is authorized to send invites
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      if (!isAdmin && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only group admins can send invitations' });
      }

      // Send invitation
      try {
        const invitation = await group.sendInvitation(invitedUser._id, req.user.id, role, message);
        
        // Populate the invitation for response
        await group.populate('invitations.invitedUser', 'name email username');
        await group.populate('invitations.invitedBy', 'name email username');
        
        const populatedInvitation = group.invitations.find(inv => 
          inv.invitedUser._id.toString() === invitedUser._id.toString() &&
          inv.invitedBy._id.toString() === req.user.id &&
          inv.status === 'pending'
        );

        res.status(201).json({
          message: 'Invitation sent successfully',
          invitation: populatedInvitation
        });
      } catch (inviteError) {
        return res.status(400).json({ message: inviteError.message });
      }
    } catch (error) {
      console.error('Error sending invitation:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Accept or decline invitation
   * @route POST /api/groups/:id/invitations/:invitationId/respond
   * @access Private
   */
  async respondToInvitation(req, res) {
    try {
      const { response } = req.body; // 'accept' or 'decline'
      const { id: groupId, invitationId } = req.params;

      if (!['accept', 'decline'].includes(response)) {
        return res.status(400).json({ message: 'Invalid response. Must be "accept" or "decline"' });
      }

      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      const invitation = group.invitations.id(invitationId);
      if (!invitation) {
        return res.status(404).json({ message: 'Invitation not found' });
      }

      // Check if the current user is the invited user
      if (invitation.invitedUser.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. You can only respond to your own invitations' });
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ message: 'Invitation has already been responded to' });
      }

      try {
        let result;
        if (response === 'accept') {
          result = await group.acceptInvitation(req.user.id);
        } else {
          result = await group.declineInvitation(req.user.id);
        }

        res.json({
          message: `Invitation ${response}ed successfully`,
          invitation: result
        });
      } catch (responseError) {
        return res.status(400).json({ message: responseError.message });
      }
    } catch (error) {
      console.error('Error responding to invitation:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Request to join a group
   * @route POST /api/groups/:id/join-request
   * @access Private
   */
  async requestToJoin(req, res) {
    try {
      const { message = '' } = req.body;
      const groupId = req.params.id;

      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if group allows join requests
      if (group.privacy === 'private' && !group.settings?.allowJoinRequests) {
        return res.status(403).json({ message: 'This group does not accept join requests' });
      }

      try {
        const joinRequest = await group.requestToJoin(req.user.id, message);
        
        res.status(201).json({
          message: 'Join request sent successfully',
          joinRequest
        });
      } catch (requestError) {
        return res.status(400).json({ message: requestError.message });
      }
    } catch (error) {
      console.error('Error requesting to join group:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
 * Get join requests for a group
 * @route GET /api/groups/:id/join-requests
 * @access Private (admin or creator only)
 */
  async getJoinRequests(req, res) {
    try {
      const groupId = req.params.id;

      // Fetch group and populate requester info
      const group = await Group.findById(groupId)
        .populate('joinRequests.requestedBy', 'name email username')
        .populate('joinRequests.reviewedBy', 'name email username');
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check authorization: only admins or creator can view join requests
      const userId = req.user.id;
      const isAdmin = group.admins.some(admin => admin.toString() === userId);
      const isCreator = group.createdBy.toString() === userId;
      if (!isAdmin && !isCreator) {
        return res.status(403).json({ message: 'Access denied. Only group admins or creator can view join requests' });
      }

      // Optionally filter by status query param, default to pending
      let { status } = req.query; // e.g., ?status=pending
      if (!status) {
        status = 'pending';
      }
      const allowedStatuses = ['pending', 'approved', 'rejected'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status filter. Must be one of: ${allowedStatuses.join(', ')}` });
      }

      // Filter joinRequests by status
      const requests = group.joinRequests
        .filter(reqObj => reqObj.status === status)
        .map(reqObj => ({
          _id: reqObj._id,
          requestedBy: reqObj.requestedBy,   // populated user doc
          status: reqObj.status,
          requestedAt: reqObj.requestedAt,
          reviewedBy: reqObj.reviewedBy || null,
          reviewedAt: reqObj.reviewedAt || null,
          message: reqObj.message || '',
          reviewNote: reqObj.reviewNote || ''
        }));

      res.json({ joinRequests: requests });
    } catch (error) {
      console.error('Error fetching join requests:', error);
      if (error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Invalid group ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
  
  async getUserJoinRequests(req, res) {
    try {
      const userId = req.user.id;
      const { status } = req.query; // Only get status from query

      // Call the method with correct parameters
      const result = await Group.getUserJoinRequests(userId, status);

      res.json({
        success: true,
        data: result // result is already the array of requests
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Review join request (approve/reject)
   * @route POST /api/groups/:id/join-requests/:requestId/review
   * @access Private (admin only)
   */
  async reviewJoinRequest(req, res) {
    try {
      const { decision } = req.body; // 'approve' or 'reject'
      const { id: groupId, userId } = req.params;


      if (!['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ message: 'Invalid decision. Must be "approve" or "reject"' });
      }

      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if current user is authorized to review requests
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      if (!isAdmin && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only group admins can review join requests' });
      }

      try {
        let result;
        if (decision === 'approve') {
          result = await group.approveJoinRequest(userId, req.user.id);
        } else {
          result = await group.rejectJoinRequest(userId, req.user.id);
        }
        
        res.json({
          message: `Join request ${decision}d successfully`,
          joinRequest: result
        });
      } catch (reviewError) {
        return res.status(400).json({ message: reviewError.message });
      }
    } catch (error) {
      console.error('Error reviewing join request:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
  
  /**
   * Get single group by ID
   * @route GET /api/groups/:id
   * @access Private
   */
  async getGroupById(req, res) {
    try {
      const group = await Group.findById(req.params.id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email')
        .populate('invitations.invitedUser', 'name email username')
        .populate('invitations.invitedBy', 'name email username')
        .populate('joinRequests.requestedBy', 'name email username')
        .populate('joinRequests.reviewedBy', 'name email username');

      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user has access to view this group
      const userId = req.user.id;
      const isMember = group.members.some(member => member.user._id.toString() === userId);
      const isAdmin = group.admins.some(admin => admin._id.toString() === userId);
      const isCreator = group.createdBy._id.toString() === userId;
      const isPublic = group.privacy === 'public';

      if (!isPublic && !isMember && !isAdmin && !isCreator) {
        return res.status(403).json({ message: 'Access denied. You do not have permission to view this group' });
      }

      res.json(group);
    } catch (error) {
      console.error('Error fetching group:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Group not found' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Update group details
   * @route PUT /api/groups/:id
   * @access Private (admin only)
   */
  async updateGroup(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        name,
        description,
        admins,
        treasurer,
        groupType,
        settings,
        isActive,
        privacy,
      } = req.body;

      // Get the group
      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is an admin of the group
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      if (!isAdmin && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only group admins can update group details' });
      }

      // If name is being changed, check for duplicates
      if (name && name !== group.name) {
        const nameExists = await Group.findOne({ name, _id: { $ne: group._id } });
        if (nameExists) {
          return res.status(400).json({ message: 'Group with this name already exists' });
        }
        group.name = name;
      }

      // Update fields if provided
      if (description) group.description = description;
      if (groupType) group.groupType = groupType;
      if (typeof isActive === 'boolean') group.isActive = isActive;
      if (privacy) group.privacy = privacy;
      if (admins) group.admins = admins;
      if (treasurer) group.treasurer = treasurer;
      
      // Update settings if provided
      if (settings) {
        // Handle nested settings objects
        if (settings.contributionSchedule) {
          group.settings.contributionSchedule = {
            ...group.settings.contributionSchedule,
            ...settings.contributionSchedule
          };
        }
        
        if (settings.loanSettings) {
          group.settings.loanSettings = {
            ...group.settings.loanSettings,
            ...settings.loanSettings
          };
        }
        
        if (settings.meetingSchedule) {
          group.settings.meetingSchedule = {
            ...group.settings.meetingSchedule,
            ...settings.meetingSchedule
          };
        }
      }

      // Save updated group
      await group.save();

      // Return updated group with populated fields
      const updatedGroup = await Group.findById(group._id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email');

      res.json(updatedGroup);
    } catch (error) {
      console.error('Error updating group:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Group not found' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Add members to group
   * @route POST /api/groups/:id/members
   * @access Private (admin only)
   */
  async addMembers(req, res) {
    try {
      const { members } = req.body;
      if (!members || !Array.isArray(members) || members.length === 0) {
        return res.status(400).json({ message: 'Please provide at least one member to add' });
      }

      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is an admin of the group
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      if (!isAdmin && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only group admins can add members' });
      }

      // Process each member
      const newMembers = [];
      const existingMembers = [];
      const invalidUsers = [];

      for (const memberData of members) {
        try {
          // Check if user exists
          const user = await User.findById(memberData.userId);
          if (!user) {
            invalidUsers.push(memberData.userId);
            continue;
          }

          // Check if user is already a member
          const existingMember = group.members.find(
            m => m.user.toString() === memberData.userId
          );

          if (existingMember) {
            // Update existing member if needed
            if (memberData.role && existingMember.role !== memberData.role) {
              existingMember.role = memberData.role;
            }
            if (memberData.status && existingMember.status !== memberData.status) {
              existingMember.status = memberData.status;
            }
            existingMembers.push(memberData.userId);
          } else {
            // Add new member
            group.members.push({
              user: memberData.userId,
              role: memberData.role || 'member',
              status: memberData.status || 'active',
              joinedDate: Date.now()
            });
            newMembers.push(memberData.userId);
          }

          // Add as admin if role is admin
          if (memberData.role === 'admin' && !group.admins.includes(memberData.userId)) {
            group.admins.push(memberData.userId);
          }

          // Set as treasurer if role is treasurer
          if (memberData.role === 'treasurer') {
            group.treasurer = memberData.userId;
          }
        } catch (error) {
          console.error(`Error processing member ${memberData.userId}:`, error);
          invalidUsers.push(memberData.userId);
        }
      }

      // Save updated group
      await group.save();

      // Return updated group with populated fields
      const updatedGroup = await Group.findById(group._id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email');

      res.json({
        group: updatedGroup,
        summary: {
          added: newMembers,
          updated: existingMembers,
          invalid: invalidUsers
        }
      });
    } catch (error) {
      console.error('Error adding members:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid group ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Update member details (role, status)
   * @route PUT /api/groups/:id/members/:memberId
   * @access Private (admin only)
   */
  async updateMember(req, res) {
    try {
      const { role, status } = req.body;
      if (!role && !status) {
        return res.status(400).json({ message: 'Please provide either role or status to update' });
      }

      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is an admin of the group
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      if (!isAdmin && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only group admins can update members' });
      }

      // Find member in the group
      const memberIndex = group.members.findIndex(
        m => m.user.toString() === req.params.memberId
      );

      if (memberIndex === -1) {
        return res.status(404).json({ message: 'Member not found in this group' });
      }

      // Update member fields
      if (role) {
        group.members[memberIndex].role = role;
        
        // Handle admin and treasurer roles
        if (role === 'admin' && !group.admins.includes(req.params.memberId)) {
          group.admins.push(req.params.memberId);
        } else if (role !== 'admin' && group.admins.includes(req.params.memberId)) {
          group.admins = group.admins.filter(id => id.toString() !== req.params.memberId);
        }
        
        if (role === 'treasurer') {
          group.treasurer = req.params.memberId;
        } else if (role !== 'treasurer' && group.treasurer && group.treasurer.toString() === req.params.memberId) {
          group.treasurer = null;
        }
      }
      
      if (status) {
        group.members[memberIndex].status = status;
      }

      // Save updated group
      await group.save();

      // Return updated group with populated fields
      const updatedGroup = await Group.findById(group._id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email');

      res.json(updatedGroup);
    } catch (error) {
      console.error('Error updating member:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Remove a member from the group
   * @route DELETE /api/groups/:id/members/:memberId
   * @access Private (admin only)
   */
  async removeMember(req, res) {
    try {
      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is an admin of the group
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      if (!isAdmin && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only group admins can remove members' });
      }

      // Get member ID
      const memberId = req.params.memberId;

      // Check if member exists in the group
      const memberExists = group.members.some(m => m.user.toString() === memberId);
      if (!memberExists) {
        return res.status(404).json({ message: 'Member not found in this group' });
      }

      // Cannot remove the creator of the group
      if (group.createdBy.toString() === memberId) {
        return res.status(400).json({ message: 'Cannot remove the creator of the group' });
      }

      // Remove member from members array
      group.members = group.members.filter(m => m.user.toString() !== memberId);
      
      // Remove from admins if applicable
      if (group.admins.includes(memberId)) {
        group.admins = group.admins.filter(id => id.toString() !== memberId);
      }
      
      // Remove as treasurer if applicable
      if (group.treasurer && group.treasurer.toString() === memberId) {
        group.treasurer = null;
      }

      // Save updated group
      await group.save();

      // Return updated group with populated fields
      const updatedGroup = await Group.findById(group._id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email');

      res.json(updatedGroup);
    } catch (error) {
      console.error('Error removing member:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Leave a group (for self)
   * @route POST /api/groups/:id/leave
   * @access Private
   */
  async leaveGroup(req, res) {
    try {
      const userId = req.user.id;
      const group = await Group.findById(req.params.id);
      
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is a member of the group
      const memberIndex = group.members.findIndex(m => m.user.toString() === userId);
      if (memberIndex === -1) {
        return res.status(400).json({ message: 'You are not a member of this group' });
      }

      // Cannot leave if you're the creator
      if (group.createdBy.toString() === userId) {
        return res.status(400).json({ 
          message: 'As the creator, you cannot leave the group. You must transfer ownership or delete the group.' 
        });
      }

      // Remove from members array
      group.members = group.members.filter(m => m.user.toString() !== userId);
      
      // Remove from admins if applicable
      if (group.admins.includes(userId)) {
        group.admins = group.admins.filter(id => id.toString() !== userId);
      }
      
      // Remove as treasurer if applicable
      if (group.treasurer && group.treasurer.toString() === userId) {
        group.treasurer = null;
      }

      // Save updated group
      await group.save();

      res.json({ message: 'Successfully left the group' });
    } catch (error) {
      console.error('Error leaving group:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid group ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Delete a group
   * @route DELETE /api/groups/:id
   * @access Private (creator only)
   */
  async deleteGroup(req, res) {
    try {
      const group = await Group.findById(req.params.id);
      
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Only the creator can delete the group
      if (group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only the creator can delete the group' });
      }

      await Group.findByIdAndDelete(req.params.id);
      res.json({ message: 'Group deleted successfully' });
    } catch (error) {
      console.error('Error deleting group:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid group ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Update group account balances
   * @route PUT /api/groups/:id/accounts
   * @access Private (admin or treasurer only)
   */
  async updateAccounts(req, res) {
    try {
      const { loanAccount, savingsAccount, interestEarnedAccount, finesAccount } = req.body;
      
      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user is authorized (admin or treasurer)
      const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
      const isTreasurer = group.treasurer && group.treasurer.toString() === req.user.id;
      
      if (!isAdmin && !isTreasurer && group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ 
          message: 'Access denied. Only group admins or treasurer can update account balances' 
        });
      }

      // Update account balances if provided
      if (loanAccount) {
        if (loanAccount.balance !== undefined) {
          group.loanAccount.balance = loanAccount.balance;
        }
        if (loanAccount.currency) {
          group.loanAccount.currency = loanAccount.currency;
        }
      }

      if (savingsAccount) {
        if (savingsAccount.balance !== undefined) {
          group.savingsAccount.balance = savingsAccount.balance;
        }
        if (savingsAccount.currency) {
          group.savingsAccount.currency = savingsAccount.currency;
        }
      }

      if (interestEarnedAccount) {
        if (interestEarnedAccount.balance !== undefined) {
          group.interestEarnedAccount.balance = interestEarnedAccount.balance;
        }
        if (interestEarnedAccount.currency) {
          group.interestEarnedAccount.currency = interestEarnedAccount.currency;
        }
      }

      if (finesAccount) {
        if (finesAccount.balance !== undefined) {
          group.finesAccount.balance = finesAccount.balance;
        }
        if (finesAccount.currency) {
          group.finesAccount.currency = finesAccount.currency;
        }
      }

      // Save updated group
      await group.save();

      res.json({
        loanAccount: group.loanAccount,
        savingsAccount: group.savingsAccount,
        interestEarnedAccount: group.interestEarnedAccount,
        finesAccount: group.finesAccount
      });
    } catch (error) {
      console.error('Error updating accounts:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid group ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Transfer group ownership
   * @route PUT /api/groups/:id/transfer-ownership
   * @access Private (creator only)
   */
  async transferOwnership(req, res) {
    try {
      const { newOwnerId } = req.body;
      if (!newOwnerId) {
        return res.status(400).json({ message: 'Please provide a new owner ID' });
      }

      const group = await Group.findById(req.params.id);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Only the creator can transfer ownership
      if (group.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied. Only the creator can transfer ownership' });
      }

      // Check if new owner is a member of the group
      const isMember = group.members.some(m => 
        m.user.toString() === newOwnerId && m.status === 'active'
      );
      
      if (!isMember) {
        return res.status(400).json({ message: 'New owner must be an active member of the group' });
      }

      // Find the new owner's member entry
      const newOwnerMemberIndex = group.members.findIndex(m => m.user.toString() === newOwnerId);
      const oldOwnerMemberIndex = group.members.findIndex(m => m.user.toString() === req.user.id);
      
      // Update the new owner's role to admin if not already
      if (group.members[newOwnerMemberIndex].role !== 'admin') {
        group.members[newOwnerMemberIndex].role = 'admin';
      }

      // Demote the old owner to a member
      if (group.members[oldOwnerMemberIndex].role === 'admin') {
        group.members[oldOwnerMemberIndex].role = 'member';
      }

      // Add new owner to admins if not already there
      if (!group.admins.includes(newOwnerId)) {
        group.admins.push(newOwnerId);
      }

      // Change the creator
      group.createdBy = newOwnerId;

      // Save updated group
      await group.save();

      // Return updated group with populated fields
      const updatedGroup = await Group.findById(group._id)
        .populate('createdBy', 'name email')
        .populate('admins', 'name email')
        .populate('treasurer', 'name email')
        .populate('members.user', 'name email');

      res.json(updatedGroup);
    } catch (error) {
      console.error('Error transferring ownership:', error);
      if (error.kind === 'ObjectId') {
        return res.status(404).json({ message: 'Invalid ID' });
      }
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
}

module.exports = new GroupController();