// routes/auth.js - UPDATED with role field
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models/index');
const auth = require('../middleware/auth');

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      password, 
      lat, 
      lng, 
      country, 
      province, 
      city, 
      area 
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ 
        message: 'Name, email and password are required' 
      });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      lat: lat || 0,
      lng: lng || 0,
      country: country || 'Pakistan',
      province: province || null,
      city: city || null,
      area: area || null,
      role: 'user' // Default role
    });

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        role: user.role // Include role in token
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        walletBalance: user.walletBalance,
        bubblesCount: user.bubblesCount,
        lat: user.lat,
        lng: user.lng,
        country: user.country,
        province: user.province,
        city: user.city,
        area: user.area,
        queuePosition: user.queuePosition,
        role: user.role // Include role in response
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Login - UPDATED to include role
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        message: 'Email and password are required' 
      });
    }

    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ 
        message: 'Account is deactivated. Please contact support.' 
      });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        role: user.role || 'user' // Include role in token
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('Login successful for user:', user.email, 'Role:', user.role);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        walletBalance: user.walletBalance,
        bubblesCount: user.bubblesCount,
        lat: user.lat,
        lng: user.lng,
        country: user.country,
        province: user.province,
        city: user.city,
        area: user.area,
        queuePosition: user.queuePosition,
        queueBubbles: user.queueBubbles,
        requiredBubbles: user.requiredBubbles,
        goalActive: user.goalActive,
        bubbleGoal: user.bubbleGoal,
        bubblesReceived: user.bubblesReceived,
        goalDescription: user.goalDescription,
        role: user.role || 'user', // CRITICAL: Include role
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get Profile - UPDATED to include role
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      walletBalance: user.walletBalance,
      bubblesCount: user.bubblesCount,
      lat: user.lat,
      lng: user.lng,
      country: user.country,
      province: user.province,
      city: user.city,
      area: user.area,
      queuePosition: user.queuePosition,
      queueBubbles: user.queueBubbles,
      requiredBubbles: user.requiredBubbles,
      goalActive: user.goalActive,
      bubbleGoal: user.bubbleGoal,
      bubblesReceived: user.bubblesReceived,
      goalDescription: user.goalDescription,
      role: user.role || 'user', // Include role
      isActive: user.isActive,
      createdAt: user.createdAt
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Add this new endpoint (alias for /profile)
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      walletBalance: user.walletBalance,
      bubblesCount: user.bubblesCount,
      lat: user.lat,
      lng: user.lng,
      country: user.country,
      province: user.province,
      city: user.city,
      area: user.area,
      queuePosition: user.queuePosition,
      queueBubbles: user.queueBubbles,
      requiredBubbles: user.requiredBubbles,
      goalActive: user.goalActive,
      bubbleGoal: user.bubbleGoal,
      bubblesReceived: user.bubblesReceived,
      goalDescription: user.goalDescription,
      role: user.role || 'user',
      isActive: user.isActive,
      createdAt: user.createdAt
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update Profile
router.put('/profile', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const allowedUpdates = [
      'name', 
      'lat', 
      'lng', 
      'country', 
      'province', 
      'city', 
      'area'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        user[field] = req.body[field];
      }
    });

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        lat: user.lat,
        lng: user.lng,
        country: user.country,
        province: user.province,
        city: user.city,
        area: user.area,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;