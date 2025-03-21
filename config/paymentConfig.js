module.exports = {
    mpesa: {
      shortCode: process.env.MPESA_SHORTCODE,
      consumerKey: process.env.MPESA_CONSUMER_KEY,
      consumerSecret: process.env.MPESA_CONSUMER_SECRET,
      passKey: process.env.MPESA_PASSKEY,
      callbackURL: process.env.MPESA_CALLBACK_URL
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    }
  };
  