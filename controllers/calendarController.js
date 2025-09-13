// controllers/calendarController.js
const Event = require('../models/Event');
const Group = require('../models/Group');
const Loan = require('../models/Loan');
const User = require('../models/User');
const cron = require('node-cron');
const { sendEmail, sendPushNotification } = require('./messagingController');
const Logger = require('../middleware/Logger');

// Fine rules configuration (can be moved to a config file or database)
const FINE_RULES = {
  contribution: {
    baseAmount: 50, // Base fine in KES
    dailyRate: 10   // Additional fine per day late
  },
  loanPayment: {
    baseAmount: 100,
    percentageOfAmount: 5 // 5% of the payment amount
  },
  meeting: {
    baseAmount: 20
  },
  default: {
    baseAmount: 25
  }
};

// Generate all upcoming events for a user
const generateUserEvents = async (userId) => {
  try {
    // Clear existing pending events that are more than 30 days old
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    await Event.deleteMany({ 
      user: userId, 
      status: 'pending',
      dueDate: { $lt: thirtyDaysAgo }
    });
    
    // Get user's groups and loans
    const groups = await Group.find({ 
      'members.user': userId,
      'members.status': 'active'
    });
    
    const loans = await Loan.find({ 
      user: userId,
      status: { $in: ['active', 'disbursed'] }
    });
    
    // Generate events for the next 1 week
    const endDate = new Date();
    endDate.setMonth(endDate.getDate() - 7);
    
    // Generate group events
    for (const group of groups) {
      // Contribution due dates
      if (group.settings?.contributionSchedule) {
        const { frequency, amount, dueDay } = group.settings.contributionSchedule;
        const contributionEvents = generateRecurringEvents(
          'contribution',
          `Contribution Due - ${group.name}`,
          `Amount: ${amount} ${group.savingsAccount?.currency || 'KES'}`,
          frequency,
          dueDay,
          endDate,
          { group: group._id, user: userId }
        );
        
        // Check if events already exist to avoid duplicates
        for (const eventData of contributionEvents) {
          const existingEvent = await Event.findOne({
            user: userId,
            type: 'contribution',
            group: group._id,
            dueDate: eventData.dueDate,
            status: 'pending'
          });
          
          if (!existingEvent) {
            await Event.create(eventData);
          }
        }
      }
      
      // Group meetings
      if (group.settings?.meetingSchedule) {
        const { frequency, dayOfMonth, time } = group.settings.meetingSchedule;
        const meetingEvents = generateRecurringEvents(
          'meeting',
          `Meeting - ${group.name}`,
          `Group meeting scheduled`,
          frequency,
          dayOfMonth,
          endDate,
          { group: group._id, user: userId },
          time
        );
        
        for (const eventData of meetingEvents) {
          const existingEvent = await Event.findOne({
            user: userId,
            type: 'meeting',
            group: group._id,
            dueDate: eventData.dueDate,
            status: 'pending'
          });
          
          if (!existingEvent) {
            await Event.create(eventData);
          }
        }
      }
    }
    
    // Generate loan payment events
    for (const loan of loans) {
      if (loan.repaymentSchedule && loan.repaymentSchedule.length > 0) {
        for (const payment of loan.repaymentSchedule) {
          if (!payment.paid && new Date(payment.dueDate) > new Date()) {
            const existingEvent = await Event.findOne({
              user: userId,
              type: 'loan_payment',
              loan: loan._id,
              dueDate: payment.dueDate,
              status: 'pending'
            });
            
            if (!existingEvent) {
              await Event.create({
                user: userId,
                type: 'loan_payment',
                title: `Loan Payment Due`,
                description: `Amount: ${payment.totalAmount} ${loan.currency || 'KES'}`,
                dueDate: payment.dueDate,
                loan: loan._id,
                status: 'pending'
              });
            }
          }
        }
      }
    }
    
    console.log(`Generated events for user ${userId}`);
  } catch (error) {
    console.error(`Error generating events for user ${userId}:`, error);
  }
};

