// index.js - FIXED VERSION
require('dotenv').config();
const express = require('express');
const os = require('os');
const sequelize = require('./config/database');
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const getRoutes = require('./routes/get');
const makeRoutes = require('./routes/make');
const backRoutes = require('./routes/back');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(express.json());

// Add CORS middleware for React Native
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/get', getRoutes);
app.use('/make', makeRoutes);
app.use('/back', backRoutes);
app.use('/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        addresses.push({
          name: name,
          address: interface.address
        });
      }
    }
  }
  return addresses;
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
//const MANUAL_IP = '192.168.90.75'; //offc
//const MANUAL_IP = '192.168.100.222'; //ghr
//const MANUAL_IP = '192.168.7.37'; //uni

// CRITICAL FIX: Change force: true to false or remove it entirely
// force: true DELETES ALL DATA every time server starts
// index.js - Update database sync to handle new fields
sequelize.sync({ 
  force: false,  // Don't drop tables
  alter: false    // Update table structure with new fields
}).then(() => {
  console.log('Database synchronized successfully');
  console.log('New location fields added: country, province, city, area');
  
  app.listen(PORT, HOST, () => {
    const interfaces = getNetworkInterfaces();
    const displayIP = MANUAL_IP || (interfaces.length > 0 ? interfaces[0].address : 'localhost');
    
    console.log('\n🚀 Server running on:');
    console.log(`- Local: http://localhost:${PORT}`);
    console.log(`- Network: http://${displayIP}:${PORT}`);
    console.log(`- Health Check: http://${displayIP}:${PORT}/health`);
    
    console.log('\n📋 Available endpoints:');
    console.log('   POST /auth/signup (with location fields)');
    console.log('   POST /auth/login');
    console.log('   GET  /get/nearby?location=Pakistan|Sindh|Karachi|BahriaTown');
  });
}).catch(err => {
  console.error('❌ Error syncing database:', err);
  process.exit(1);
});