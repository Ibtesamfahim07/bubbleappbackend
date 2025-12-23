// models/OfferRequest.js - Updated with schedule fields
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
      model: 'Users',
      key: 'id'
    }
  },
  brandId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Brands',
      key: 'id'
    }
  },
  offerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Offers',
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
  tableName: 'offerRequests'
});

module.exports = OfferRequest;