// Helper function to generate recurring events
const generateRecurringEvents = (type, title, description, frequency, dueDay, endDate, metadata, time = null) => {
  const events = [];
  let currentDate = new Date();
  
  while (currentDate <= endDate) {
    const eventDate = calculateNextDueDate(frequency, dueDay, currentDate, time);
    
    if (eventDate <= endDate) {
      events.push({
        ...metadata,
        type,
        title,
        description,
        dueDate: eventDate,
        status: 'pending',
        isRecurring: true
      });
    }
    
    // Move to next period
    if (frequency === 'monthly') {
      currentDate.setMonth(currentDate.getMonth() + 1);
    } else if (frequency === 'weekly') {
      currentDate.setDate(currentDate.getDate() + 7);
    } else {
      break; // Unknown frequency
    }
  }
  
  return events;
};

// Improved helper functions
const calculateNextDueDate = (frequency, dueDay, fromDate = new Date(), time = null) => {
  const nextDate = new Date(fromDate);
  
  if (frequency === 'monthly') {
    nextDate.setDate(dueDay);
    if (nextDate <= fromDate) {
      nextDate.setMonth(nextDate.getMonth() + 1);
      nextDate.setDate(dueDay);
    }
  } else if (frequency === 'weekly') {
    // For weekly, dueDay would be day of week (0-6)
    const dayDiff = dueDay - nextDate.getDay();
    nextDate.setDate(nextDate.getDate() + (dayDiff >= 0 ? dayDiff : dayDiff + 7));
  }
  
  // Set specific time if provided
  if (time) {
    const [hours, minutes] = time.split(':').map(Number);
    nextDate.setHours(hours, minutes, 0, 0);
  } else {
    nextDate.setHours(23, 59, 59, 999); // End of day for due dates
  }
  
  return nextDate;
};

// Process fines for overdue events
const processFines = async () => {
  try {
    const now = new Date();
    
    // Find overdue events that don't have fines applied yet
    const overdueEvents = await Event.find({
      status: 'pending',
      dueDate: { $lt: now },
      'fine.amount': { $exists: false }
    }).populate('user group');
    
    console.log(`Processing ${overdueEvents.length} overdue events for fines`);
    
    for (const event of overdueEvents) {
      // Check if user's group has custom fine rules
      let fineRules = FINE_RULES;
      if (event.group?.settings?.fineRules) {
        fineRules = { ...FINE_RULES, ...event.group.settings.fineRules };
      }
      
      event.applyFine(fineRules);
      await event.save();
      
      // Send fine notification
      if (event.fine.amount > 0) {
        await sendFineNotification(event);
      }
    }
  } catch (error) {
    console.error('Error processing fines:', error);
  }
};

// Send fine notification
const sendFineNotification = async (event) => {
  try {
    const user = await User.findById(event.user);
    if (!user) return;
    
    const message = {
      title: 'Fine Applied',
      body: `A fine of ${event.fine.amount} ${event.fine.currency} has been applied. Reason: ${event.fine.reason}`
    };
    
    if (user.notificationPreferences?.email) {
      await sendEmail(user.email, message.title, message.body);
    }
    
    if (user.notificationPreferences?.push) {
      await sendPushNotification(user._id, message);
    }
  } catch (error) {
    console.error('Error sending fine notification:', error);
  }
};

// Send notifications for upcoming events
const sendNotifications = async () => {
  try {
    const now = new Date();
    const upcomingWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next 24 hours
    
    const upcomingEvents = await Event.find({
      dueDate: { $lte: upcomingWindow, $gte: now },
      notificationSent: false,
      status: 'pending'
    }).populate('user group loan');
    
    console.log(`Sending notifications for ${upcomingEvents.length} upcoming events`);
    
    for (const event of upcomingEvents) {
      const user = await User.findById(event.user);
      if (!user) continue;
      
      const message = createNotificationMessage(event);
      
      // Send notifications based on user preferences
      if (user.notificationPreferences?.email) {
        await sendEmail(user.email, message.title, message.body);
      }
      
      if (user.notificationPreferences?.push) {
        await sendPushNotification(user._id, message);
      }
      
      event.notificationSent = true;
      await event.save();
    }
  } catch (error) {
    console.error('Error sending notifications:', error);
  }
};

