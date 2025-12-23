// models/index.js - FIXED VERSION with correct aliases
const User = require('./User');
const WalletTransaction = require('./WalletTransaction');
const BubbleTransaction = require('./BubbleTransaction');
const Brand = require('./Brand');
const Offer = require('./Offer');
const OfferRequest = require('./OfferRequest');
const Giveaway = require('./Giveaway');   // ← NEW

// User and Wallet Associations
User.hasMany(WalletTransaction, { foreignKey: 'userId' });
WalletTransaction.belongsTo(User, { foreignKey: 'userId' });

// User and Bubble Transaction Associations
User.hasMany(BubbleTransaction, { as: 'outgoingBubbles', foreignKey: 'fromUserId' });
User.hasMany(BubbleTransaction, { as: 'incomingBubbles', foreignKey: 'toUserId' });
BubbleTransaction.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
BubbleTransaction.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });

// Brand and Offer Associations - FIXED ALIASES
Brand.hasMany(Offer, { 
  foreignKey: 'brandId',
  as: 'Offers'  // Changed from 'offers' to 'Offers'
});

Offer.belongsTo(Brand, { 
  foreignKey: 'brandId',
  as: 'Brand'
});

// User, Brand, Offer and OfferRequest Associations - FIXED ALIASES
User.hasMany(OfferRequest, { 
  foreignKey: 'userId',
  as: 'OfferRequests'
});

Brand.hasMany(OfferRequest, { 
  foreignKey: 'brandId',
  as: 'OfferRequests'
});

Offer.hasMany(OfferRequest, { 
  foreignKey: 'offerId',
  as: 'OfferRequests'
});

OfferRequest.belongsTo(User, { 
  foreignKey: 'userId',
  as: 'User'
});

OfferRequest.belongsTo(Brand, { 
  foreignKey: 'brandId',
  as: 'Brand'
});

OfferRequest.belongsTo(Offer, { 
  foreignKey: 'offerId',
  as: 'Offer'
});

module.exports = { 
  User, 
  WalletTransaction, 
  BubbleTransaction, 
  Brand, 
  Offer, 
  OfferRequest,
  Giveaway
};