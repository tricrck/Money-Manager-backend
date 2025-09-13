const Group = require('../models/Group');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const { sendEmail, sendPushNotification } = require('./messagingController');
const bcrypt = require('bcryptjs');
const Logger = require('../middleware/Logger');
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
      Logger.info('Creating new group', { userId: req.user.id });
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        Logger.warn(`Group creation validation failed - User: ${req.user.id}`, { 
          errors: errors.array(),
          userId: req.user.id 
        });
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        name,
        groupType,
        description,
        admins,
        treasurer,
        settings,
        privacy,
      } = req.body;

      // Check if group with same name already exists
      const existingGroup = await Group.findOne({ name });
      if (existingGroup) {
        Logger.warn(`Group creation failed - Name exists: ${name}`, { 
          name,
          userId: req.user.id 
        });
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

      Logger.debug("Group creation data", { settings, userId: req.user.id });


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

      Logger.info(`Group created successfully - ID: ${group._id}`, { 
        groupId: group._id,
        groupName: name,
        groupType,
        userId: req.user.id 
      });

      res.status(201).json(populatedGroup);
    } catch (error) {
      Logger.error('Error creating group', { 
        error: error.message,
        stack: error.stack,
        userId: req.user.id 
      });
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Get invitation details by token
   * @route GET /api/groups/invitation-details/:token
   * @access Public
   */
  async getInvitationDetails(req, res) {
  try {
    const { token } = req.params;
    Logger.info('Fetching invitation details', { token: token.substring(0, 10) + '...' });
    
    // Verify and decode the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { groupId, invitedEmail } = decoded;
    
    // Get group and invitation details
    const group = await Group.findById(groupId)
      .populate('createdBy', 'name email')
      .select('name groupType description createdBy invitations');
    
    if (!group) {
      Logger.warn('Group not found for invitation', { groupId, invitedEmail });
      return res.status(404).json({ message: 'Group not found' });
    }
    
    // Check if invitations array exists, if not initialize as empty array
    if (!group.invitations || !Array.isArray(group.invitations)) {
      Logger.warn('Group invitations array not found or invalid', { 
        groupId, 
        invitedEmail,
        invitationsExists: !!group.invitations,
        invitationsType: typeof group.invitations
      });
      return res.status(404).json({ message: 'Invalid or expired invitation' });
    }
    
    // Find the invitation
    const invitation = group.invitations.find(inv => 
      inv.invitedEmail?.toLowerCase() === invitedEmail.toLowerCase() && 
      inv.status === 'pending' && 
      inv.isExternal === true
    );
    
    if (!invitation) {
      Logger.warn('Invalid or expired invitation', { 
        groupId, 
        invitedEmail,
        totalInvitations: group.invitations.length,
        pendingExternalInvitations: group.invitations.filter(inv => 
          inv.status === 'pending' && inv.isExternal === true
        ).length,
        invites: group.invitations
      });
      return res.status(404).json({ message: 'Invalid or expired invitation' });
    }
    
    // Check if invitation has expired
    if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
      Logger.warn('Invitation has expired', { 
        groupId, 
        invitedEmail, 
        expiresAt: invitation.expiresAt,
        currentTime: Date.now()
      });
      return res.status(400).json({ message: 'Invitation has expired' });
    }
    
    Logger.info('Invitation details fetched successfully', { 
      groupId,
      invitedEmail,
      role: invitation.role 
    });
    
    res.json({
      group: {
        name: group.name,
        groupType: group.groupType,
        description: group.description
      },
      inviter: group.createdBy,
      role: invitation.role,
      message: invitation.message,
      invitedEmail: invitation.invitedEmail,
      invitedUsername: invitation.invitedUsername,
      expiresAt: invitation.expiresAt
    });
    
  } catch (error) {
    Logger.error('Error fetching invitation details', { 
      error: error.message,
      stack: error.stack,
      token: req.params.token?.substring(0, 10) + '...'
    });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({ message: 'Invalid invitation token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ message: 'Invitation token has expired' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}

   /**
   * Resend invitation
   * @route POST /api/groups/:id/invitations/:invitationId/resend
   * @access Private (admin only)
   */
  async resendInvitation(req, res) {
    try {
      const { id: groupId, invitationId } = req.params;
      const userId = req.user.id;
      
      Logger.info('Resending invitation', { 
        groupId,
        invitationId,
        userId 
      });
      
      const group = await Group.findById(groupId)
        .populate('invitations.invitedBy', 'name email');
      
      if (!group) {
        Logger.warn('Group not found for resend invitation', { groupId, userId });
        return res.status(404).json({ message: 'Group not found' });
      }
      
      // Check authorization
      const isAdmin = group.admins.some(admin => admin.toString() === userId);
      if (!isAdmin && group.createdBy.toString() !== userId) {
        Logger.warn('Unauthorized resend invitation attempt', { 
          groupId,
          userId,
          isAdmin,
          createdBy: group.createdBy.toString() 
        });
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const invitation = group.invitations.id(invitationId);
      if (!invitation) {
        Logger.warn('Invitation not found for resend', { groupId, invitationId, userId });
        return res.status(404).json({ message: 'Invitation not found' });
      }
      
      if (invitation.status !== 'pending') {
        Logger.warn('Cannot resend non-pending invitation', { 
          groupId,
          invitationId,
          status: invitation.status,
          userId 
        });
        return res.status(400).json({ message: 'Can only resend pending invitations' });
      }
      
      // Extend expiration date
      invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await group.save();
      
      // Resend email
      const email = invitation.isExternal ? invitation.invitedEmail : invitation.invitedUser.email;
      await this.sendInvitationEmail(email, group, invitation.invitedBy, invitation, invitation.message);
      
      Logger.info('Invitation resent successfully', { 
        groupId,
        invitationId,
        email,
        userId 
      });
      
      res.json({ message: 'Invitation resent successfully' });
      
    } catch (error) {
      Logger.error('Error resending invitation', { 
        error: error.message,
        stack: error.stack,
        groupId: req.params.id,
        invitationId: req.params.invitationId,
        userId: req.user?.id 
      });
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Cancel invitation
   * @route DELETE /api/groups/:id/invitations/:invitationId
   * @access Private (admin only)
   */
  async cancelInvitation(req, res) {
    try {
      const { id: groupId, invitationId } = req.params;
      const userId = req.user.id;
      
      Logger.info('Cancelling invitation', { 
        groupId,
        invitationId,
        userId 
      });
      
      const group = await Group.findById(groupId);
      if (!group) {
        Logger.warn('Group not found for cancel invitation', { groupId, userId });
        return res.status(404).json({ message: 'Group not found' });
      }
      
      // Check authorization
      const isAdmin = group.admins.some(admin => admin.toString() === userId);
      if (!isAdmin && group.createdBy.toString() !== userId) {
        Logger.warn('Unauthorized cancel invitation attempt', { 
          groupId,
          userId,
          isAdmin,
          createdBy: group.createdBy.toString() 
        });
        return res.status(403).json({ message: 'Access denied' });
      }
      
      const invitation = group.invitations.id(invitationId);
      if (!invitation) {
        Logger.warn('Invitation not found for cancellation', { groupId, invitationId, userId });
        return res.status(404).json({ message: 'Invitation not found' });
      }
      
      // Remove invitation
      group.invitations.pull(invitationId);
      await group.save();
      
      Logger.info('Invitation cancelled successfully', { 
        groupId,
        invitationId,
        userId 
      });
      
      res.json({ message: 'Invitation cancelled successfully' });
      
    } catch (error) {
      Logger.error('Error cancelling invitation', { 
        error: error.message,
        stack: error.stack,
        groupId: req.params.id,
        invitationId: req.params.invitationId,
        userId: req.user?.id 
      });
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
      let userId = req.params?.userId;
      if (!userId || userId === 'undefined') {
        userId = req.user?.id;
      }

      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
      }

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
    const { email, username, role = 'member', message = '' } = req.body;

    const group = await Group.findById(req.params.id);
    if (!group) {
      Logger.warn('Group not found for sending invitation', { groupId: req.params.id, userId: req.user.id });
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if current user is authorized to send invites
    const isAdmin = group.admins.some(admin => admin.toString() === req.user.id);
    if (!isAdmin && group.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. Only group admins can send invitations' });
    }

    // Try to find existing user by email or username
   // Build search criteria safely (avoid calling toLowerCase() on undefined)
    const orClauses = [];
    if (email && typeof email === 'string' && email.trim() !== '') {
      orClauses.push({ email: email.toLowerCase() });
    }
    if (username && typeof username === 'string' && username.trim() !== '') {
       orClauses.push({ username: username.trim() });
    }

    // If for some reason no valid clause, bail out
    if (orClauses.length === 0) {
      Logger.warn('No valid email or username provided for invitation', { userId: req.user.id });
      return res.status(400).json({ message: 'Invalid email or username' });
    }

    // Find invitor details 
    let invitorUser = await User.findById(req.user.id);

    // Try to find existing user by email or username
    let invitedUser = await User.findOne({ $or: orClauses });

    let isExternalUser = false;
    
    // If user doesn't exist, create a placeholder/pending user
    if (!invitedUser) {
      isExternalUser = true;
      
      // Check if there's already a pending external invitation for this email
      const existingExternalInvite = group.invitations.find(inv => 
        inv.invitedEmail?.toLowerCase() === email.toLowerCase() && 
        inv.status === 'pending'
      );
      
      if (existingExternalInvite) {
        return res.status(400).json({ 
          message: 'An invitation has already been sent to this email address' 
        });
      }

      // Create external invitation without user ID
      const invitation = {
        invitedEmail: email.toLowerCase(),
        invitedUsername: username || null,
        invitedBy: req.user.id,
        role,
        message,
        status: 'pending',
        isExternal: true,
        invitedAt: Date.now(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      };

      group.invitations.push(invitation);
      await group.save();

      Logger.info('External invitation created successfully', { 
        groupId: invitation,
      });

      // Send invitation email
      await this.sendInvitationEmail(email, group, invitorUser, invitation, message);

      return res.status(201).json({
        message: 'External invitation sent successfully',
        invitation: {
          ...invitation,
          group: {
            name: group.name,
            description: group.description
          }
        }
      });
    } else {
      // Existing user flow (your current logic)
      try {
        const invitation = await group.sendInvitation(invitedUser._id, req.user.id, role, message);
        
        await group.populate('invitations.invitedUser', 'name email username');
        await group.populate('invitations.invitedBy', 'name email username');
        
        const populatedInvitation = group.invitations.find(inv => 
          inv.invitedUser._id.toString() === invitedUser._id.toString() &&
          inv.invitedBy._id.toString() === req.user.id &&
          inv.status === 'pending'
        );

        // Send notification email to existing user
        await this.sendInvitationEmail(invitedUser.email, group, invitorUser, populatedInvitation, message);

        res.status(201).json({
          message: 'Invitation sent successfully',
          invitation: populatedInvitation
        });
      } catch (inviteError) {
        return res.status(400).json({ message: inviteError.message });
      }
    }
    } catch (error) {
      console.error('Error sending invitation:', error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }

  /**
   * Send invitation email
   */
  async sendInvitationEmail(email, group, inviter, invitation, message) {
    try {
      let emailContent;
      let invitationLink;

      if (invitation.isExternal) {
        // Create invitation token for external users
        const token = jwt.sign(
          { 
            groupId: group._id, 
            invitedEmail: email,
            exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
          },
          process.env.JWT_SECRET
        );

        invitationLink = `${process.env.URL_ORIGIN}/register?token=${token}`;

        // Mapping for display names
        const groupTypeLabels = {
          chama: "Chama",
          sacco: "Sacco",
          table_banking: "Table Banking",
          investment_club: "Investment Club"
        };

        // Usage
        const displayGroupType = groupTypeLabels[group.groupType] || group.groupType;

        emailContent = `
          <h2>You're invited to join ${group.name}!</h2>
          <p>Hi there!</p>
          <p>${inviter.name} has invited you to join the group ${group.name} on our Money Manager platform.</p>
          ${message ? `<p><strong>Personal message:</strong> ${message}</p>` : ''}
          <p><strong>Group Type:</strong> ${displayGroupType}</p>
          <p><strong>Your Role:</strong> ${invitation.role}</p>
          <p>To join this group, you'll need to create an account. Click the link below:</p>
          <a href="${invitationLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Accept Invitation & Create Account</a>
          <p>This invitation expires on ${new Date(invitation.expiresAt).toLocaleDateString()}.</p>
          <p>If you already have an account, please login first and then use this link.</p>
        `;
      } else {
        // Existing user
        invitationLink = `${process.env.URL_ORIGIN}/groups/invitations`;
        
        emailContent = `
          <h2>You're invited to join ${group.name}!</h2>
          <p>Hi ${invitation.invitedUser.name}!</p>
          <p>${inviter.name} has invited you to join the group "${group.name}".</p>
          ${message ? `<p><strong>Personal message:</strong> ${message}</p>` : ''}
          <p><strong>Group Type:</strong> ${group.groupType}</p>
          <p><strong>Your Role:</strong> ${invitation.role}</p>
          <p>Login to your account to accept or decline this invitation:</p>
          <a href="${invitationLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Invitation</a>
          <p>This invitation expires on ${new Date(invitation.expiresAt).toLocaleDateString()}.</p>
        `;
      }

      // ✅ Use your reusable sendEmail function here
      const subject = `Invitation to join ${group.name}`;
      return await sendEmail(email, subject, emailContent, true);

    } catch (error) {
      console.error('Error sending invitation email:', error);
      return { success: false, error };
    }
  }

  /**
   * Handle external user registration via invitation
   * @route POST /api/groups/accept-external-invitation/:token
   * @access Public
   */
  async acceptExternalInvitation(req, res) {
    try {
      const { token } = req.params;
      const { name,
        email,
        phoneNumber,
        password,
        username } = req.body;

      // Decode invitation token (you'll need to implement token generation)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { groupId, invitedEmail } = decoded;

      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Find the external invitation
      const invitation = group.invitations.find(inv => 
        inv.invitedEmail === invitedEmail && 
        inv.status === 'pending' && 
        inv.isExternal === true
      );

      if (!invitation) {
        return res.status(404).json({ message: 'Invalid or expired invitation' });
      }

      // Check if invitation has expired
      if (invitation.expiresAt < Date.now()) {
        invitation.status = 'expired';
        await group.save();
        return res.status(400).json({ message: 'Invitation has expired' });
      }
      // Use the invited email if not provided
      const finalEmail = email || invitation.invitedEmail;

      // Check if user already exists
      const existingUser = await User.findOne({ 
        $or: [
          { email: invitedEmail },
          { username: username },
          { phoneNumber: phoneNumber }
        ]
      });

      if (existingUser) {
        return res.status(400).json({ 
          message: 'User with this email or username already exists. Please login instead.' 
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const user = await User.create({
        name,
        phoneNumber,
        email: finalEmail,
        username: username || invitation.invitedUsername,
        password: hashedPassword
      });

      await user.save();

      // Update invitation with new user ID
      invitation.invitedUser = user._id;
      invitation.status = 'accepted';
      invitation.respondedAt = Date.now();
      invitation.isExternal = false; // No longer external

      // Add user as member to the group
      group.members.push({
        user: user._id,
        role: invitation.role,
        status: 'active',
        joinedDate: Date.now()
      });

      // Add to admins if role is admin
      if (invitation.role === 'admin') {
        group.admins.push(user._id);
      }

      // Set as treasurer if role is treasurer
      if (invitation.role === 'treasurer') {
        group.treasurer = user._id;
      }

      await group.save();

      // Generate auth token for the new user
      const authToken = jwt.sign(
        { user: { id: user._id } },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: 'Successfully joined the group',
        token: authToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username
        },
        group: {
          id: group._id,
          name: group.name,
          role: invitation.role
        }
      });

    } catch (error) {
      console.error('Error accepting external invitation:', error);
      if (error.name === 'JsonWebTokenError') {
        return res.status(400).json({ message: 'Invalid invitation token' });
      }
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
      // if (!isAdmin && !isCreator) {
      //   return res.status(403).json({ message: 'Access denied. Only group admins or creator can view join requests' });
      // }

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
      await group.initializeTypeData();
      if (group.groupType === 'sacco'){
        await group.syncSaccoMembers();
      }
      

      if (!group) {
        return res.status(404).json({ message: 'Group not found' });
      }

      // Check if user has access to view this group
      const userId = req.user.id;
      const isMember = Array.isArray(group.members) && group.members.some(member =>
        member?.user?._id?.toString() === userId
      );

      const isAdmin = Array.isArray(group.admins) && group.admins.some(admin =>
        admin?._id?.toString() === userId
      );

      const isCreator = group.createdBy?._id?.toString() === userId;

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