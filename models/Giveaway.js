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
    defaultValue: 0
  },
  totalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  distributed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  distributedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  setByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    },
    onDelete: 'SET NULL'
  }
}, {
  tableName: 'giveaways',  // ← lowercase 'g' to match DB
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