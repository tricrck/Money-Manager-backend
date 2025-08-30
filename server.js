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

const app = express();
// Initialize log manager
const logManager = new LogManager();

app.post(
  "/api/payments/stripe-webhook", 
  express.raw({ type: "application/json" }), 
  stripeWebhook
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use(cors({
  origin: process.env.URL_ORIGIN,
  credentials: true // if you're using cookies/auth headers
}));
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


// Set logger to use the log manager
Logger.logManager = logManager;

// Initialize log manager
logManager.init().then(() => {
  Logger.info('Logger initialized successfully');
}).catch((error) => {
  Logger.error('Failed to initialize logger', error);
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
  });

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));