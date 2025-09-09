const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Logger = require('../middleware/Logger');

// Issue JWT for our system
function issueToken(user) {
  Logger.info(`Issuing JWT for user ${user._id}`);
  return jwt.sign({ user: { id: user._id } }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Generate a temporary phone number for social login users
function generateTempPhoneNumber() {
  const prefixes = ["2547", "2541"]; // valid Kenyan prefixes
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const randomDigits = crypto.randomInt(10000000, 99999999); // 8 random digits
  return `${prefix}${randomDigits}`;
}

// ---------- GOOGLE STRATEGY ----------
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.CLIENT_URL}/api/users/auth/google/callback`
}, async (accessToken, refreshToken, profile, done) => {
  try {
    Logger.info(`Google login attempt: ${profile.displayName} (${profile.emails?.[0]?.value})`);

    let user = await User.findOne({ email: profile.emails[0].value });

    if (!user) {
      Logger.info(`No existing user found for ${profile.emails[0].value}, creating new one...`);
      let tempPhone, phoneExists = true;

      while (phoneExists) {
        tempPhone = generateTempPhoneNumber();
        phoneExists = !!(await User.findOne({ phoneNumber: tempPhone }));
      }

      user = await User.create({
        name: profile.displayName,
        email: profile.emails[0].value,
        phoneNumber: tempPhone,
        password: crypto.randomBytes(16).toString('hex'),
        isVerified: true,
        profilePicture: profile.photos?.[0]?.value || null
      });

      Logger.info(`New Google user created with ID: ${user._id}`);
    } else {
      Logger.info(`Found existing Google user: ${user._id}`);
    }

    const token = issueToken(user);
    return done(null, { ...user.toObject(), token });
  } catch (err) {
    Logger.error(`Google OAuth error: ${err.message}`, { stack: err.stack });
    return done(err, null);
  }
}));

// ---------- FACEBOOK STRATEGY ----------
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: `${process.env.CLIENT_URL}/api/users/auth/facebook/callback`,
  profileFields: ['id', 'displayName', 'emails', 'photos']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value || null;
    Logger.info(`Facebook login attempt: ${profile.displayName} (${email || 'no email'})`);

    let user = email ? await User.findOne({ email }) : null;

    if (!user) {
      Logger.info(`No existing Facebook user found, creating new one...`);
      let tempPhone, phoneExists = true;

      while (phoneExists) {
        tempPhone = generateTempPhoneNumber();
        phoneExists = !!(await User.findOne({ phoneNumber: tempPhone }));
      }

      user = await User.create({
        name: profile.displayName,
        email: email || `${profile.id}@facebook.temp`,
        phoneNumber: tempPhone,
        password: crypto.randomBytes(16).toString('hex'),
        isVerified: true,
        profilePicture: profile.photos?.[0]?.value || null
      });

      Logger.info(`New Facebook user created with ID: ${user._id}`);
    } else {
      Logger.info(`Found existing Facebook user: ${user._id}`);
    }

    const token = issueToken(user);
    return done(null, { ...user.toObject(), token });
  } catch (err) {
    Logger.error(`Facebook OAuth error: ${err.message}`, { stack: err.stack });
    return done(err, null);
  }
}));

// ---------- TWITTER (X) STRATEGY ----------
passport.use(new TwitterStrategy({
  consumerKey: process.env.TWITTER_API_KEY,
  consumerSecret: process.env.TWITTER_API_SECRET,
  callbackURL: `${process.env.CLIENT_URL}/api/users/auth/twitter/callback`,
  includeEmail: true
}, async (token, tokenSecret, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value || null;
    Logger.info(`Twitter login attempt: ${profile.displayName} (${email || 'no email'})`);

    let user = email ? await User.findOne({ email }) : null;

    if (!user) {
      Logger.info(`No existing Twitter user found, creating new one...`);
      let tempPhone, phoneExists = true;

      while (phoneExists) {
        tempPhone = generateTempPhoneNumber();
        phoneExists = !!(await User.findOne({ phoneNumber: tempPhone }));
      }

      user = await User.findOneAndUpdate(
        { email: email || `${profile.username}@twitter.temp` },
        {
          $setOnInsert: {
            name: profile.displayName,
            phoneNumber: tempPhone,
            password: crypto.randomBytes(16).toString('hex'),
            isVerified: true,
            profilePicture: profile.photos?.[0]?.value || null
          }
        },
        { new: true, upsert: true }
      );


      Logger.info(`New Twitter user created with ID: ${user._id}`);
    } else {
      Logger.info(`Found existing Twitter user: ${user._id}`);
    }

    const jwtToken = issueToken(user);
    return done(null, { ...user.toObject(), token: jwtToken });
  } catch (err) {
    Logger.error(`Twitter OAuth error: ${err.message}`, { stack: err.stack });
    return done(err, null);
  }
}));