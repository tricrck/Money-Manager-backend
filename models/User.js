const mongoose = require('mongoose');
const crypto = require('crypto');

const SessionSchema = new mongoose.Schema({
  deviceId: { type: String, required: true }, // Unique fingerprint
  ip: String,
  deviceInfo: String, // User agent / browser details
  location: String,   // Geolocation (via IP lookup service)
  token: String,      // JWT refresh token (hashed or encrypted)
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});

const UserSchema = new mongoose.Schema({
  // Basic information
  username: { 
    type: String, 
    unique: true, 
    sparse: true, 
    trim: true 
  },
  name: { 
    type: String, 
    required: true,
    trim: true 
  },
  email: { 
    type: String, 
    unique: true, 
    sparse: true, 
    trim: true,
    lowercase: true
  },
  phoneNumber: { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: function(v) {
        // Validate Kenyan phone numbers (format: 07XXXXXXXX, 01XXXXXXXX, or 254XXXXXXXX)
        return /^(254|0)[17][0-9]{8}$/.test(v);
      },
      message: props => `${props.value} is not a valid Kenyan phone number!`
    }
  },
  password: { 
    type: String, 
    required: true 
  },
  
  // User roles and groups
  role: { 
    type: String, 
    enum: ['Member', 'Admin', 'Treasurer', 'Secretary', 'Chairperson', 'Support'], 
    default: 'Member' 
  },
  groups: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Group' 
  }],
  
  // Profile details
  idNumber: { 
    type: String, 
    sparse: true,
    unique: true 
  }, // National ID number
  county: {
    type: String,
    enum: [
      "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita Taveta",
      "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru", 
      "Tharaka Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua", 
      "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot", 
      "Samburu", "Trans Nzoia", "Uasin Gishu", "Elgeyo Marakwet", "Nandi", 
      "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho", 
      "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya", 
      "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi"
    ],
    default: "Nairobi"
  },
  profilePicture: String,
  
  // Account status
  isVerified: { 
    type: Boolean, 
    default: false 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  
  // Security
  lastLogin: Date,
  lastLoginIP: String,
  lastLoginDevice: String,
  lastLoginLocation: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // Presence
  isOnline: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now },

  // Sessions (multi-device support)
  sessions: [SessionSchema],
  
  // Preferences
  language: { 
    type: String, 
    enum: ['English', 'Kiswahili'], 
    default: 'English' 
  },
  notificationPreferences: {
    sms: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true }
  },
  pushToken: { type: String, default: null },
  otp: {
    code: { type: String },
    expiresAt: { type: Date },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastSentAt: { type: Date }
  }
}, { timestamps: true });


// Format phone number to standard format (254XXXXXXXXX)
UserSchema.methods.getFormattedPhone = function() {
  let phone = this.phoneNumber;
  if (phone.startsWith('0')) {
    phone = '254' + phone.substring(1);
  }
  return phone;
};

UserSchema.pre('save', async function (next) {
  // Only generate username if it's not already set
  if (!this.username) {
    const base = this.name.trim().toLowerCase().replace(/\s+/g, '.');

    let usernameCandidate;
    let userExists = true;

    // Try a few times to get a unique one
    for (let i = 0; i < 5 && userExists; i++) {
      const randomDigits = crypto.randomInt(1000, 9999); // 4 digit random number
      usernameCandidate = `${base}${randomDigits}`;

      // Check for uniqueness
      const existing = await mongoose.models.User.findOne({ username: usernameCandidate });
      userExists = !!existing;
    }

    if (userExists) {
      return next(new Error('Could not generate a unique username'));
    }

    this.username = usernameCandidate;
  }

  next();
});


module.exports = mongoose.model('User', UserSchema);