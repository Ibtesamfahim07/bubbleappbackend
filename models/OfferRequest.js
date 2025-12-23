// models/OfferRequest.js - FIXED VERSION
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OfferRequest = sequelize.define('OfferRequest', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users', // ✅ FIXED: lowercase
      key: 'id'
    }
  },
  brandId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'brands', // ✅ FIXED: lowercase
      key: 'id'
    }
  },
  offerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'offers', // ✅ FIXED: lowercase
      key: 'id'
    }
  },
  scheduledDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  scheduledTime: {
    type: DataTypes.TIME,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'completed', 'cancelled'),
    defaultValue: 'pending'
  },
  redeemed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  adminNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'offerrequests' // ✅ FIXED: Changed from 'offerRequests' to 'offerrequests'
});

module.exports = OfferRequest;