require('dotenv').config();
const express = require('express');
const mongoose = require('./config/db');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes');
const loanRoutes = require('./routes/loanRoutes');
const walletRoutes = require('./routes/walletRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const GroupRoutes = require('./routes/GroupRoutes');
const {stripeWebhook} = require('./controllers/paymentController');

const app = express();

app.post(
  "/api/payments/stripe-webhook", 
  express.raw({ type: "application/json" }), 
  stripeWebhook
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use('/api/users', userRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/group', GroupRoutes);

app.use('/api/payments', paymentRoutes);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
  });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));