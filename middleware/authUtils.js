const jwt = require("jsonwebtoken");
const geoip = require("geoip-lite");
const Logger = require("../middleware/Logger");
const Settings = require('../models/Settings');
const crypto = require("crypto");

const getSettings = async () => {
  const sysSettings = await Settings.findOne();
  return sysSettings;
}

function generateDeviceId(req) {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  return crypto.createHash('sha256').update(userAgent + ip).digest('hex');
}

/**
 * Issue tokens, create session, and sanitize user object
 * @param {Object} user - Mongoose user document
 * @param {Object} req - Express request (for IP/device info)
 * @returns {Object} { accessToken, refreshToken, user: safeUser }
 */
async function issueTokensAndCreateSession(user, req) {
  // Load settings
  const settings = await getSettings();
  let expiry = typeof settings.passwordExpiry === "number"
    ? `${settings.passwordExpiry}d`
    : settings.passwordExpiry;

  let access = typeof settings.sessionTimeout === "number"
    ? `${settings.sessionTimeout}m`
    : settings.sessionTimeout;

  // Tokens
  const refreshToken = jwt.sign(
    { user: { id: user._id } },
    process.env.JWT_SECRET,
    { expiresIn: expiry }
  );

  const accessToken = jwt.sign(
    { user: { id: user._id } },
    process.env.JWT_SECRET,
    { expiresIn: access }
  );

  // Session
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const userAgent = req.headers["user-agent"] || "unknown";
  const geo = geoip.lookup(ip);

  const session = {
    deviceId: generateDeviceId(req),
    ip: ip,
    deviceInfo: userAgent,
    location: geo ? `${geo.city}, ${geo.country}` : "Unknown",
    token: refreshToken,
    createdAt: new Date(),
    lastActive: new Date(),
    isActive: true,
  };

  user.sessions.push(session);

  // Update login metadata
  user.lastLogin = new Date();
  user.lastLoginIP = ip;
  user.lastLoginDevice = userAgent;
  user.lastLoginLocation = session.location;
  user.isOnline = true;
  user.lastActive = new Date();

  await user.save();

  // Clean user
  const safeUser = user.toObject();
  delete safeUser.password;
  delete safeUser.notificationPreferences;

  Logger.info("Session created successfully", { userId: user._id, sessionId: session._id });

  return { accessToken, refreshToken, user: safeUser };
}

module.exports = { issueTokensAndCreateSession };
