// models/User.js - COMPLETE FIXED VERSION with sequelize import
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database'); // ADD THIS LINE

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 50]
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [6, 255]
    }
  },
  walletBalance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    validate: {
      min: 0
    }
  },
  bubblesCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  lat: {
    type: DataTypes.DECIMAL(10, 8),
    defaultValue: 0.0
  },
  lng: {
    type: DataTypes.DECIMAL(11, 8),
    defaultValue: 0.0
  },

  // LOCATION FIELDS
  country: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: 'Pakistan',
    comment: 'User country'
  },
  province: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'User province/state'
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'User city'
  },
  area: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'User specific area/neighborhood'
  },

  // GOAL-BASED SYSTEM FIELDS
  bubbleGoal: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    },
    comment: 'Target number of bubbles user wants to receive'
  },
  bubblesReceived: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    },
    comment: 'Number of bubbles received towards goal'
  },
  goalDescription: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Description of what the goal is for'
  },
  goalActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether user has an active bubble goal'
  },

  // QUEUE SYSTEM FIELDS
  queuePosition: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Position in support queue'
  },
  queueBubbles: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Bubbles received in current queue slot'
  },
  requiredBubbles: {
    type: DataTypes.INTEGER,
    defaultValue: 400,
    comment: 'Bubbles needed to complete one queue slot'
  },

  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  role: {
    type: DataTypes.STRING,
    defaultValue: 'user',
    validate: {
      isIn: [['user', 'admin']]
    }
  },
  queueSlots: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of queue slots this user has (each slot needs 400 bubbles)'
  },
  slotProgress: {
    type: DataTypes.JSON,
    defaultValue: {},
    comment: 'Object tracking progress per slot: { "1": 300, "2": 100, "3": 200 }'
  },
}, {
  timestamps: true,
  tableName: 'users',
  indexes: [
    {
      fields: ['email']
    },
    {
      fields: ['country', 'province', 'city', 'area']
    },
    {
      fields: ['queuePosition']
    },
    {
      fields: ['goalActive']
    },
    {
      fields: ['lat', 'lng']
    }
  ]
});



module.exports = User;