// routes/admin.js - Admin Management Routes
const express = require('express');
const auth = require('../middleware/auth');
const { User, Brand, Offer, OfferRequest } = require('../models/index');
const { Op } = require('sequelize');

const router = express.Router();

// Middleware to check admin access
const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Apply auth middleware to all routes
router.use(auth);
router.use(adminAuth);

// ==================== USER MANAGEMENT ====================

// Get all users
router.get('/users', async (req, res) => {
  try {
    const { search, role, status } = req.query;
    
    let whereClause = {};
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
    }
    if (role) whereClause.role = role;
    if (status) whereClause.isActive = status === 'active';

    const users = await User.findAll({
      where: whereClause,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });
    
    res.json(users);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get user by ID
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] }
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Toggle user status (active/inactive)
router.put('/users/:id/toggle-status', async (req, res) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByPk(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    user.isActive = isActive;
    await user.save();
    
    res.json({ message: 'User status updated', user });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update user role
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    
    const user = await User.findByPk(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    user.role = role;
    await user.save();
    
    res.json({ message: 'User role updated', user });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    await user.destroy();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ==================== BRAND MANAGEMENT ====================

// Create brand
router.post('/brands', async (req, res) => {
  try {
    const { name, category, location, rating, featured } = req.body;
    
    if (!name || !category) {
      return res.status(400).json({ message: 'Name and category are required' });
    }
    
    const brand = await Brand.create({
      name,
      category,
      location,
      rating: rating || 0,
      featured: featured || false
    });
    
    res.json({ message: 'Brand created successfully', brand });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update brand
router.put('/brands/:id', async (req, res) => {
  try {
    const { name, category, location, rating, featured } = req.body;
    const brand = await Brand.findByPk(req.params.id);
    
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }
    
    if (name) brand.name = name;
    if (category) brand.category = category;
    if (location !== undefined) brand.location = location;
    if (rating !== undefined) brand.rating = rating;
    if (featured !== undefined) brand.featured = featured;
    
    await brand.save();
    res.json({ message: 'Brand updated successfully', brand });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete brand
router.delete('/brands/:id', async (req, res) => {
  try {
    const brand = await Brand.findByPk(req.params.id);
    
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }
    
    await brand.destroy();
    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ==================== OFFER MANAGEMENT ====================

// Create offer
router.post('/offers', async (req, res) => {
  try {
    const {
      brandId,
      title,
      description,
      category,
      discount,
      type,
      image,
      featured
    } = req.body;
    
    if (!brandId || !title || !category || !discount || !type) {
      return res.status(400).json({ message: 'Required fields missing' });
    }
    
    const brand = await Brand.findByPk(brandId);
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }
    
    const offer = await Offer.create({
      brandId,
      title,
      description,
      category,
      discount,
      type,
      image,
      featured: featured || false
    });
    
    res.json({ message: 'Offer created successfully', offer });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update offer
router.put('/offers/:id', async (req, res) => {
  try {
    const offer = await Offer.findByPk(req.params.id);
    
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    
    const {
      title,
      description,
      category,
      discount,
      type,
      image,
      featured,
      status
    } = req.body;
    
    if (title) offer.title = title;
    if (description) offer.description = description;
    if (category) offer.category = category;
    if (discount) offer.discount = discount;
    if (type) offer.type = type;
    if (image) offer.image = image;
    if (featured !== undefined) offer.featured = featured;
    if (status) offer.status = status;
    
    await offer.save();
    res.json({ message: 'Offer updated successfully', offer });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete offer
router.delete('/offers/:id', async (req, res) => {
  try {
    const offer = await Offer.findByPk(req.params.id);
    
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    
    await offer.destroy();
    res.json({ message: 'Offer deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ==================== STATISTICS ====================

// Get dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.count();
    const activeUsers = await User.count({ where: { isActive: true } });
    const totalBrands = await Brand.count();
    const totalOffers = await Offer.count();
    const pendingRequests = await OfferRequest.count({ 
      where: { status: 'pending' } 
    });
    const acceptedRequests = await OfferRequest.count({ 
      where: { status: 'accepted' } 
    });
    
    res.json({
      totalUsers,
      activeUsers,
      totalBrands,
      totalOffers,
      pendingRequests,
      acceptedRequests
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;