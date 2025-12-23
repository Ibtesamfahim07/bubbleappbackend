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

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0 && process.env.NODE_ENV !== 'production') {
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

// Root endpoint
app.get('/', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.json({ 
    message: 'API is running',
    environment: isProduction ? 'production' : 'development',
    platform: process.env.VERCEL ? 'vercel' : 'local',
    endpoints: {
      auth: '/auth (signup, login)',
      wallet: '/wallet',
      get: '/get (nearby)',
      make: '/make (request)',
      back: '/back (return)',
      admin: '/admin'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    platform: process.env.VERCEL ? 'vercel' : 'local'
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// Helper function for local network info
function getNetworkInfo() {
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

// Database initialization
let dbInitialized = false;
const initializeDatabase = async () => {
  if (!dbInitialized) {
    try {
      await sequelize.authenticate();
      console.log('✅ Database connection established');
      
      // await sequelize.sync({ force: false, alter: false });
      console.log('✅ Database synchronized');
      
      dbInitialized = true;
    } catch (err) {
      console.error('❌ Database error:', err);
      throw err;
    }
  }
};

// VERCEL: Export app for serverless
if (process.env.VERCEL) {
  // Initialize database on each request (Vercel serverless)
  app.use(async (req, res, next) => {
    try {
      await initializeDatabase();
      next();
    } catch (err) {
      res.status(500).json({ message: 'Database connection failed' });
    }
  });
  
  module.exports = app;
} 
// LOCAL: Start server on 0.0.0.0
else {
  const PORT = process.env.PORT || 3000;
  const HOST = '0.0.0.0'; // Critical for USB debugging
  
  initializeDatabase()
    .then(() => {
      app.listen(PORT, HOST, () => {
        const interfaces = getNetworkInfo();
        
        console.log('\n🚀 Server running on:');
        console.log(`   Local:    http://localhost:${PORT}`);
        
        if (interfaces.length > 0) {
          console.log(`   Network:  http://${interfaces[0].address}:${PORT}`);
          interfaces.forEach((iface, index) => {
            if (index > 0) {
              console.log(`             http://${iface.address}:${PORT}`);
            }
          });
        }
        
        console.log('\n📱 For USB Debugging (React Native):');
        console.log(`   1. Connect device via USB`);
        console.log(`   2. Run: adb reverse tcp:${PORT} tcp:${PORT}`);
        console.log(`   3. Use in app: http://localhost:${PORT}`);
        
        console.log('\n📋 Available endpoints:');
        console.log(`   GET  ${interfaces[0]?.address ? `http://${interfaces[0].address}:${PORT}` : `http://localhost:${PORT}`}/health`);
        console.log('   POST /auth/signup');
        console.log('   POST /auth/login');
        console.log('   GET  /get/nearby');
        
        console.log('\n✨ Ready for development!\n');
      });
    })
    .catch(err => {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    });
}