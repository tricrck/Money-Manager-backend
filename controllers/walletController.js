const Wallet = require('../models/Wallet');

// Retrieve wallet for a specific user
exports.getWallet = async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ user: req.params.userId }); // Use let instead of const

    // If wallet does not exist, create one
    if (!wallet) {
      wallet = await Wallet.create({
        user: req.params.userId,
        balance: 0,
        transactions: [],
      });
    }
    res.json(wallet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update wallet details
exports.updateWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOneAndUpdate({ user: req.params.userId }, req.body, { new: true });
    res.json(wallet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Deposit funds into the wallet
exports.depositToWallet = async (req, res) => {
  try {
    const { amount, paymentMethod, paymentReference, description } = req.body;
    const wallet = await Wallet.findOne({ user: req.params.userId });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    // Create transaction record
    const transaction = {
      type: 'deposit',
      amount,
      paymentMethod,
      paymentReference,
      description
    };

    // Add transaction and update balance
    wallet.transactions.push(transaction);
    await wallet.updateBalance(amount, 'deposit');

    res.json({ 
      message: 'Deposit successful', 
      balance: wallet.balance,
      transaction
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Withdraw funds from the wallet
exports.withdrawFromWallet = async (req, res) => {
  try {
    const { amount, paymentMethod, paymentReference, description } = req.body;
    const wallet = await Wallet.findOne({ user: req.params.userId });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

    // Create transaction record
    const transaction = {
      type: 'withdrawal',
      amount,
      paymentMethod,
      paymentReference,
      description
    };

    // Add transaction and update balance
    wallet.transactions.push(transaction);
    await wallet.updateBalance(amount, 'withdrawal');

    res.json({ 
      message: 'Withdrawal successful', 
      balance: wallet.balance,
      transaction
    });
  } catch (error) {
    if (error.message === 'Insufficient funds') {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    res.status(500).json({ error: error.message });
  }
};
