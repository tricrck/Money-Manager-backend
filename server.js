require('dotenv').config();
const express = require('express');
const mongoose = require('./config/db');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes');
const loanRoutes = require('./routes/loanRoutes');
const walletRoutes = require('./routes/walletRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const GroupRoutes = require('./routes/GroupRoutes');
const ReportRoutes = require('./routes/ReportRoutes');
const {stripeWebhook} = require('./controllers/paymentController');
const SettingsRoutes = require('./routes/settingsRoutes');
const calendarRoutes = require('./routes/calendarRoutes')
const Logger = require('./middleware/Logger');
const LogManager = require('./middleware/LogManager');
const LogRoutes = require('./routes/logRoutes');
const session = require("express-session");
const MongoStore = require('connect-mongo');
const passport = require("passport");
const chatRoutes = require('./routes/chatRoutes.js');

const app = express();
// Initialize log manager
const logManager = new LogManager();

// Trust proxy for production environments
app.set('trust proxy', 1);

// Stripe webhook MUST be before any body parsing middleware
app.post(
  "/api/payments/stripe-webhook", 
  express.raw({ type: "application/json" }), 
  stripeWebhook
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware with MongoDB store
app.use(session({
  secret: process.env.SESSION_SECRET || "defaultsecret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    touchAfter: 24 * 3600 // lazy session update
  }),
  name: 'connect.sid',
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// CORS middleware
app.use(cors({
  origin: process.env.URL_ORIGIN,
  credentials: true
}));


// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Routes
const messageRoutes = require('./routes/MessageRoutes')(logManager);
app.use('/api/users', userRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/group', GroupRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', ReportRoutes);
app.use('/api/settings', SettingsRoutes);
app.use('/api/calender', calendarRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/logs', LogRoutes);
app.use('/api/chat', chatRoutes);

// Set logger to use the log manager
Logger.logManager = logManager;

// Initialize log manager
logManager.init().then(() => {
  Logger.info('Logger initialized successfully');
}).catch((error) => {
  Logger.error('Failed to initialize logger', error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));