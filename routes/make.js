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

    const categoryMap = {
      'Food & Beverages': 'Grocery Giveaway Distribution',
      'Health & Beauty': 'Medical Giveaway Distribution',
      'Salons & Spa': 'Medical Giveaway Distribution',
      'Apparel & Fashion': 'Education Giveaway Distribution',
      'Accessories': 'Education Giveaway Distribution'
    };

    const giveawayDescription = categoryMap[category];
    
    if (!giveawayDescription) {
      return res.json({ availableBubbles: 0, category });
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
      totalReceived,
      totalUsed,
      availableBubbles: Math.max(0, availableBubbles)
    });
  } catch (error) {
    console.error('Get available giveaway bubbles error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.post('/redeem-offer', auth, async (req, res) => {
  const { offerId, brandId, category, price } = req.body;
  const userId = req.user.id;

  console.log('Offer redemption request:', { userId, offerId, brandId, category, price });

  if (!offerId || !brandId || !category || !price) {
    return res.status(400).json({ message: 'offerId, brandId, category, and price are required' });
  }

  if (price <= 0) {
    return res.status(400).json({ message: 'Price must be positive' });
  }

  const t = await sequelize.transaction();
  try {
    const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ message: 'User not found' });
    }

    const categoryMap = {
      'Food & Beverages': 'Grocery Giveaway Distribution',
      'Health & Beauty': 'Medical Giveaway Distribution',
      'Salons & Spa': 'Medical Giveaway Distribution',
      'Apparel & Fashion': 'Education Giveaway Distribution',
      'Accessories': 'Education Giveaway Distribution'
    };

    const giveawayDescription = categoryMap[category];

    let availableGiveawayBubbles = 0;
    if (giveawayDescription) {
      const receivedResult = await BubbleTransaction.findAll({
        where: {
          toUserId: userId,
          description: giveawayDescription,
          status: 'completed'
        },
        attributes: [[literal('SUM(bubbleAmount)'), 'totalReceived']],
        raw: true,
        transaction: t
      });

      const usedResult = await BubbleTransaction.findAll({
        where: {
          fromUserId: userId,
          type: 'offer_redemption',
          description: { [Op.like]: `%${category}%` },
          status: 'completed'
        },
        attributes: [[literal('SUM(bubbleAmount)'), 'totalUsed']],
        raw: true,
        transaction: t
      });

      const totalReceived = parseInt(receivedResult[0]?.totalReceived || 0);
      const totalUsed = parseInt(usedResult[0]?.totalUsed || 0);
      availableGiveawayBubbles = Math.max(0, totalReceived - totalUsed);
    }

    console.log(`Available giveaway bubbles: ${availableGiveawayBubbles}, Price: ${price}`);

    let usedGiveawayBubbles = 0;
    let usedPersonalBubbles = 0;
    let shortfall = 0;
    let needsAdminApproval = false;
    let useAllAvailableBubbles = false; // ✅ NEW: Flag to use all available bubbles

    // Check if user has at least some bubbles but not enough for full purchase
    const totalAvailableBubbles = availableGiveawayBubbles + user.bubblesCount;
    if (totalAvailableBubbles > 0 && totalAvailableBubbles < price) {
      // ✅ NEW CONDITION: User has some bubbles but not enough for full purchase
      useAllAvailableBubbles = true;
      needsAdminApproval = true;
      shortfall = price - totalAvailableBubbles;
      
      // Use all available giveaway bubbles first
      if (availableGiveawayBubbles > 0) {
        usedGiveawayBubbles = Math.min(availableGiveawayBubbles, price);
      }
      
      // Then use all personal bubbles
      if (user.bubblesCount > 0) {
        usedPersonalBubbles = Math.min(user.bubblesCount, price - usedGiveawayBubbles);
      }
    } else if (availableGiveawayBubbles >= price) {
      // User has enough giveaway bubbles
      usedGiveawayBubbles = price;
    } else {
      // User needs to combine giveaway and personal bubbles
      usedGiveawayBubbles = availableGiveawayBubbles;
      const remaining = price - usedGiveawayBubbles;

      if (user.bubblesCount >= remaining) {
        // User has enough personal bubbles to cover the rest
        usedPersonalBubbles = remaining;
      } else if (remaining - user.bubblesCount <= 200) {
        // User is short by up to 200 bubbles - needs admin approval
        usedPersonalBubbles = user.bubblesCount;
        shortfall = remaining - user.bubblesCount;
        needsAdminApproval = true;
      } else {
        // User doesn't have enough bubbles and shortfall exceeds 200
        await t.rollback();
        return res.status(400).json({
          message: `Insufficient bubbles. You need ${remaining} more but only have ${user.bubblesCount} personal bubbles. Shortfall of ${remaining - user.bubblesCount} exceeds the 200 bubble limit.`,
          availableGiveawayBubbles,
          personalBubbles: user.bubblesCount,
          required: price,
          shortfall: remaining - user.bubblesCount
        });
      }
    }

    console.log(`Redemption breakdown: Giveaway=${usedGiveawayBubbles}, Personal=${usedPersonalBubbles}, Shortfall=${shortfall}, UseAllAvailable=${useAllAvailableBubbles}`);

    // Deduct personal bubbles if used
    if (usedPersonalBubbles > 0) {
      user.bubblesCount -= usedPersonalBubbles;
      await user.save({ transaction: t });
    }

    // Record giveaway bubble transaction
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
    }

    // Record personal bubble transaction
    if (usedPersonalBubbles > 0) {
      await BubbleTransaction.create({
        fromUserId: userId,
        toUserId: userId,
        bubbleAmount: usedPersonalBubbles,
        type: 'offer_redemption',
        status: 'completed',
        giveaway: 0,
        description: `${category} Offer Redemption (Personal Bubbles) - Offer #${offerId}`
      }, { transaction: t });
    }

    // Create OfferRequest for admin approval if needed
    if (needsAdminApproval) {
      const adminNotes = useAllAvailableBubbles 
        ? `Full available balance used: ${usedGiveawayBubbles} giveaway + ${usedPersonalBubbles} personal bubbles. Shortfall: ${shortfall} bubbles for ${price} price offer.`
        : `Shortfall: ${shortfall} bubbles. Used ${usedGiveawayBubbles} giveaway + ${usedPersonalBubbles} personal bubbles for ${price} price offer.`;
      
      await OfferRequest.create({
        userId,
        brandId,
        offerId,
        scheduledDate: new Date(),
        scheduledTime: new Date().toTimeString().split(' ')[0],
        status: 'pending',
        adminNotes
      }, { transaction: t });
    }

    await t.commit();

    const updatedUser = await User.findByPk(userId, {
      attributes: ['id', 'name', 'bubblesCount', 'queuePosition', 'queueSlots']
    });

    const responseMessage = useAllAvailableBubbles
      ? `Used all available bubbles (${usedGiveawayBubbles} giveaway + ${usedPersonalBubbles} personal). ${shortfall} bubble shortfall sent for admin approval.`
      : needsAdminApproval 
        ? `Offer redeemed! ${shortfall} bubble shortfall sent for admin approval.`
        : 'Offer redeemed successfully!';

    res.json({
      success: true,
      message: responseMessage,
      redemption: {
        offerId,
        brandId,
        category,
        price,
        usedGiveawayBubbles,
        usedPersonalBubbles,
        shortfall,
        needsAdminApproval,
        usedAllAvailableBubbles: useAllAvailableBubbles // ✅ NEW: Indicates all available bubbles were used
      },
      updatedUser: {
        id: updatedUser.id,
        name: updatedUser.name,
        bubblesCount: parseInt(updatedUser.bubblesCount),
        queuePosition: updatedUser.queuePosition,
        queueSlots: updatedUser.queueSlots
      }
    });
  } catch (error) {
    await t.rollback();
    console.error('Offer redemption error:', error);
    res.status(400).json({ message: error.message || 'Redemption failed' });
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

module.exports = router;