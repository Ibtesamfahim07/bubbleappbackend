// models/Giveaway.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Giveaway = sequelize.define('Giveaway', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  category: {
    type: DataTypes.ENUM('Medical', 'Grocery', 'Education'),
    allowNull: false
  },
  amountPerUser: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Amount each eligible user receives per round'
  },
  totalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Total pool available (not actively used)'
  },
  distributed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether this giveaway has been fully distributed'
  },
  distributedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the giveaway was completed'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  setByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    },
    onDelete: 'SET NULL'
  },
  // ========== MISSING FIELDS ADDED ==========
  totalDonated: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Sum of all user donations for this giveaway'
  },
  eligibleUsers: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Number of eligible users at distribution time'
  },
  percentagePerUser: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 25.00,
    comment: 'Percentage of giveback amount user receives'
  },
  holdAmount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Remaining undistributed funds held for future'
  }
  // ===========================================
}, {
  tableName: 'giveaways',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['category', 'distributed'],
      where: { distributed: false }
    }
  ]
});

module.exports = Giveaway;