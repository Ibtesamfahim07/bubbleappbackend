// routes/make.js - FIXED: Price is in Brand table, not Offer table
const express = require('express');
const auth = require('../middleware/auth');
const { Brand, Offer, OfferRequest, User, BubbleTransaction } = require('../models/index');
const { Op, literal } = require('sequelize');
const sequelize = require('../config/database');

const router = express.Router();

// Public endpoint - Get all categories
router.get('/categories', async (req, res) => {
  try {
    const categories = [
      { id: 1, name: 'Food & Beverages', icon: '🍔' },
      { id: 2, name: 'Apparel & Fashion', icon: '👕' },
      { id: 3, name: 'Accessories', icon: '⌚' },
      { id: 4, name: 'Health & Beauty', icon: '🧴' },
      { id: 5, name: 'Salons & Spa', icon: '💇' },
    ];
    res.json(categories);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Public endpoint - Get all brands - FIXED: Removed 'price' from Offer attributes
router.get('/brands', async (req, res) => {
  try {
    const brands = await Brand.findAll({
      include: [{
        model: Offer,
        as: 'Offers',
        attributes: ['id', 'title', 'description', 'discount', 'type'], // Removed 'price'
        limit: 3
      }],
      order: [['featured', 'DESC'], ['rating', 'DESC']]
    });
    res.json(brands);
  } catch (error) {
    console.error('Get brands error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Public endpoint - Get offers by category - FIXED: Price comes from Brand
router.get('/offers/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { filter = 'recommended' } = req.query;
    
    let orderClause;
    if (filter === 'trending') {
      orderClause = [['views', 'DESC']];
    } else if (filter === 'nearby') {
      orderClause = [['distance', 'ASC']];
    } else {
      orderClause = [['featured', 'DESC'], ['rating', 'DESC']];
    }
    
    const offers = await Offer.findAll({
      where: { category },
      include: [{
        model: Brand,
        as: 'Brand',
        attributes: ['id', 'name', 'rating', 'distance', 'featured', 'category', 'price'] // Price is in Brand
      }],
      order: orderClause,
      limit: 20
    });
    
    res.json(offers);
  } catch (error) {
    console.error('Get offers error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Protected endpoint - Send offer request with schedule
router.post('/send-offer', auth, async (req, res) => {
  try {
    const { offerId, brandId, scheduledDate, scheduledTime } = req.body;
    const userId = req.user.id;

    if (!offerId || !brandId || !scheduledDate || !scheduledTime) {
      return res.status(400).json({ message: 'All fields required' });
    }

    const offer = await Offer.findByPk(offerId);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    const brand = await Brand.findByPk(brandId);
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    const offerRequest = await OfferRequest.create({
      userId,
      brandId,
      offerId,
      scheduledDate,
      scheduledTime,
      status: 'pending'
    });

    res.json({
      message: 'Offer sent successfully',
      offerRequest
    });
  } catch (error) {
    console.error('Send offer error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Protected endpoint - Get user's sent offers
router.get('/my-offers', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const offers = await OfferRequest.findAll({
      where: { userId },
      include: [
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'image']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'price'] // Added price
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(offers);
  } catch (error) {
    console.error('Get my offers error:', error);
    res.status(400).json({ message: error.message });
  }
});




// In your routes/make.js file, add this endpoint after the existing '/my-offers' route:

// Protected endpoint - Get user's sent offers with filtering
router.get('/my-offers-filtered', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query; // Accept status as query parameter
    
    let whereClause = { userId };
    
    // If status is provided, filter by status
    if (status === 'pending') {
      whereClause.status = ['pending', 'accepted'];
    } else if (status === 'completed') {
      whereClause.status = 'completed';
    }
    // If no status provided, get all
    
    const offers = await OfferRequest.findAll({
      where: whereClause,
      include: [
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'image']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'price']
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(offers);
  } catch (error) {
    console.error('Get my offers filtered error:', error);
    res.status(400).json({ message: error.message });
  }
});



// ==================== ADMIN ENDPOINTS ====================

router.get('/admin/all-offers', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { status, brandId, startDate, endDate } = req.query;
    
    let whereClause = {};
    if (status) whereClause.status = status;
    if (brandId) whereClause.brandId = brandId;
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    const offers = await OfferRequest.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'description']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'location', 'price']
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(offers);
  } catch (error) {
    console.error('Get all offers error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.put('/admin/offer/:id/status', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['pending', 'accepted', 'rejected', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const offerRequest = await OfferRequest.findByPk(id);
    if (!offerRequest) {
      return res.status(404).json({ message: 'Offer request not found' });
    }

    offerRequest.status = status;
    if (adminNotes) {
      offerRequest.adminNotes = adminNotes;
    }
    await offerRequest.save();

    const updated = await OfferRequest.findByPk(id, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category']
        }
      ]
    });

    res.json({
      message: 'Status updated successfully',
      offerRequest: updated
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/admin/offer-stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const totalRequests = await OfferRequest.count();
    const pendingRequests = await OfferRequest.count({ where: { status: 'pending' } });
    const acceptedRequests = await OfferRequest.count({ where: { status: 'accepted' } });
    const rejectedRequests = await OfferRequest.count({ where: { status: 'rejected' } });
    const completedRequests = await OfferRequest.count({ where: { status: 'completed' } });

    res.json({
      totalRequests,
      pendingRequests,
      acceptedRequests,
      rejectedRequests,
      completedRequests
    });
  } catch (error) {
    console.error('Get offer stats error:', error);
    res.status(400).json({ message: error.message });
  }
});

// ==================== PUBLIC SEARCH ====================

router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ message: 'Search query required' });
    }

    const offers = await Offer.findAll({
      where: {
        [Op.or]: [
          { title: { [Op.like]: `%${query}%` } },
          { description: { [Op.like]: `%${query}%` } }
        ]
      },
      include: [{
        model: Brand,
        as: 'Brand',
        attributes: ['id', 'name', 'category', 'price']
      }],
      limit: 10
    });

    const brands = await Brand.findAll({
      where: {
        name: { [Op.like]: `%${query}%` }
      },
      limit: 5
    });

    res.json({ offers, brands });
  } catch (error) {
    console.error('Search error:', error);
    res.status(400).json({ message: error.message });
  }
});

// ==================== LEGACY ENDPOINTS ====================

router.post('/request', auth, async (req, res) => {
  const { brandId, offerId } = req.body;
  try {
    const brand = await Brand.findByPk(brandId);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });
    const offer = await Offer.findByPk(offerId);
    if (!offer || offer.brandId !== brandId) return res.status(404).json({ message: 'Offer not found' });
    const request = await OfferRequest.create({ 
      userId: req.user.id, 
      brandId, 
      offerId,
      scheduledDate: new Date(),
      scheduledTime: new Date().toTimeString().split(' ')[0]
    });
    res.json({ message: 'Request created', request });
  } catch (error) {
    console.error('Legacy request error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.post('/redeem', auth, async (req, res) => {
  const { requestId } = req.body;
  try {
    const request = await OfferRequest.findByPk(requestId, { 
      include: { model: Offer, as: 'Offer' }
    });
    if (!request || request.userId !== req.user.id) {
      return res.status(404).json({ message: 'Request not found' });
    }
    if (request.status !== 'accepted') {
      return res.status(400).json({ message: 'Request not accepted' });
    }
    if (request.redeemed) {
      return res.status(400).json({ message: 'Already redeemed' });
    }
    
    request.redeemed = true;
    request.status = 'completed';
    await request.save();
    
    res.json({ message: 'Redeemed successfully' });
  } catch (error) {
    console.error('Redeem error:', error);
    res.status(400).json({ message: error.message });
  }
});

// ==================== REDEMPTION ENDPOINTS ====================

router.get('/available-giveaway-bubbles/:category', auth, async (req, res) => {
  try {
    const { category } = req.params;
    const userId = req.user.id;

    console.log(`Getting available giveaway bubbles for user ${userId} in category ${category}`);

    // Map offer category to giveaway category
    const categoryMap = {
      'Food & Beverages': 'Grocery',
      'Health & Beauty': 'Medical',
      'Salons & Spa': 'Medical',
      'Apparel & Fashion': 'Education',
      'Accessories': 'Education'
    };

    const giveawayCategory = categoryMap[category];

    // Map to giveaway description
    const descriptionMap = {
      'Grocery': 'Grocery Giveaway Distribution',
      'Medical': 'Medical Giveaway Distribution',
      'Education': 'Education Giveaway Distribution'
    };

    const giveawayDescription = descriptionMap[giveawayCategory];
    
    if (!giveawayDescription) {
      return res.json({ 
        availableBubbles: 0, 
        category,
        giveawayAllowedOnMake: true 
      });
    }

    // Check if this giveaway category is allowed on Make
    let giveawayAllowedOnMake = true;
    try {
      const [makeSettingResult] = await sequelize.query(`
        SELECT allowOnMake FROM make_settings WHERE category = ?
      `, {
        replacements: [giveawayCategory]
      });

      if (makeSettingResult && makeSettingResult.length > 0) {
        giveawayAllowedOnMake = makeSettingResult[0].allowOnMake === 1 || 
                                makeSettingResult[0].allowOnMake === true;
      }
    } catch (err) {
      console.log('Could not check make settings:', err.message);
    }

    // If not allowed, return 0 available bubbles
    if (!giveawayAllowedOnMake) {
      return res.json({
        category,
        giveawayType: giveawayDescription,
        giveawayCategory,
        totalReceived: 0,
        totalUsed: 0,
        availableBubbles: 0,
        giveawayAllowedOnMake: false,
        message: `${giveawayCategory} giveaway bubbles are currently not allowed on Make`
      });
    }

    const receivedResult = await BubbleTransaction.findAll({
      where: {
        toUserId: userId,
        description: giveawayDescription,
        status: 'completed'
      },
      attributes: [[literal('SUM(bubbleAmount)'), 'totalReceived']],
      raw: true
    });

    const totalReceived = parseInt(receivedResult[0]?.totalReceived || 0);

    const usedResult = await BubbleTransaction.findAll({
      where: {
        fromUserId: userId,
        type: 'offer_redemption',
        description: { [Op.like]: `%${category}%` },
        status: 'completed'
      },
      attributes: [[literal('SUM(bubbleAmount)'), 'totalUsed']],
      raw: true
    });

    const totalUsed = parseInt(usedResult[0]?.totalUsed || 0);
    const availableBubbles = totalReceived - totalUsed;

    console.log(`Category: ${category}, Received: ${totalReceived}, Used: ${totalUsed}, Available: ${availableBubbles}`);

    res.json({
      category,
      giveawayType: giveawayDescription,
      giveawayCategory,
      totalReceived,
      totalUsed,
      availableBubbles: Math.max(0, availableBubbles),
      giveawayAllowedOnMake: true
    });
  } catch (error) {
    console.error('Get available giveaway bubbles error:', error);
    res.status(400).json({ message: error.message });
  }
});

// In /redeem-offer endpoint, modify the bubble calculation logic:

// Add this IMPROVED version of /redeem-offer endpoint to your routes/make.js
// This replaces the existing /redeem-offer endpoint

router.post('/redeem-offer', auth, async (req, res) => {
  const { offerId, brandId, category, price } = req.body;
  const userId = req.user.id;

  console.log('\n🎯 === OFFER REDEMPTION REQUEST ===');
  console.log('User ID:', userId);
  console.log('Offer ID:', offerId);
  console.log('Brand ID:', brandId);
  console.log('Category:', category);
  console.log('Price:', price);
  console.log('Request body:', req.body);

  // Validation
  if (!offerId || !brandId || !category || !price) {
    console.error('❌ Missing required fields:', { offerId, brandId, category, price });
    return res.status(400).json({ 
      success: false,
      message: 'Missing required redemption data',
      details: {
        hasOfferId: !!offerId,
        hasBrandId: !!brandId,
        hasCategory: !!category,
        hasPrice: !!price
      }
    });
  }

  if (price <= 0) {
    return res.status(400).json({ 
      success: false,
      message: 'Price must be positive' 
    });
  }

  const t = await sequelize.transaction();
  
  try {
    // Get user with lock
    const user = await User.findByPk(userId, { 
      transaction: t, 
      lock: t.LOCK.UPDATE 
    });
    
    if (!user) {
      await t.rollback();
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Verify offer and brand exist
    const offer = await Offer.findByPk(offerId, { transaction: t });
    const brand = await Brand.findByPk(brandId, { transaction: t });

    if (!offer || !brand) {
      await t.rollback();
      return res.status(404).json({ 
        success: false,
        message: 'Offer or Brand not found' 
      });
    }

    console.log('✅ Offer and Brand verified');

    // ============ GIVEAWAY BUBBLES CALCULATION ============
    const categoryMap = {
      'Food & Beverages': 'Grocery',
      'Health & Beauty': 'Medical',
      'Salons & Spa': 'Medical',
      'Apparel & Fashion': 'Education',
      'Accessories': 'Education'
    };

    const giveawayCategory = categoryMap[category];
    let giveawayAllowedOnMake = true;
    
    // Check if giveaway is allowed
    if (giveawayCategory) {
      try {
        const [makeSettingResult] = await sequelize.query(`
          SELECT allowOnMake FROM make_settings WHERE category = ?
        `, {
          replacements: [giveawayCategory],
          transaction: t
        });

        if (makeSettingResult && makeSettingResult.length > 0) {
          giveawayAllowedOnMake = makeSettingResult[0].allowOnMake === 1 || 
                                  makeSettingResult[0].allowOnMake === true;
        }
      } catch (settingError) {
        console.log('⚠️ Could not check make settings:', settingError.message);
      }
    }

    let availableGiveawayBubbles = 0;
    
    if (giveawayCategory && giveawayAllowedOnMake) {
      // Get received giveaway bubbles
      const receivedResult = await BubbleTransaction.findAll({
        where: {
          toUserId: userId,
          [Op.or]: [
            { description: `${giveawayCategory} Giveaway Distribution` },
            { description: `${giveawayCategory} Giveaway Reward` },
            { description: { [Op.like]: `%${giveawayCategory} Giveaway%` } }
          ],
          status: 'completed'
        },
        attributes: [[literal('SUM(bubbleAmount)'), 'totalReceived']],
        raw: true,
        transaction: t
      });

      // Get used giveaway bubbles
      const usedResult = await BubbleTransaction.findAll({
        where: {
          fromUserId: userId,
          type: 'offer_redemption',
          description: { [Op.like]: `%${category}%` },
          giveaway: 1,
          status: 'completed'
        },
        attributes: [[literal('SUM(bubbleAmount)'), 'totalUsed']],
        raw: true,
        transaction: t
      });

      const totalReceived = parseInt(receivedResult[0]?.totalReceived || 0);
      const totalUsed = parseInt(usedResult[0]?.totalUsed || 0);
      availableGiveawayBubbles = Math.max(0, totalReceived - totalUsed);
      
      console.log(`💰 Giveaway: ${giveawayCategory}, Received: ${totalReceived}, Used: ${totalUsed}, Available: ${availableGiveawayBubbles}`);
    }

    // ============ SUPPORT BUBBLES CALCULATION ============
    const [supportResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalSupportReceived
      FROM bubble_transactions
      WHERE toUserId = ?
        AND type = 'support'
        AND status = 'completed'
    `, {
      replacements: [userId],
      transaction: t,
      type: sequelize.QueryTypes.SELECT
    });

    const totalSupportReceived = parseInt(supportResult?.totalSupportReceived || 0);

    const [usedSupportResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalSupportUsed
      FROM bubble_transactions
      WHERE fromUserId = ?
        AND type = 'offer_redemption'
        AND giveaway = 0
        AND description LIKE '%Support Bubbles%'
        AND status = 'completed'
    `, {
      replacements: [userId],
      transaction: t,
      type: sequelize.QueryTypes.SELECT
    });

    const totalSupportUsed = parseInt(usedSupportResult?.totalSupportUsed || 0);
    const availableSupportBubbles = Math.max(0, totalSupportReceived - totalSupportUsed);

    console.log(`💰 Support: Received: ${totalSupportReceived}, Used: ${totalSupportUsed}, Available: ${availableSupportBubbles}`);

    // ============ REDEMPTION LOGIC (50% Support Minimum) ============
    const halfPrice = Math.ceil(price / 2);

    // RULE 1: Support must be at least 50%
    if (availableSupportBubbles < halfPrice) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient support bubbles. You need at least 50% (${halfPrice}) support bubbles to redeem this offer.`,
        required: halfPrice,
        available: availableSupportBubbles,
        shortfall: halfPrice - availableSupportBubbles,
        price: price
      });
    }

    // RULE 2: Giveaway covers up to 50%
    let usedGiveawayBubbles = 0;
    if (giveawayAllowedOnMake && availableGiveawayBubbles > 0) {
      usedGiveawayBubbles = Math.min(availableGiveawayBubbles, halfPrice);
    }

    // RULE 3: Support covers 50% + any giveaway shortfall
    const giveawayShortfall = halfPrice - usedGiveawayBubbles;
    const usedSupportBubbles = halfPrice + giveawayShortfall;

    // Final validation
    if (availableSupportBubbles < usedSupportBubbles) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient support bubbles. Need ${usedSupportBubbles}, have ${availableSupportBubbles}.`,
        required: usedSupportBubbles,
        available: availableSupportBubbles,
        shortfall: usedSupportBubbles - availableSupportBubbles
      });
    }

    const totalUsed = usedGiveawayBubbles + usedSupportBubbles;
    console.log(`✅ Redemption: Giveaway=${usedGiveawayBubbles}, Support=${usedSupportBubbles}, Total=${totalUsed}`);

    // ============ CREATE TRANSACTIONS ============
    
    // Record giveaway transaction (if used)
    if (usedGiveawayBubbles > 0) {
      await BubbleTransaction.create({
        fromUserId: userId,
        toUserId: userId,
        bubbleAmount: usedGiveawayBubbles,
        type: 'offer_redemption',
        status: 'completed',
        giveaway: 1,
        description: `${category} Offer Redemption (Giveaway Bubbles) - Offer #${offerId}`
      }, { transaction: t });
      console.log(`✅ Giveaway transaction created: ${usedGiveawayBubbles} bubbles`);
    }

    // Record support transaction
    if (usedSupportBubbles > 0) {
      await BubbleTransaction.create({
        fromUserId: userId,
        toUserId: userId,
        bubbleAmount: usedSupportBubbles,
        type: 'offer_redemption',
        status: 'completed',
        giveaway: 0,
        description: `${category} Offer Redemption (Support Bubbles) - Offer #${offerId}`
      }, { transaction: t });
      console.log(`✅ Support transaction created: ${usedSupportBubbles} bubbles`);
    }

    // Create/Update OfferRequest record
    const existingRequest = await OfferRequest.findOne({
      where: {
        userId,
        offerId,
        brandId,
        status: 'accepted'
      },
      transaction: t
    });

    if (existingRequest) {
      // Update existing request
      existingRequest.status = 'completed';
      existingRequest.redeemed = true;
      existingRequest.adminNotes = `Redeemed: ${usedGiveawayBubbles} giveaway + ${usedSupportBubbles} support = ${totalUsed} bubbles for PKR ${price} offer.`;
      await existingRequest.save({ transaction: t });
      console.log(`✅ Updated existing offer request #${existingRequest.id}`);
    } else {
      // Create new request
      await OfferRequest.create({
        userId,
        brandId,
        offerId,
        scheduledDate: new Date(),
        scheduledTime: new Date().toTimeString().split(' ')[0],
        status: 'completed',
        redeemed: true,
        adminNotes: `Redeemed: ${usedGiveawayBubbles} giveaway + ${usedSupportBubbles} support = ${totalUsed} bubbles for PKR ${price} offer.`
      }, { transaction: t });
      console.log(`✅ Created new offer request`);
    }

    await t.commit();
    console.log('✅ Transaction committed successfully');

    // Calculate percentages
    const giveawayPercentage = Math.round((usedGiveawayBubbles / price) * 100);
    const supportPercentage = Math.round((usedSupportBubbles / price) * 100);

    let responseMessage = `Offer redeemed successfully! Used ${usedGiveawayBubbles} giveaway (${giveawayPercentage}%) + ${usedSupportBubbles} support (${supportPercentage}%) bubbles.`;

    if (!giveawayAllowedOnMake && giveawayCategory) {
      responseMessage += ` (${giveawayCategory} giveaway bubbles blocked by admin)`;
    }

    res.json({
      success: true,
      message: responseMessage,
      redemption: {
        offerId,
        brandId,
        category,
        price,
        usedGiveawayBubbles,
        usedSupportBubbles,
        totalUsed,
        giveawayPercentage,
        supportPercentage,
        giveawayAllowedOnMake,
        availableGiveawayBubblesAfter: availableGiveawayBubbles - usedGiveawayBubbles,
        availableSupportBubblesAfter: availableSupportBubbles - usedSupportBubbles
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('❌ REDEMPTION ERROR:', error);
    console.error('Error stack:', error.stack);
    res.status(400).json({ 
      success: false,
      message: error.message || 'Redemption failed',
      error: error.toString()
    });
  }
});

router.get('/my-redemptions', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const redemptions = await BubbleTransaction.findAll({
      where: {
        fromUserId: userId,
        type: 'offer_redemption',
        status: 'completed'
      },
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    const groupedRedemptions = {};
    
    for (const redemption of redemptions) {
      const match = redemption.description.match(/Offer #(\d+)/);
      const offerKey = match ? match[1] : redemption.id;
      
      if (!groupedRedemptions[offerKey]) {
        groupedRedemptions[offerKey] = {
          offerId: offerKey,
          category: redemption.description.split(' ')[0],
          count: 0,
          totalBubbles: 0,
          giveawayBubbles: 0,
          personalBubbles: 0,
          lastRedeemed: redemption.createdAt
        };
      }
      
      groupedRedemptions[offerKey].count++;
      groupedRedemptions[offerKey].totalBubbles += redemption.bubbleAmount;
      
      if (redemption.giveaway === 1) {
        groupedRedemptions[offerKey].giveawayBubbles += redemption.bubbleAmount;
      } else {
        groupedRedemptions[offerKey].personalBubbles += redemption.bubbleAmount;
      }
    }

    res.json(Object.values(groupedRedemptions));
  } catch (error) {
    console.error('Get redemptions error:', error);
    res.status(400).json({ message: error.message });
  }
});


// ============================================================
// NEW: Get only support bubbles received by logged-in user
// ============================================================
router.get('/my-support-bubbles', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`\n💰 GETTING SUPPORT BUBBLES FOR USER: ${userId}`);
    
    // Query to get ALL support transactions where this user is the receiver
    const supportTransactions = await sequelize.query(`
      SELECT 
        id,
        fromUserId,
        toUserId,
        bubbleAmount,
        type,
        status,
        description,
        targetSlotNumber,
        giveaway,
        createdAt,
        updatedAt
      FROM bubble_transactions
      WHERE toUserId = :userId
        AND type = 'support'
        AND status = 'completed'
      ORDER BY createdAt DESC
      LIMIT 100
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`   Found ${supportTransactions.length} support transactions`);

    // Calculate total support received
    const totalSupportReceived = supportTransactions.reduce((sum, tx) => sum + parseInt(tx.bubbleAmount), 0);
    console.log(`   Total Support Received: ${totalSupportReceived} bubbles`);

    // Get user info to return
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'bubblesCount', 'bubblesReceived']
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Response
    res.json({
      success: true,
      userId: user.id,
      userName: user.name,
      totalBubbles: user.bubblesCount,
      bubblesReceived: user.bubblesReceived,
      totalSupportReceived: totalSupportReceived,
      totalTransactions: supportTransactions.length,
      transactions: supportTransactions.map(tx => ({
        transactionId: tx.id,
        fromUserId: tx.fromUserId,
        bubbleAmount: tx.bubbleAmount,
        type: tx.type,
        status: tx.status,
        description: tx.description,
        targetSlotNumber: tx.targetSlotNumber,
        giveaway: tx.giveaway,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt
      })),
      summary: {
        totalSupportReceived: totalSupportReceived,
        averageSupportPerTransaction: supportTransactions.length > 0 ? 
          Math.round(totalSupportReceived / supportTransactions.length) : 0
      }
    });

  } catch (error) {
    console.error('❌ Get support bubbles error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message || 'Failed to get support bubbles',
      error: error.toString()
    });
  }
});

// Add this endpoint before module.exports

router.get('/support-bubbles-for-redemption', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get total support received
    const [supportReceivedResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalSupportReceived
      FROM bubble_transactions
      WHERE toUserId = ?
        AND type = 'support'
        AND status = 'completed'
    `, {
      replacements: [userId],
      type: sequelize.QueryTypes.SELECT
    });

    const totalSupportReceived = parseInt(supportReceivedResult?.totalSupportReceived || 0);

    // Get support used for offer redemptions
    const [supportUsedResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalSupportUsed
      FROM bubble_transactions
      WHERE fromUserId = ?
        AND type = 'offer_redemption'
        AND giveaway = 0
        AND description LIKE '%Support Bubbles%'
        AND status = 'completed'
    `, {
      replacements: [userId],
      type: sequelize.QueryTypes.SELECT
    });

    const totalSupportUsed = parseInt(supportUsedResult?.totalSupportUsed || 0);
    const availableSupportBubbles = Math.max(0, totalSupportReceived - totalSupportUsed);

    res.json({
      success: true,
      totalSupportReceived,
      totalSupportUsed,
      availableSupportBubbles,
      summary: `You have ${availableSupportBubbles} support bubbles available for redemption.`
    });
  } catch (error) {
    console.error('Get support bubbles for redemption error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message || 'Failed to get support bubbles'
    });
  }
});

// ============================================================
// NEW: Get ALL giveaway bubbles by category (Grocery, Medical, Education)
// ============================================================
router.get('/all-giveaway-bubbles', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`\n💰 Getting ALL giveaway bubbles for user ${userId}`);

    const giveawayCategories = ['Grocery', 'Medical', 'Education'];
    const result = {
      grocery: { received: 0, used: 0, available: 0, allowed: true },
      medical: { received: 0, used: 0, available: 0, allowed: true },
      education: { received: 0, used: 0, available: 0, allowed: true },
      total: { received: 0, used: 0, available: 0 }
    };

    for (const giveawayCategory of giveawayCategories) {
      const categoryKey = giveawayCategory.toLowerCase();

      // Check if allowed on Make
      let allowedOnMake = true;
      try {
        const [makeSettingResult] = await sequelize.query(`
          SELECT allowOnMake FROM make_settings WHERE category = ?
        `, {
          replacements: [giveawayCategory]
        });

        if (makeSettingResult && makeSettingResult.length > 0) {
          allowedOnMake = makeSettingResult[0].allowOnMake === 1 || 
                          makeSettingResult[0].allowOnMake === true;
        }
      } catch (err) {
        console.log(`Could not check make settings for ${giveawayCategory}:`, err.message);
      }

      result[categoryKey].allowed = allowedOnMake;

      // FIX: Get received bubbles with multiple description formats
      const receivedResult = await BubbleTransaction.findAll({
        where: {
          toUserId: userId,
          [Op.or]: [
            { description: `${giveawayCategory} Giveaway Distribution` },
            { description: `${giveawayCategory} Giveaway Reward` },
            { description: { [Op.like]: `%${giveawayCategory} Giveaway%` } }
          ],
          status: 'completed'
        },
        attributes: [[literal('SUM(bubbleAmount)'), 'totalReceived']],
        raw: true
      });

      const totalReceived = parseInt(receivedResult[0]?.totalReceived || 0);
      result[categoryKey].received = totalReceived;

      // Get used bubbles for this category
      const offerCategoriesMap = {
        'Grocery': ['Food & Beverages'],
        'Medical': ['Health & Beauty', 'Salons & Spa'],
        'Education': ['Apparel & Fashion', 'Accessories']
      };

      const offerCategories = offerCategoriesMap[giveawayCategory] || [];
      
      let totalUsed = 0;
      for (const offerCat of offerCategories) {
        const usedResult = await BubbleTransaction.findAll({
          where: {
            fromUserId: userId,
            type: 'offer_redemption',
            description: { [Op.like]: `%${offerCat}%` },
            giveaway: 1,
            status: 'completed'
          },
          attributes: [[literal('SUM(bubbleAmount)'), 'totalUsed']],
          raw: true
        });
        totalUsed += parseInt(usedResult[0]?.totalUsed || 0);
      }

      result[categoryKey].used = totalUsed;
      result[categoryKey].available = Math.max(0, totalReceived - totalUsed);

      // Add to totals
      result.total.received += totalReceived;
      result.total.used += totalUsed;
      result.total.available += result[categoryKey].available;

      console.log(`${giveawayCategory}: Received=${totalReceived}, Used=${totalUsed}, Available=${result[categoryKey].available}, Allowed=${allowedOnMake}`);
    }

    console.log('💰 Giveaway bubbles breakdown:', result);

    res.json({
      success: true,
      userId,
      bubbles: result,
      breakdown: {
        grocery: result.grocery,
        medical: result.medical,
        education: result.education
      },
      totals: result.total
    });
  } catch (error) {
    console.error('Get all giveaway bubbles error:', error);
    res.status(400).json({ message: error.message });
  }
});



// ==================== ADMIN SUPPORT REQUEST ====================
// Request admin to pay for offer - Fixed 500 PKR
router.post('/request-admin-support', auth, async (req, res) => {
  try {
    const { offerId, brandId, category } = req.body;
    const userId = req.user.id;
    const fixedPrice = 500; // Fixed amount for admin support

    console.log('Admin support request:', { userId, offerId, brandId, category });

    if (!offerId || !brandId || !category) {
      return res.status(400).json({ message: 'offerId, brandId, and category are required' });
    }

    // Get offer and brand details
    const offer = await Offer.findByPk(offerId);
    const brand = await Brand.findByPk(brandId);
    const user = await User.findByPk(userId);

    if (!offer || !brand || !user) {
      return res.status(404).json({ message: 'Offer, Brand, or User not found' });
    }

    // Create OfferRequest for admin to review
    const offerRequest = await OfferRequest.create({
      userId,
      brandId,
      offerId,
      scheduledDate: new Date(),
      scheduledTime: new Date().toTimeString().split(' ')[0],
      status: 'pending',
      totalAmount: fixedPrice,
      adminNotes: `Admin Support Request - Fixed amount: PKR ${fixedPrice}\nCategory: ${category}\nRequested by: ${user.name} (${user.email})\nOffer: ${offer.title}\nBrand: ${brand.name}`
    });

    console.log(`✅ Admin support request created: #${offerRequest.id} for ${user.name}`);

    res.json({
      success: true,
      message: `Request sent to admin for PKR ${fixedPrice}`,
      request: {
        id: offerRequest.id,
        offerId,
        brandId,
        category,
        amount: fixedPrice,
        status: 'pending',
        createdAt: offerRequest.createdAt
      }
    });

  } catch (error) {
    console.error('Admin support request error:', error);
    res.status(400).json({ message: error.message || 'Failed to send admin support request' });
  }
});





// ============================================================
// NEW: Get pending support bubbles used by logged-in user
// ============================================================
router.get('/pending-support-used', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log(`\n💰 Getting pending support bubbles used for user ${userId}`);
    
    // Get total support received FIRST
    const [supportReceivedResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalSupportReceived
      FROM bubble_transactions
      WHERE toUserId = ?
        AND type = 'support'
        AND status = 'completed'
    `, {
      replacements: [userId],
      type: sequelize.QueryTypes.SELECT
    });
    
    const totalSupportReceived = parseInt(supportReceivedResult?.totalSupportReceived || 0);
    
    // Get COMPLETED support used (from bubble_transactions)
    const [completedSupportResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalCompletedSupport
      FROM bubble_transactions
      WHERE fromUserId = ?
        AND type = 'offer_redemption'
        AND giveaway = 0
        AND status = 'completed'
    `, {
      replacements: [userId],
      type: sequelize.QueryTypes.SELECT
    });
    
    const totalCompletedSupport = parseInt(completedSupportResult?.totalCompletedSupport || 0);
    
    // Get PENDING support from offer requests (not yet in bubble_transactions)
    const pendingRequests = await OfferRequest.findAll({
      where: {
        userId: userId,
        status: {
          [Op.in]: ['pending', 'accepted']
        },
        adminNotes: {
          [Op.ne]: null,
          [Op.ne]: ''
        }
      },
      include: [
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'price']
        }
      ]
    });
    
    console.log(`Found ${pendingRequests.length} pending/accepted requests`);
    
    let totalPendingSupport = 0;
    const requestsWithSupport = [];
    
    // Calculate support bubbles from each pending request
    for (const request of pendingRequests) {
      let supportBubbles = 0;
      
      if (request.adminNotes) {
        // Parse admin notes to extract support amount
        if (request.adminNotes.includes('Admin Support Request - Fixed amount: PKR 500')) {
          supportBubbles = 250;  // 250 support bubbles for 500 PKR
        } else if (request.adminNotes.includes('Admin Support Request - Fixed amount: PKR 300')) {
          supportBubbles = 250;  // 250 support bubbles for 300 PKR
        } else if (request.adminNotes.includes('Redeemed:')) {
          // Extract support amount from format: "Redeemed: 250 giveaway + 250 support = 500 bubbles"
          const supportMatch = request.adminNotes.match(/Redeemed:.*?(\d+)\s*giveaway.*?(\d+)\s*support/);
          if (supportMatch && supportMatch[2]) {
            supportBubbles = parseInt(supportMatch[2]) || 0;
          } else {
            // Try alternative format
            const altMatch = request.adminNotes.match(/support\s*[:=]\s*(\d+)/i);
            if (altMatch && altMatch[1]) {
              supportBubbles = parseInt(altMatch[1]) || 0;
            }
          }
        }
      }
      
      if (supportBubbles > 0) {
        totalPendingSupport += supportBubbles;
        requestsWithSupport.push({
          id: request.id,
          offerId: request.offerId,
          offerTitle: request.Offer?.title,
          brandName: request.Brand?.name,
          brandPrice: request.Brand?.price,
          status: request.status,
          scheduledDate: request.scheduledDate,
          scheduledTime: request.scheduledTime,
          adminNotes: request.adminNotes,
          supportBubbles: supportBubbles,
          createdAt: request.createdAt
        });
      }
    }
    
    // Calculate available support
    const totalSupportUsed = totalCompletedSupport + totalPendingSupport;
    const availableSupport = Math.max(0, totalSupportReceived - totalSupportUsed);
    
    console.log(`💰 Support Summary:`);
    console.log(`   Total Received: ${totalSupportReceived}`);
    console.log(`   Completed Used: ${totalCompletedSupport}`);
    console.log(`   Pending Used: ${totalPendingSupport}`);
    console.log(`   Total Used: ${totalSupportUsed}`);
    console.log(`   Available: ${availableSupport}`);
    
    res.json({
      success: true,
      userId: userId,
      totals: {
        totalSupportReceived: totalSupportReceived,
        completedSupportUsed: totalCompletedSupport,
        pendingSupportUsed: totalPendingSupport,
        totalSupportUsed: totalSupportUsed,
        availableSupport: availableSupport
      },
      pendingRequests: requestsWithSupport,
      summary: {
        activeOffers: requestsWithSupport.length,
        totalPendingSupport: totalPendingSupport
      }
    });
    
  } catch (error) {
    console.error('❌ Get pending support used error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message || 'Failed to get pending support used'
    });
  }
});


