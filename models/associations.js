// models/associations.js - Define relationships between models
const Brand = require('./Brand');
const Offer = require('./Offer');
const OfferRequest = require('./OfferRequest');
const User = require('./User');

// Brand has many Offers
Brand.hasMany(Offer, {
  foreignKey: 'brandId',
  as: 'offers'
});

Offer.belongsTo(Brand, {
  foreignKey: 'brandId',
  as: 'Brand'
});

// OfferRequest relationships
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

User.hasMany(OfferRequest, {
  foreignKey: 'userId'
});

Brand.hasMany(OfferRequest, {
  foreignKey: 'brandId'
});

Offer.hasMany(OfferRequest, {
  foreignKey: 'offerId'
});

module.exports = {
  Brand,
  Offer,
  OfferRequest,
  User
};