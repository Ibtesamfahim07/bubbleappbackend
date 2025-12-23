// models/BubbleTransaction.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BubbleTransaction = sequelize.define('BubbleTransaction', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  fromUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  toUserId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  bubbleAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1
    }
  },
  targetSlotNumber: {  // ADD THIS
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Which slot this support was intended for'
  },
  type: {
    type: DataTypes.ENUM('support', 'donation', 'transfer'),
    allowNull: false,
    defaultValue: 'support'
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending'
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  queuePosition: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Queue position of supporter at time of transaction'
  },
  slotsOpened: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of queue slots opened by this support (100 bubbles = 1 slot)'
  }
}, {
  timestamps: true,
  tableName: 'bubble_transactions'
});

module.exports = BubbleTransaction;