// ============================================================
// NEW: Handle offer redemption with support bubble subtraction
// ============================================================
router.post('/complete-offer/:requestId', auth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;
    
    console.log(`\n✅ Completing offer request ${requestId} for user ${userId}`);
    
    // Find the offer request
    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'category']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'price']
        }
      ]
    });
    
    if (!offerRequest) {
      return res.status(404).json({ 
        success: false,
        message: 'Offer request not found' 
      });
    }
    
    // Verify user owns this request
    if (offerRequest.userId !== userId) {
      return res.status(403).json({ 
        success: false,
        message: 'Unauthorized to complete this offer' 
      });
    }
    
    // Only allow completion of accepted offers
    if (offerRequest.status !== 'accepted') {
      return res.status(400).json({ 
        success: false,
        message: `Cannot complete offer with status: ${offerRequest.status}` 
      });
    }
    
    // Calculate support bubbles used from admin notes
    let supportBubblesUsed = 0;
    if (offerRequest.adminNotes) {
      if (offerRequest.adminNotes.includes('Admin Support Request - Fixed amount: PKR 500')) {
        supportBubblesUsed = 250;
      } else if (offerRequest.adminNotes.includes('Admin Support Request - Fixed amount: PKR 300')) {
        supportBubblesUsed = 250;
      } else if (offerRequest.adminNotes.includes('Redeemed:') && offerRequest.adminNotes.includes('support =')) {
        const match = offerRequest.adminNotes.match(/Redeemed:.*?(\d+)\s*giveaway.*?(\d+)\s*support/);
        if (match && match[2]) {
          supportBubblesUsed = parseInt(match[2]) || 0;
        }
      }
    }
    
    // Create bubble transaction to record support used
    if (supportBubblesUsed > 0) {
      await BubbleTransaction.create({
        fromUserId: userId,
        toUserId: userId,  // Self transaction
        bubbleAmount: supportBubblesUsed,
        type: 'offer_redemption',
        status: 'completed',
        giveaway: 0,
        description: `Support bubbles used for offer: ${offerRequest.Offer?.title || 'Unknown Offer'}`
      });
      
      console.log(`✅ Created support transaction: ${supportBubblesUsed} bubbles`);
    }
    
    // Update offer request status to completed
    offerRequest.status = 'completed';
    offerRequest.redeemed = true;
    offerRequest.updatedAt = new Date();
    
    // Add completion note if not present
    if (!offerRequest.adminNotes.includes('Completed on')) {
      offerRequest.adminNotes += `\n\nCompleted on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;
    }
    
    await offerRequest.save();
    
    console.log(`✅ Offer request ${requestId} marked as completed`);
    
    // Get updated totals
    const [supportUsedResult] = await sequelize.query(`
      SELECT SUM(bubbleAmount) as totalSupportUsed
      FROM bubble_transactions
      WHERE fromUserId = ?
        AND type = 'offer_redemption'
        AND giveaway = 0
        AND description LIKE '%Support Bubbles%'
        AND status = 'completed'
    `, {
      replacements: [userId],
      type: sequelize.QueryTypes.SELECT
    });
    
    const totalSupportUsed = parseInt(supportUsedResult?.totalSupportUsed || 0);
    
    res.json({
      success: true,
      message: `Offer completed successfully. Used ${supportBubblesUsed} support bubbles.`,
      data: {
        requestId: offerRequest.id,
        offerTitle: offerRequest.Offer?.title,
        brandName: offerRequest.Brand?.name,
        status: 'completed',
        supportBubblesUsed: supportBubblesUsed,
        totalSupportUsed: totalSupportUsed,
        completedAt: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ Complete offer error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message || 'Failed to complete offer'
    });
  }
});




module.exports = router;