const createNotificationMessage = (event) => {
  switch(event.type) {
    case 'contribution':
      return {
        title: `Contribution Due for ${event.group?.name || 'Your Group'}`,
        body: `Your contribution of ${event.description} is due soon`
      };
    case 'loan_payment':
      return {
        title: `Loan Payment Due`,
        body: `Payment of ${event.description} is due soon`
      };
    case 'meeting':
      return {
        title: `Upcoming Meeting - ${event.group?.name || 'Your Group'}`,
        body: `Group meeting scheduled for ${event.dueDate.toLocaleString()}`
      };
    default:
      return { title: 'Reminder', body: 'You have an upcoming event' };
  }
};

// Set up scheduled jobs
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily event generation and fine processing...');
  
  // Refresh events for all active users daily at midnight
  const users = await User.find({ isActive: true });
  for (const user of users) {
    await generateUserEvents(user._id);
  }
  
  // Process fines for overdue events
  await processFines();
});

cron.schedule('0 * * * *', async () => {
  // Check for notifications to send every hour
  await sendNotifications();
});

// Controller methods for routes
const getUserEvents = async (req, res) => {
  Logger.info('Fetching user events', { userId: req.user._id });
  try {
    const { start, end } = req.query;
    const userId = req.user._id;
    
    // Generate events for this user if they don't have any recent events
    const recentEvents = await Event.countDocuments({
      user: userId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    });
    
    if (recentEvents === 0) {
      console.log(`No recent events found for user ${userId}, generating...`);
      await generateUserEvents(userId);
    }
    
    // Build query
    let query = { user: userId };
    
    if (start && end) {
      query.dueDate = { 
        $gte: new Date(start), 
        $lte: new Date(end) 
      };
    } else {
      // Default to next 3 months if no date range specified
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
      query.dueDate = { $lte: threeMonthsFromNow };
    }
    
    const events = await Event.find(query)
      .populate('group', 'name settings')
      .populate('loan', 'principalAmount currency')
      .sort({ dueDate: 1 });
    
    res.json({
      success: true,
      count: events.length,
      events
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching events',
      error: error.message 
    });
  }
};

const markEventComplete = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body; // Optional: amount paid/contributed
    
    const event = await Event.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { 
        status: 'completed',
        completedDate: new Date(),
        ...(amount && { completedAmount: amount })
      },
      { new: true }
    );
    
    if (!event) {
      return res.status(404).json({ 
        success: false,
        message: 'Event not found' 
      });
    }
    
    res.json({
      success: true,
      event
    });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating event',
      error: error.message 
    });
  }
};

// Get user's fines
const getUserFines = async (req, res) => {
  try {
    const fines = await Event.find({
      user: req.user._id,
      'fine.amount': { $gt: 0 }
    }).populate('group', 'name').sort({ 'fine.appliedDate': -1 });
    
    const totalUnpaidFines = fines
      .filter(event => !event.fine.paid && !event.fine.waived)
      .reduce((sum, event) => sum + event.fine.amount, 0);
    
    res.json({
      success: true,
      totalUnpaidFines,
      fines: fines.map(event => ({
        eventId: event._id,
        eventTitle: event.title,
        eventType: event.type,
        groupName: event.group?.name,
        fine: event.fine,
        dueDate: event.dueDate,
        daysLate: event.daysLate
      }))
    });
  } catch (error) {
    console.error('Error fetching fines:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching fines',
      error: error.message 
    });
  }
};

// Waive a fine (admin only)
const waiveFine = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Check if user has admin privileges (implement your own logic)
    // if (!req.user.isAdmin) {
    //   return res.status(403).json({ message: 'Not authorized' });
    // }
    
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ 
        success: false,
        message: 'Event not found' 
      });
    }
    
    event.waiveFine(req.user._id, reason);
    await event.save();
    
    res.json({
      success: true,
      message: 'Fine waived successfully',
      event
    });
  } catch (error) {
    console.error('Error waiving fine:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error waiving fine',
      error: error.message 
    });
  }
};

module.exports = {
  getUserEvents,
  markEventComplete,
  generateUserEvents,
  sendNotifications,
  processFines,
  getUserFines,
  waiveFine
};