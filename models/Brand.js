// models/Brand.js - Updated with all required fields
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Brand = sequelize.define('Brand', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Food & Beverages'
  },
  logo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  rating: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  distance: {
    type: DataTypes.STRING,
    allowNull: true
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lat: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  lng: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  featured: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  timestamps: true,
  tableName: 'brands'
});

module.exports = Brand;