// routes/admin.js - Fixed sequelize import
const express = require('express');
const auth = require('../middleware/auth');
const { User, Brand, Offer, OfferRequest, BubbleTransaction } = require('../models/index');
const { Op } = require('sequelize');
const sequelize = require('../config/database'); // Import sequelize instance directly

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

// ==================== USER BUBBLES ====================

// Get user's bubbles (from BubbleTransaction - where user is receiver)
router.get('/users/:id/bubbles', async (req, res) => {
  try {
    const { status } = req.query;
    const userId = parseInt(req.params.id);

    // Verify user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`Fetching bubbles for user ${userId}, status filter: ${status}`);

    // Get all transactions where this user is the receiver
    const transactions = await BubbleTransaction.findAll({
      where: { toUserId: userId },
      order: [['createdAt', 'DESC']],
      raw: true
    });

    console.log(`Found ${transactions.length} total transactions for user ${userId}`);

    // Calculate total received
    const totalReceived = transactions.reduce((sum, tx) => sum + (tx.bubbleAmount || 0), 0);
    const completedSlots = Math.floor(totalReceived / 400);
    const inProgressAmount = totalReceived % 400;

    console.log(`Total received: ${totalReceived}, Completed slots: ${completedSlots}, In progress: ${inProgressAmount}`);

    const bubbles = [];

    // If no status filter or asking for "active"
    if (!status || status === 'active') {
      // Show in-progress bubble if there's any progress
      if (inProgressAmount > 0) {
        bubbles.push({
          id: `active-bubble-${userId}`,
          title: `Support Goal - Slot ${completedSlots + 1}`,
          description: `Receiving support for queue slot ${completedSlots + 1}`,
          imageUrl: null,
          targetAmount: 400,
          currentAmount: inProgressAmount,
          status: 'active',
          createdAt: transactions.length > 0 ? transactions[0].createdAt : new Date(),
          updatedAt: new Date(),
          supportersCount: new Set(transactions.map(tx => tx.fromUserId)).size,
          category: 'bubble_queue'
        });
      }
    }

    // If no status filter or asking for "completed"
    if (!status || status === 'completed') {
      // Show each completed slot as a separate bubble
      for (let i = 0; i < completedSlots; i++) {
        bubbles.push({
          id: `completed-bubble-${userId}-${i}`,
          title: `Completed Slot ${i + 1}`,
          description: `Successfully received 400 bubbles for queue slot ${i + 1}`,
          imageUrl: null,
          targetAmount: 400,
          currentAmount: 400,
          status: 'completed',
          createdAt: transactions[0]?.createdAt || new Date(),
          updatedAt: new Date(),
          supportersCount: new Set(transactions.map(tx => tx.fromUserId)).size,
          category: 'bubble_queue'
        });
      }
    }

    console.log(`Returning ${bubbles.length} bubbles for user ${userId} with status filter: ${status || 'all'}`);

    res.json(bubbles);
  } catch (error) {
    console.error('Error fetching bubbles:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get bubble supporters (cumulative - total per supporter)
router.get('/bubbles/:id/supporters/cumulative', async (req, res) => {
  try {
    const bubbleId = req.params.id;

    // Parse bubble ID to extract user ID
    // Format: "active-bubble-{userId}" or "completed-bubble-{userId}-{slotNum}"
    const userIdMatch = bubbleId.match(/bubble-(\d+)/);
    if (!userIdMatch) {
      return res.status(400).json({ message: 'Invalid bubble ID format' });
    }
    const userId = parseInt(userIdMatch[1]);

    // Get cumulative support by supporter for this user using raw query
    const supporters = await sequelize.query(`
      SELECT 
        bt.fromUserId as supporterId,
        u.name as supporterName,
        SUM(bt.bubbleAmount) as totalAmount,
        COUNT(bt.id) as contributionCount,
        MAX(bt.createdAt) as lastContribution
      FROM BubbleTransactions bt
      INNER JOIN Users u ON bt.fromUserId = u.id
      WHERE bt.toUserId = :userId
      GROUP BY bt.fromUserId, u.name
      ORDER BY totalAmount DESC
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    // Transform response
    const formattedSupporters = supporters.map(s => ({
      id: s.supporterId,
      supporterId: s.supporterId,
      supporterName: s.supporterName || 'Anonymous',
      amount: parseInt(s.totalAmount) || 0,
      contributionCount: parseInt(s.contributionCount) || 0,
      createdAt: s.lastContribution
    }));

    res.json(formattedSupporters);
  } catch (error) {
    console.error('Error fetching cumulative supporters:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get bubble supporters (individual contributions)
router.get('/bubbles/:id/supporters/individual', async (req, res) => {
  try {
    const bubbleId = req.params.id;

    // Parse bubble ID to extract user ID
    const userIdMatch = bubbleId.match(/bubble-(\d+)/);
    if (!userIdMatch) {
      return res.status(400).json({ message: 'Invalid bubble ID format' });
    }
    const userId = parseInt(userIdMatch[1]);

    // Get individual contributions
    const supporters = await BubbleTransaction.findAll({
      where: { toUserId: userId },
      include: [
        {
          association: 'fromUser',
          attributes: ['id', 'name'],
          required: true
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Transform response
    const formattedSupporters = supporters.map(s => ({
      id: s.id,
      supporterId: s.fromUserId,
      supporterName: s.fromUser?.name || 'Anonymous',
      amount: s.bubbleAmount || 0,
      message: s.message,
      createdAt: s.createdAt
    }));

    res.json(formattedSupporters);
  } catch (error) {
    console.error('Error fetching individual supporters:', error);
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



// routes/admin.js - Add this route to your existing admin.js file

// ==================== ADMIN SUPPORT FUNCTIONALITY ====================

// Support a user (admin gives bubbles)
router.post('/users/:id/support', async (req, res) => {
  try {
    const { bubbleAmount, targetSlotNumber } = req.body;
    const targetUserId = parseInt(req.params.id);
    const adminId = req.user.id;

    console.log('Admin support request:', {
      adminId,
      targetUserId,
      bubbleAmount,
      targetSlotNumber
    });

    // Validation
    if (!bubbleAmount || bubbleAmount <= 0) {
      return res.status(400).json({ message: 'Valid bubble amount is required (must be > 0)' });
    }

    if (!targetSlotNumber || targetSlotNumber <= 0) {
      return res.status(400).json({ message: 'Target slot number is required' });
    }

    // Get admin user
    const admin = await User.findByPk(adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin account not found' });
    }

    // Get target user
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: 'Target user not found' });
    }

    // Check if admin has enough bubbles
    if (admin.bubblesCount < bubbleAmount) {
      return res.status(400).json({
        message: `Insufficient bubbles. You have ${admin.bubblesCount}, trying to send ${bubbleAmount}`
      });
    }

    // Validate target slot exists for this user
    if (targetSlotNumber > targetUser.queueSlots) {
      return res.status(400).json({
        message: `Invalid slot. User only has ${targetUser.queueSlots} slots (you tried slot ${targetSlotNumber})`
      });
    }

    // Get or initialize slot progress
    let slotProgress = {};
    if (targetUser.slotProgress) {
      if (typeof targetUser.slotProgress === 'string') {
        slotProgress = JSON.parse(targetUser.slotProgress);
      } else {
        slotProgress = targetUser.slotProgress;
      }
    }

    const slotKey = targetSlotNumber.toString();
    const currentProgress = parseInt(slotProgress[slotKey] || 0);
    const newProgress = currentProgress + bubbleAmount;
    const requiredPerSlot = 400;

    console.log(`Admin Support - Slot ${targetSlotNumber}: ${currentProgress} + ${bubbleAmount} = ${newProgress} / ${requiredPerSlot}`);

    // Deduct bubbles from admin
    admin.bubblesCount -= bubbleAmount;

    // Update slot progress
    slotProgress[slotKey] = newProgress;

    // Check if THIS SPECIFIC SLOT is completed
    let slotCompleted = false;
    let bubblesEarned = 0;

    if (newProgress >= requiredPerSlot) {
      slotCompleted = true;
      bubblesEarned = requiredPerSlot;

      // Mark slot as completed and remove excess
      slotProgress[slotKey] = newProgress - requiredPerSlot;

      // If no remaining progress, remove the slot entry
      if (slotProgress[slotKey] === 0) {
        delete slotProgress[slotKey];
      }

      // Give bubbles to receiver
      targetUser.bubblesCount += bubblesEarned;

      // Reduce queue slots
      targetUser.queueSlots = Math.max(0, targetUser.queueSlots - 1);

      // If all slots completed, remove from queue
      if (targetUser.queueSlots === 0) {
        targetUser.queuePosition = 0;
        targetUser.queueBubbles = 0;
        slotProgress = {};
        console.log(`${targetUser.name} completed all queue slots, removed from queue`);
      }

      console.log(`Slot ${targetSlotNumber} completed! User earned ${bubblesEarned} bubbles. Remaining slots: ${targetUser.queueSlots}`);
    }

    // Save updated slot progress as JSON STRING
    targetUser.slotProgress = JSON.stringify(slotProgress);

    console.log(`SAVING to DB - slotProgress:`, targetUser.slotProgress);

    // SAVE BOTH USERS
    await admin.save();
    await targetUser.save();

    console.log('✅ Both users saved to database');

    // REBALANCE QUEUE POSITIONS AFTER SLOT COMPLETION
    if (slotCompleted) {
      await rebalanceQueuePositions();
    }

    // Create transaction record
    const transaction = await BubbleTransaction.create({
      fromUserId: adminId,
      toUserId: targetUserId,
      bubbleAmount: bubbleAmount,
      targetSlotNumber: targetSlotNumber,
      type: 'admin_support',
      status: 'completed',
      queuePosition: admin.queuePosition || 0,
      slotsOpened: 0
    });

    console.log('Admin support transaction created:', transaction.id);

    // FETCH FRESH DATA FROM DATABASE
    const updatedTargetUser = await User.findByPk(targetUserId);
    let updatedSlotProgress = {};
    if (updatedTargetUser.slotProgress) {
      if (typeof updatedTargetUser.slotProgress === 'string') {
        updatedSlotProgress = JSON.parse(updatedTargetUser.slotProgress);
      } else {
        updatedSlotProgress = updatedTargetUser.slotProgress;
      }
    }

    console.log('✅ Fresh data from DB - slotProgress:', updatedSlotProgress);

    const responseData = {
      message: slotCompleted
        ? `Slot ${targetSlotNumber} completed! ${targetUser.name} earned ${bubblesEarned} bubbles!`
        : `Admin supported slot ${targetSlotNumber}: ${newProgress}/${requiredPerSlot}`,
      slotCompleted: slotCompleted,
      slotNumber: targetSlotNumber,
      slotProgress: parseInt(updatedSlotProgress[slotKey] || 0),
      totalSlotProgress: newProgress,
      adminBubblesRemaining: admin.bubblesCount,
      transaction: transaction,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        bubblesCount: parseInt(admin.bubblesCount),
      },
      receiverData: {
        id: updatedTargetUser.id,
        name: updatedTargetUser.name,
        bubblesCount: parseInt(updatedTargetUser.bubblesCount),
        queueSlots: updatedTargetUser.queueSlots,
        queuePosition: updatedTargetUser.queuePosition,
        slotProgress: updatedSlotProgress
      }
    };

    console.log('✅ Admin support response:', responseData);
    res.json(responseData);
  } catch (error) {
    console.error('Admin support error:', error);
    res.status(400).json({ message: error.message || 'Admin support failed' });
  }
});

// Helper function to rebalance queue positions (same as in get.js)
async function rebalanceQueuePositions() {
  try {
    console.log('Rebalancing queue positions...');

    const queuedUsers = await User.findAll({
      where: {
        queuePosition: { [Op.gt]: 0 }
      },
      order: [['queuePosition', 'ASC']],
      attributes: ['id', 'queuePosition', 'queueSlots']
    });

    let newPosition = 1;
    const updates = [];

    for (const user of queuedUsers) {
      if (user.queuePosition !== newPosition) {
        updates.push({
          id: user.id,
          oldPosition: user.queuePosition,
          newPosition: newPosition
        });

        await User.update(
          { queuePosition: newPosition },
          { where: { id: user.id } }
        );
      }

      newPosition += user.queueSlots;
    }

    console.log(`Rebalanced ${updates.length} users:`, updates);
    return updates;
  } catch (error) {
    console.error('Error rebalancing queue:', error);
    throw error;
  }
}





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