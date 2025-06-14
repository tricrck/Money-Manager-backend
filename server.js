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

const app = express();

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

app.use('/api/users', userRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/group', GroupRoutes);

app.use('/api/payments', paymentRoutes);
app.use('/api/reports', ReportRoutes);
app.use('/api/settings', SettingsRoutes);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
  });

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));