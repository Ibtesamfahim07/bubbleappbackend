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
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isIn: [['Medical', 'Grocery', 'Education']]
    }
  },
  totalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  distributed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  }
}, {
  tableName: 'Giveaways',
  timestamps: true
});

module.exports = Giveaway;