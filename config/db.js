require('dotenv').config();
const mongoose = require('mongoose');

const dbURI = process.env.MONGO_URI || 'mongodb://localhost:27017/money-manager';

mongoose.connect(dbURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch((error) => console.error('MongoDB connection error:', error));

module.exports = mongoose;