const mongoose = require('mongoose');

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
    enum: ['Member', 'Admin', 'Treasurer', 'Secretary'], 
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
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
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

module.exports = mongoose.model('User', UserSchema);