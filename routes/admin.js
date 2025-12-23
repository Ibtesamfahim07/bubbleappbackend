// routes/admin.js - Updated Giveaway Logic
const express = require('express');
const auth = require('../middleware/auth');
const { User, Brand, Offer, OfferRequest, BubbleTransaction, Giveaway } = require('../models/index');
// const { Op } = require('sequelize');
const { literal, Op } = require('sequelize');  // ✅ ADD THIS

const sequelize = require('../config/database');

const router = express.Router();

// Middleware to check admin access
const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

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
// Get user by ID - UPDATED to include all required fields
router.get('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    const user = await User.findByPk(userId, {
      attributes: [
        'id',
        'name', 
        'email',
        'bubblesCount',
        'country',
        'province',
        'city',
        'area',
        'queuePosition',
        'queueSlots',
        'queueBubbles',
        'slotProgress',
        'isActive',
        'createdAt',
        'updatedAt'
      ]
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Parse slotProgress if it's a JSON string
    let parsedSlotProgress = {};
    if (user.slotProgress) {
      if (typeof user.slotProgress === 'string') {
        try {
          parsedSlotProgress = JSON.parse(user.slotProgress);
        } catch (e) {
          console.error('Error parsing slotProgress:', e);
        }
      } else {
        parsedSlotProgress = user.slotProgress;
      }
    }

    // Format response with all required fields
    const userResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      bubblesCount: user.bubblesCount || 0,
      country: user.country || 'Pakistan',
      province: user.province || null,
      city: user.city || null,
      area: user.area || null,
      queuePosition: user.queuePosition || 0,
      queueSlots: user.queueSlots || 0,
      queueBubbles: user.queueBubbles || 0,
      slotProgress: parsedSlotProgress,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
    
    console.log(`✅ Fetched user ${userId} with complete data:`, {
      name: userResponse.name,
      bubbles: userResponse.bubblesCount,
      location: `${userResponse.province || ''} ${userResponse.city || ''} ${userResponse.area || ''}`.trim(),
      queue: `Position: ${userResponse.queuePosition}, Slots: ${userResponse.queueSlots}`
    });

    res.json(userResponse);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(400).json({ message: error.message });
  }
});

// ==================== USER BUBBLES ====================

// Get user's bubbles (from BubbleTransaction - where user is receiver)
// routes/admin.js - FIXED VERSION
router.get('/users/:id/bubbles', async (req, res) => {
  try {
    const { status } = req.query;
    const userId = parseInt(req.params.id);

    console.log(`[Admin] Getting bubbles for user ${userId}, status: ${status}`);

    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'queuePosition', 'queueSlots', 'slotProgress', 'createdAt']
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`User data:`, {
      name: user.name,
      queuePosition: user.queuePosition,
      queueSlots: user.queueSlots,
      slotProgress: user.slotProgress
    });

    // ========== FIXED PARSING ==========
    let slotProgress = {};
    if (user.slotProgress) {
      try {
        let raw = user.slotProgress;
        
        // Handle double-encoded JSON
        if (typeof raw === 'string') {
          // Remove outer quotes if present
          if (raw.startsWith('"') && raw.endsWith('"')) {
            raw = raw.slice(1, -1);
          }
          
          // Replace escaped quotes
          raw = raw.replace(/\\"/g, '"');
          
          // Parse
          if (raw.trim() !== '') {
            slotProgress = JSON.parse(raw);
          }
        } else if (typeof raw === 'object') {
          slotProgress = raw;
        }
      } catch (e) {
        console.error('Error parsing slotProgress:', e);
        console.error('Raw value:', user.slotProgress);
        slotProgress = {};
      }
    }
    
    console.log('DEBUG - Parsed slotProgress:', slotProgress);
    // ===================================

    const requiredBubbles = 400;
    const bubbles = [];

    // Active bubbles
    if (!status || status === 'active') {
      if (user.queuePosition > 0 && user.queueSlots > 0) {
        const queueSlots = parseInt(user.queueSlots) || 1;

        for (let slotNum = 1; slotNum <= queueSlots; slotNum++) {
          const currentProgress = parseInt(slotProgress[slotNum.toString()] || 0);

          if (currentProgress < requiredBubbles) {
            const progressPercent = Math.round((currentProgress / requiredBubbles) * 100);
            const absoluteQueuePos = user.queuePosition + (slotNum - 1);

            bubbles.push({
              id: `active-${userId}-${slotNum}`,
              title: `Slot ${slotNum}/${queueSlots}`,
              description: `Queue #${absoluteQueuePos} - ${progressPercent}% complete`,
              imageUrl: null,
              targetAmount: requiredBubbles,
              currentAmount: currentProgress,
              status: 'active',
              createdAt: user.createdAt,
              updatedAt: new Date().toISOString(),
              supportersCount: 0,
              category: 'bubble_queue',
              slotNumber: slotNum,
              queuePosition: absoluteQueuePos,
              userId: userId
            });

            console.log(`✅ Active slot ${slotNum}: ${currentProgress}/${requiredBubbles} (${progressPercent}%)`);
          }
        }
      }
    }

    // Completed bubbles
    if (!status || status === 'completed') {
      const receivedTxs = await BubbleTransaction.findAll({
        where: {
          toUserId: userId,
          status: 'completed'
        },
        attributes: [
          [literal('SUM(bubbleAmount)'), 'totalReceived']
        ],
        raw: true
      });

      const totalReceived = parseInt(receivedTxs[0]?.totalReceived || 0);
      const completedSlots = Math.floor(totalReceived / requiredBubbles);

      for (let i = 1; i <= completedSlots; i++) {
        bubbles.push({
          id: `completed-${userId}-${i}`,
          title: `Completed Slot ${i}`,
          description: `Successfully received 400 bubbles`,
          imageUrl: null,
          targetAmount: requiredBubbles,
          currentAmount: requiredBubbles,
          status: 'completed',
          createdAt: user.createdAt,
          updatedAt: new Date().toISOString(),
          supportersCount: 0,
          category: 'bubble_queue',
          slotNumber: i,
          userId: userId
        });
      }
    }

    console.log(`[Admin] Returning ${bubbles.length} bubbles (status: ${status})`);
    res.json(bubbles);
  } catch (error) {
    console.error('[Admin] Error fetching bubbles:', error);
    res.status(400).json({ message: error.message || 'Failed to fetch bubbles' });
  }
});

// Get bubble supporters (cumulative - total per supporter)
// routes/admin.js - FIXED GET /admin/bubbles/:id/supporters/cumulative

// routes/admin.js - FIXED cumulative supporters endpoint

router.get('/bubbles/:id/supporters/cumulative', async (req, res) => {
  try {
    const bubbleId = req.params.id;
    const { slotNumber } = req.query;  // ✅ GET SLOT NUMBER

    console.log('🔵 [Cumulative] Received:', { bubbleId, slotNumber });

    // Extract userId from bubble ID
    let userId = null;
    const matches = bubbleId.match(/(\d+)$/);
    if (matches) {
      userId = parseInt(matches[1]);
    }

    if (!userId && bubbleId.includes('-')) {
      const parts = bubbleId.split('-');
      for (let i = parts.length - 1; i >= 0; i--) {
        const num = parseInt(parts[i]);
        if (!isNaN(num) && num > 0) {
          userId = num;
          break;
        }
      }
    }

    if (!userId) {
      userId = parseInt(bubbleId);
    }

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ 
        message: `Invalid userId from: ${bubbleId}` 
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: `User not found: ${userId}` });
    }

    const requiredBubbles = 400;
    let supporters;

    // ✅ IF slotNumber provided, calculate which transactions contributed to that slot
    if (slotNumber) {
      const slotNum = parseInt(slotNumber);
      const slotStart = (slotNum - 1) * requiredBubbles;  // Slot 1: 0-399, Slot 2: 400-799
      const slotEnd = slotNum * requiredBubbles;

      console.log(`Filtering for slot ${slotNum}: bubbles ${slotStart}-${slotEnd}`);

      // Get ALL transactions, then calculate which ones contributed to this slot
      const allTransactions = await sequelize.query(`
        SELECT 
          bt.fromUserId as supporterId,
          u.name as supporterName,
          bt.bubbleAmount as amount,
          COUNT(bt.id) as transactionCount,
          MAX(bt.createdAt) as lastContribution
        FROM BubbleTransactions bt
        INNER JOIN Users u ON bt.fromUserId = u.id
        WHERE bt.toUserId = :userId
          AND bt.status = 'completed'
        ORDER BY bt.createdAt ASC
      `, {
        replacements: { userId },
        type: sequelize.QueryTypes.SELECT
      });

      console.log(`Total transactions: ${allTransactions.length}`);

      // Calculate cumulative totals and find which slot each transaction belongs to
      let cumulativeAmount = 0;
      const slotContributors = {};

      for (const tx of allTransactions) {
        const txStart = cumulativeAmount;
        const txEnd = cumulativeAmount + tx.amount;

        // Does this transaction overlap with our slot?
        if (txEnd > slotStart && txStart < slotEnd) {
          const contributionStart = Math.max(txStart, slotStart);
          const contributionEnd = Math.min(txEnd, slotEnd);
          const contribution = contributionEnd - contributionStart;

          if (contribution > 0) {
            if (!slotContributors[tx.supporterId]) {
              slotContributors[tx.supporterId] = {
                supporterId: tx.supporterId,
                supporterName: tx.supporterName,
                totalAmount: 0,
                contributionCount: 0,
                lastContribution: tx.lastContribution
              };
            }
            slotContributors[tx.supporterId].totalAmount += contribution;
            slotContributors[tx.supporterId].contributionCount += 1;
          }
        }

        cumulativeAmount += tx.amount;
      }

      supporters = Object.values(slotContributors);
      console.log(`✅ Found ${supporters.length} supporters for slot ${slotNum}`);

    } else {
      // ✅ NO SLOT - get all cumulative supporters
      supporters = await sequelize.query(`
        SELECT 
          bt.fromUserId as supporterId,
          u.name as supporterName,
          SUM(bt.bubbleAmount) as totalAmount,
          COUNT(bt.id) as contributionCount,
          MAX(bt.createdAt) as lastContribution
        FROM BubbleTransactions bt
        INNER JOIN Users u ON bt.fromUserId = u.id
        WHERE bt.toUserId = :userId
          AND bt.status = 'completed'
        GROUP BY bt.fromUserId, u.name
        ORDER BY totalAmount DESC
      `, {
        replacements: { userId },
        type: sequelize.QueryTypes.SELECT
      });

      console.log(`✅ Found ${supporters.length} cumulative supporters (all slots)`);
    }

    // Transform response
    const formattedSupporters = supporters.map(s => ({
      id: s.supporterId,
      supporterId: s.supporterId,
      supporterName: s.supporterName || 'Anonymous',
      amount: parseInt(s.totalAmount) || 0,
      contributionCount: parseInt(s.contributionCount) || 0,
      createdAt: s.lastContribution
    }));

    console.log(`Returning ${formattedSupporters.length} supporters`);
    res.json(formattedSupporters);
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(400).json({ message: error.message });
  }
});

// routes/admin.js - FIXED individual supporters endpoint

router.get('/bubbles/:id/supporters/individual', async (req, res) => {
  try {
    const bubbleId = req.params.id;
    const { slotNumber } = req.query;  // ✅ GET SLOT NUMBER

    console.log('🔵 [Individual] Received:', { bubbleId, slotNumber });

    // Extract userId
    let userId = null;
    const matches = bubbleId.match(/(\d+)$/);
    if (matches) {
      userId = parseInt(matches[1]);
    }

    if (!userId && bubbleId.includes('-')) {
      const parts = bubbleId.split('-');
      for (let i = parts.length - 1; i >= 0; i--) {
        const num = parseInt(parts[i]);
        if (!isNaN(num) && num > 0) {
          userId = num;
          break;
        }
      }
    }

    if (!userId) {
      userId = parseInt(bubbleId);
    }

    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ 
        message: `Invalid userId from: ${bubbleId}` 
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: `User not found: ${userId}` });
    }

    const requiredBubbles = 400;
    let transactions;

    // ✅ IF slotNumber provided, calculate which transactions contributed to that slot
    if (slotNumber) {
      const slotNum = parseInt(slotNumber);
      const slotStart = (slotNum - 1) * requiredBubbles;
      const slotEnd = slotNum * requiredBubbles;

      console.log(`Filtering individual transactions for slot ${slotNum}: ${slotStart}-${slotEnd}`);

      // Get all transactions
      const allTransactions = await BubbleTransaction.findAll({
        where: { 
          toUserId: userId,
          status: 'completed'
        },
        include: [
          {
            association: 'fromUser',
            attributes: ['id', 'name'],
            required: true
          }
        ],
        order: [['createdAt', 'ASC']],
        raw: false
      });

      // Filter transactions that contributed to this slot
      let cumulativeAmount = 0;
      const filteredTransactions = [];

      for (const tx of allTransactions) {
        const txStart = cumulativeAmount;
        const txEnd = cumulativeAmount + tx.bubbleAmount;

        // Does this transaction overlap with our slot?
        if (txEnd > slotStart && txStart < slotEnd) {
          filteredTransactions.push(tx);
        }

        cumulativeAmount += tx.bubbleAmount;
      }

      transactions = filteredTransactions;
      console.log(`✅ Found ${transactions.length} transactions for slot ${slotNum}`);

    } else {
      // ✅ NO SLOT - get all individual transactions
      transactions = await BubbleTransaction.findAll({
        where: { 
          toUserId: userId,
          status: 'completed'
        },
        include: [
          {
            association: 'fromUser',
            attributes: ['id', 'name'],
            required: true
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      console.log(`✅ Found ${transactions.length} individual transactions (all slots)`);
    }

    // Transform response
    const formattedSupporters = transactions.map(tx => ({
      id: tx.id,
      supporterId: tx.fromUserId,
      supporterName: tx.fromUser?.name || 'Anonymous',
      amount: tx.bubbleAmount || 0,
      createdAt: tx.createdAt
    }));

    console.log(`Returning ${formattedSupporters.length} supporters`);
    res.json(formattedSupporters);
  } catch (error) {
    console.error('❌ Error:', error);
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
// routes/admin.js - FIXED Admin Support (shows admin name, not "admin_support")

// Support a user (admin gives bubbles) - UPDATED
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

    // Validation...
    if (bubbleAmount <= 0 || bubbleAmount > 400) {
      return res.status(400).json({ 
        message: 'Bubble amount must be between 1 and 400' 
      });
    }

    const admin = await User.findByPk(adminId);
    const targetUser = await User.findByPk(targetUserId);

    if (!admin || !targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (admin.bubblesCount < bubbleAmount) {
      return res.status(400).json({
        message: `Insufficient bubbles. You have ${admin.bubblesCount}, trying to send ${bubbleAmount}`
      });
    }

    // ========== CRITICAL FIX: PROPERLY HANDLE slotProgress ==========
    let slotProgress = {};
    
    // Debug what we have
    console.log('DEBUG - Raw slotProgress from DB:', targetUser.slotProgress);
    console.log('DEBUG - Type:', typeof targetUser.slotProgress);
    
    if (targetUser.slotProgress) {
      try {
        // Remove any extra quotes or encoding
        let raw = targetUser.slotProgress;
        
        // If it's a string with double quotes at start and end
        if (typeof raw === 'string' && raw.startsWith('"') && raw.endsWith('"')) {
          console.log('DEBUG - Removing outer quotes');
          raw = raw.slice(1, -1);
        }
        
        // Try to parse
        console.log('DEBUG - Trying to parse:', raw);
        slotProgress = JSON.parse(raw);
        console.log('DEBUG - Parsed successfully:', slotProgress);
      } catch (parseError) {
        console.error('DEBUG - Parse error:', parseError);
        console.error('DEBUG - Raw value that failed:', targetUser.slotProgress);
        
        // Try alternative parsing
        try {
          // Maybe it's already an object?
          if (typeof targetUser.slotProgress === 'object') {
            slotProgress = targetUser.slotProgress;
          } else {
            // Try unescaping
            const unescaped = targetUser.slotProgress.replace(/\\"/g, '"');
            if (unescaped.startsWith('"')) {
              slotProgress = JSON.parse(unescaped.slice(1, -1));
            } else {
              slotProgress = JSON.parse(unescaped);
            }
          }
        } catch (e) {
          console.error('DEBUG - All parsing attempts failed:', e);
          slotProgress = {};
        }
      }
    }
    
    console.log('DEBUG - Final slotProgress object:', slotProgress);
    // ================================================================

    const slotKey = targetSlotNumber.toString();
    const currentProgress = parseInt(slotProgress[slotKey] || 0);
    const newProgress = currentProgress + bubbleAmount;
    const requiredPerSlot = 400;

    console.log(`Admin Support - Slot ${targetSlotNumber}: ${currentProgress} + ${bubbleAmount} = ${newProgress} / ${requiredPerSlot}`);

    // Update slot progress
    slotProgress[slotKey] = newProgress;

    // Deduct from admin
    admin.bubblesCount -= bubbleAmount;

    // Check if slot is completed
    let slotCompleted = false;
    let bubblesEarned = 0;

    if (newProgress >= requiredPerSlot) {
      slotCompleted = true;
      bubblesEarned = requiredPerSlot;

      // Handle slot completion
      slotProgress[slotKey] = newProgress - requiredPerSlot;
      if (slotProgress[slotKey] === 0) {
        delete slotProgress[slotKey];
      }

      // Give bubbles to receiver
      targetUser.bubblesCount += bubblesEarned;
      targetUser.queueSlots = Math.max(0, targetUser.queueSlots - 1);

      if (targetUser.queueSlots === 0) {
        targetUser.queuePosition = 0;
        targetUser.queueBubbles = 0;
        slotProgress = {};
      }
    }

    // ========== CRITICAL FIX: SAVE PROPERLY ==========
    console.log('DEBUG - Saving slotProgress:', slotProgress);
    console.log('DEBUG - Stringified:', JSON.stringify(slotProgress));
    
    // Save as proper JSON string
    targetUser.slotProgress = JSON.stringify(slotProgress);
    // ================================================

    // Save both users
    await admin.save();
    await targetUser.save();

    console.log('DEBUG - After save, fetching fresh data...');

    // Create transaction record
    const transaction = await BubbleTransaction.create({
      fromUserId: adminId,
      toUserId: targetUserId,
      bubbleAmount: bubbleAmount,
      targetSlotNumber: targetSlotNumber,
      type: 'support',
      status: 'completed',
      queuePosition: 0,
      slotsOpened: 0,
      description: `Admin support for slot ${targetSlotNumber}`,
      giveaway: 0
    });

    // ========== CRITICAL: FETCH FRESH DATA ==========
    const freshUser = await User.findByPk(targetUserId);
    let updatedSlotProgress = {};
    
    if (freshUser.slotProgress) {
      try {
        // Parse fresh data
        let raw = freshUser.slotProgress;
        if (typeof raw === 'string' && raw.startsWith('"') && raw.endsWith('"')) {
          raw = raw.slice(1, -1);
        }
        updatedSlotProgress = JSON.parse(raw);
      } catch (e) {
        console.error('Error parsing fresh slotProgress:', e);
        updatedSlotProgress = {};
      }
    }
    
    console.log('DEBUG - Fresh slotProgress from DB:', updatedSlotProgress);
    // ================================================

    const responseData = {
      message: slotCompleted
        ? `Slot ${targetSlotNumber} completed! ${targetUser.name} earned ${bubblesEarned} bubbles!`
        : `Supported slot ${targetSlotNumber}: ${newProgress}/${requiredPerSlot}`,
      slotCompleted: slotCompleted,
      slotNumber: targetSlotNumber,
      currentProgress: newProgress,
      slotProgress: parseInt(updatedSlotProgress[slotKey] || 0),
      adminBubblesRemaining: admin.bubblesCount,
      transaction: transaction,
      debug: {
        savedProgress: newProgress,
        retrievedProgress: updatedSlotProgress[slotKey],
        rawSlotProgress: freshUser.slotProgress
      }
    };

    console.log('Admin support response:', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Admin support error:', error);
    res.status(400).json({ 
      message: error.message || 'Admin support failed',
      details: error.stack
    });
  }
});




router.get('/me', async (req, res) => {
  try {
    const admin = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'email', 'bubblesCount', 'role', 'createdAt']
    });
    
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    res.json({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      bubblesCount: admin.bubblesCount,
      role: admin.role,
      createdAt: admin.createdAt
    });
  } catch (error) {
    console.error('Get admin info error:', error);
    res.status(400).json({ message: error.message });
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



// Get user's supporters and bubble game data
router.get('/users/:id/bubble-details/:bubbleId', async (req, res) => {
  try {
    const { bubbleId } = req.params;
    const userId = parseInt(req.params.id);

    // Get bubble details
    const userIdMatch = bubbleId.match(/bubble-(\d+)/);
    if (!userIdMatch) {
      return res.status(400).json({ message: 'Invalid bubble ID format' });
    }

    // Get all supporters for this user
    const supporters = await BubbleTransaction.findAll({
      where: { toUserId: userId },
      include: [
        {
          association: 'fromUser',
          attributes: ['id', 'name'],
          required: true
        }
      ],
      order: [['createdAt', 'DESC']],
      raw: true
    });

    const totalBubbles = supporters.reduce((sum, s) => sum + (s.bubbleAmount || 0), 0);
    const uniqueSupporters = new Set(supporters.map(s => s.fromUserId)).size;

    res.json({
      supporters: supporters.length,
      totalBubbles,
      uniqueSupporters,
      supporterList: supporters
    });
  } catch (error) {
    console.error('Error fetching bubble details:', error);
    res.status(400).json({ message: error.message });
  }
});


// Get current admin's profile (including bubbles)
router.get('/profile', async (req, res) => {
  try {
    const admin = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    
    if (!admin) {
      return res.status(404).json({ message: 'Admin profile not found' });
    }
    
    res.json(admin);
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



// routes/admin.js - FIXED Giveaway Routes (place AFTER adminAuth middleware)

// ==================== GIVEAWAY MANAGEMENT ====================

// 1. GET stats - shows eligible users count and active giveaways from DB
router.get('/giveaway/stats', async (req, res) => {
  try {
    console.log('🔵 GET /admin/giveaway/stats called');
    
    // Count users who have donated bubbles to others
    const eligibleUsersCount = await sequelize.query(`
      SELECT COUNT(DISTINCT fromUserId) as count
      FROM BubbleTransactions
      WHERE type IN ('support', 'donation', 'transfer')
      AND status = 'completed'
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    console.log('Eligible users count:', eligibleUsersCount);

    // Get active giveaways from DB (distributed = false)
    const activeGiveaways = await Giveaway.findAll({ 
      where: { distributed: false },
      attributes: ['id', 'category', 'amountPerUser', 'totalAmount', 'createdAt', 'updatedAt'],
      order: [['category', 'ASC']],
      raw: true
    });

    console.log('Active giveaways:', activeGiveaways);

    res.json({
      eligibleUsers: eligibleUsersCount[0]?.count || 0,
      activeGiveaways: activeGiveaways || []
    });
  } catch (e) { 
    console.error('❌ Giveaway stats error:', e);
    res.status(500).json({ message: e.message }); 
  }
});

// 2. POST /admin/giveaway/set - Create giveaway records in DB
router.post('/giveaway/set', async (req, res) => {
  console.log('🔵 POST /admin/giveaway/set called');
  console.log('📦 Request body:', req.body);
  console.log('👤 Admin ID:', req.user?.id);
  
  const { amountPerUser } = req.body;
  const adminId = req.user.id;
  
  // Validate input
  if (!amountPerUser) {
    console.error('❌ ERROR: amountPerUser is missing');
    return res.status(400).json({ message: 'amountPerUser is required' });
  }

  const parsedAmount = parseInt(amountPerUser);
  
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    console.error('❌ ERROR: amountPerUser <= 0:', amountPerUser);
    return res.status(400).json({ message: 'amountPerUser must be > 0' });
  }

  const t = await sequelize.transaction();
  try {
    console.log('💰 Creating giveaways with amount:', parsedAmount);

    const categories = ['Medical', 'Grocery', 'Education'];

    // Delete old undistributed giveaways
    console.log('🗑️  Deleting old giveaways');
    const deletedCount = await Giveaway.destroy({ 
      where: { distributed: false },
      transaction: t 
    });
    console.log(`✅ Deleted ${deletedCount} old giveaways`);

    // Create new giveaway records for each category
    const createdGiveaways = [];
    for (const category of categories) {
      console.log(`📝 Creating giveaway for ${category}`);
      
      const giveaway = await Giveaway.create({ 
        category, 
        amountPerUser: parsedAmount,
        totalAmount: 0,
        distributed: false,
        setByAdminId: adminId
      }, { transaction: t });

      createdGiveaways.push({
        id: giveaway.id,
        category: giveaway.category,
        amountPerUser: giveaway.amountPerUser,
        distributed: giveaway.distributed,
        createdAt: giveaway.createdAt
      });

      console.log(`✅ Created - ID: ${giveaway.id}, Category: ${category}, Amount: ${parsedAmount}`);
    }
    
    await t.commit();
    console.log('✅ Transaction committed');

    res.json({ 
      message: 'Giveaway set successfully',
      amountPerUser: parsedAmount,
      createdGiveaways: createdGiveaways
    });

  } catch (e) {
    await t.rollback();
    console.error('❌ Set giveaway error:', e);
    console.error('Stack:', e.stack);
    res.status(500).json({ message: e.message || 'Failed to set giveaway' });
  }
});

// 3. POST /admin/giveaway/reset - Delete all giveaways
router.post('/giveaway/reset', async (req, res) => {
  try {
    console.log('🔵 POST /admin/giveaway/reset called');
    
    const result = await Giveaway.destroy({ 
      where: { distributed: false } 
    });

    console.log(`✅ Deleted ${result} giveaway records`);

    res.json({ 
      message: 'All giveaways reset',
      deletedCount: result
    });
  } catch (e) {
    console.error('❌ Reset giveaway error:', e);
    res.status(500).json({ message: e.message }); 
  }
});

// 4. GET /admin/giveaway/:category - Get single category
router.get('/giveaway/:category', async (req, res) => {
  const { category } = req.params;

  if (!['Medical', 'Grocery', 'Education'].includes(category)) {
    return res.status(400).json({ message: 'Invalid category' });
  }

  try {
    const giveaway = await Giveaway.findOne({
      where: { category, distributed: false },
      attributes: ['id', 'category', 'amountPerUser', 'totalAmount', 'distributed', 'createdAt', 'updatedAt'],
      raw: true
    });

    if (!giveaway) {
      return res.json({ found: false, message: 'No active giveaway' });
    }

    res.json({ found: true, giveaway });
  } catch (e) {
    console.error('❌ Get giveaway error:', e);
    res.status(500).json({ message: e.message });
  }
});

// 5. POST /admin/giveaway/:category/reset - Reset specific category
router.post('/giveaway/:category/reset', async (req, res) => {
  const { category } = req.params;

  if (!['Medical', 'Grocery', 'Education'].includes(category)) {
    return res.status(400).json({ message: 'Invalid category' });
  }

  try {
    const result = await Giveaway.destroy({ 
      where: { category, distributed: false } 
    });

    res.json({ 
      message: `${category} giveaway reset`,
      deletedCount: result
    });
  } catch (e) {
    console.error('❌ Reset category error:', e);
    res.status(500).json({ message: e.message });
  }
});

// 2. POST /admin/giveaway/distribute  → **USER DONATES**
// ---------------------------------------------------------------
// FIXED: /admin/giveaway/distribute → SINGLE 400-BUBBLE TRANSACTION PER USER (NO ROUNDS)
router.post('/giveaway/distribute', async (req, res) => {
  const { userId, category, bubbles } = req.body;

  if (!userId || !category || !bubbles || bubbles <= 0) {
    return res.status(400).json({ message: 'userId, category, bubbles (>0) required' });
  }

  const t = await sequelize.transaction();
  try {
    console.log(`\n🎁 GIVEAWAY DISTRIBUTION START`);
    console.log(`   Donor: User ${userId}`);
    console.log(`   Category: ${category}`);
    console.log(`   Total Bubbles: ${bubbles}`);

    // ----- 1. Donor validation -------------------------------------------------
    const donor = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!donor) throw new Error('Donor not found');
    if (donor.bubblesCount < bubbles) {
      throw new Error(`Insufficient bubbles. You have ${donor.bubblesCount}, trying to donate ${bubbles}`);
    }

    // ----- 2. Giveaway validation --------------------------------------------
    const giveaway = await Giveaway.findOne({
      where: { category, distributed: false },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!giveaway) throw new Error(`No active ${category} giveaway. Admin hasn't set it up yet.`);

    const amountPerUser = giveaway.amountPerUser;
    if (amountPerUser <= 0) throw new Error('Invalid giveaway amount per user');

    console.log(`   Amount per user: ${amountPerUser}`);

    // ----- 3. Deduct from donor ------------------------------------
    donor.bubblesCount -= bubbles;
    await donor.save({ transaction: t });
    console.log(`   ✅ Deducted ${bubbles} from donor. New balance: ${donor.bubblesCount}`);

    // ----- 4. Record DONATION transaction ----------
    await BubbleTransaction.create({
      fromUserId: userId,
      toUserId: userId,
      bubbleAmount: bubbles,
      type: 'donation',
      status: 'completed',
      giveaway: 1,
      description: `Donated ${bubbles} bubbles to ${category} Giveaway`,
    }, { transaction: t });
    console.log(`   ✅ Recorded donation transaction`);

    // ----- 5. Get ALL eligible users ----------
    const eligibleResult = await sequelize.query(`
      SELECT u.id, u.name, u.createdAt,
             COALESCE(SUM(bt.bubbleAmount), 0) AS totalDonated
      FROM Users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1 
        AND u.id != :donorId
        AND bt.type IN ('support', 'donation', 'transfer')
        AND bt.status = 'completed'
        AND (bt.giveaway = 0 OR bt.giveaway IS NULL)
      GROUP BY u.id, u.name, u.createdAt
      ORDER BY totalDonated DESC, u.createdAt ASC
    `, {
      replacements: { donorId: userId },
      type: sequelize.QueryTypes.SELECT,
      transaction: t,
    });

    const eligibleCount = eligibleResult.length;
    giveaway.eligibleUsers = eligibleCount;

    console.log(`   📊 Total eligible users: ${eligibleCount}`);
    
    if (eligibleCount === 0) {
      await t.rollback();
      return res.status(400).json({ 
        message: 'No eligible users found. Users must donate to others first to receive giveaways.' 
      });
    }

    // ----- 6. Compute single distribution -----
    const totalNeeded = eligibleCount * amountPerUser;
    let totalDistributed = Math.min(totalNeeded, bubbles);

    // Calculate actual per-user amount (if donor gave fewer bubbles)
    const actualAmountPerUser = Math.floor(totalDistributed / eligibleCount);

    console.log(`\n   💰 ONE-TIME DISTRIBUTION: ${actualAmountPerUser} bubbles per user`);

    const transactionsToCreate = eligibleResult.map((user, index) => ({
      fromUserId: userId,
      toUserId: user.id,
      bubbleAmount: actualAmountPerUser,
      type: 'transfer',
      status: 'completed',
      giveaway: 1,
      description: `${category} Giveaway Distribution`,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const recipientsList = eligibleResult.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.name,
      totalDonated: user.totalDonated,
      received: actualAmountPerUser,
      transactionCount: 1
    }));

    console.log(`   🚀 Executing bulk insert for ${eligibleCount} users...`);
    await BubbleTransaction.bulkCreate(transactionsToCreate, { transaction: t });
    console.log(`   ✅ Created ${transactionsToCreate.length} transactions (ONE per user)`);

    // ----- 7. Bulk update balances -----
    await sequelize.query(`
      UPDATE Users 
      SET bubblesCount = bubblesCount + :amount
      WHERE id IN (:userIds)
    `, {
      replacements: {
        amount: actualAmountPerUser,
        userIds: eligibleResult.map(u => u.id),
      },
      transaction: t
    });
    console.log(`   ✅ Updated ${eligibleCount} user balances`);

    // ----- 8. Mark giveaway distributed -----
    giveaway.totalDonated = (giveaway.totalDonated || 0) + totalDistributed;
    giveaway.distributed = true;
    giveaway.distributedAt = new Date();
    await giveaway.save({ transaction: t });

    await t.commit();
    console.log(`✅ COMPLETE - ${eligibleCount} users received ${actualAmountPerUser} bubbles each (ONE transaction each)\n`);

    res.json({
      success: true,
      message: `Successfully distributed ${totalDistributed} bubbles to ${eligibleCount} users (ONE transaction each)`,
      distribution: {
        giveawayId: giveaway.id,
        category,
        amountPerUser: actualAmountPerUser,
        totalDonated: totalDistributed,
        recipientCount: eligibleCount,
        transactionCount: transactionsToCreate.length,
        recipients: recipientsList
      },
    });
  } catch (e) {
    await t.rollback();
    console.error('❌ Giveaway distribute error:', e);
    res.status(400).json({ message: e.message });
  }
});


// 7. GET /admin/giveaway/distribution-preview/:category
router.get('/giveaway/distribution-preview/:category', async (req, res) => {
  try {
    const { category } = req.params;
    
    const giveaway = await Giveaway.findOne({ 
      where: { category, distributed: false },
      attributes: ['id', 'amountPerUser'],
      raw: true
    });
    
    if (!giveaway) {
      return res.status(404).json({ message: 'No active giveaway' });
    }

    const eligibleUsersResult = await sequelize.query(`
      SELECT COUNT(DISTINCT fromUserId) as count
      FROM BubbleTransactions
      WHERE type IN ('support', 'donation', 'transfer')
      AND status = 'completed'
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    const eligibleCount = eligibleUsersResult[0]?.count || 0;

    res.json({
      giveawayId: giveaway.id,
      category,
      amountPerUser: giveaway.amountPerUser,
      eligibleUsers: eligibleCount
    });
  } catch (e) {
    console.error('❌ Preview error:', e);
    res.status(400).json({ message: e.message });
  }
});












// Get pending offer requests (shortfall requests)
router.get('/offer-requests/pending', async (req, res) => {
  try {
    console.log('Fetching pending offer requests...');
    
    const requests = await OfferRequest.findAll({
      where: { 
        status: 'pending',
        adminNotes: { [Op.like]: '%Shortfall:%' } // Only get requests with shortfalls
      },
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount'],
          required: true
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'description'],
          required: false
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'location'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Parse shortfall from adminNotes
    const requestsWithShortfall = requests.map(req => {
      const shortfallMatch = req.adminNotes?.match(/Shortfall: (\d+) bubbles/);
      const shortfall = shortfallMatch ? parseInt(shortfallMatch[1]) : 0;
      
      return {
        ...req.toJSON(),
        shortfall
      };
    });

    console.log(`Found ${requestsWithShortfall.length} pending requests`);
    res.json(requestsWithShortfall);
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Approve offer request - Admin pays the shortfall
// Approve offer request - Admin pays the shortfall
// Approve offer request - Admin pays the shortfall - FIXED
router.put('/offer-requests/:id/approve', async (req, res) => {
  const requestId = parseInt(req.params.id);
  const adminId = req.user.id;

  // Validate ID
  if (isNaN(requestId) || requestId <= 0) {
    return res.status(400).json({ message: 'Invalid request ID' });
  }

  const t = await sequelize.transaction();
  try {
    console.log(`Admin ${adminId} approving request ${requestId}`);

    // Get the offer request
    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        }
      ],
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!offerRequest) {
      await t.rollback();
      return res.status(404).json({ message: 'Offer request not found' });
    }

    if (offerRequest.status !== 'pending') {
      await t.rollback();
      return res.status(400).json({ message: 'Request is not pending' });
    }

    // Extract shortfall from adminNotes
    let shortfall = 0;
    if (offerRequest.adminNotes && offerRequest.adminNotes.includes('Shortfall:')) {
      const match = offerRequest.adminNotes.match(/Shortfall: (\d+) bubbles/);
      if (match) {
        const parsedShortfall = parseInt(match[1]);
        shortfall = isNaN(parsedShortfall) ? 0 : parsedShortfall;
      }
    }

    if (shortfall <= 0) {
      await t.rollback();
      return res.status(400).json({ message: 'No shortfall found in this request' });
    }

    // Get admin user
    const admin = await User.findByPk(adminId, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!admin) {
      await t.rollback();
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Check if admin has enough bubbles
    if (admin.bubblesCount < shortfall) {
      await t.rollback();
      return res.status(400).json({
        message: `Insufficient bubbles. You have ${admin.bubblesCount}, need ${shortfall}`,
        adminBubbles: admin.bubblesCount,
        required: shortfall
      });
    }

    // Deduct bubbles from admin
    admin.bubblesCount -= shortfall;
    await admin.save({ transaction: t });

    // Add bubbles to user
    const user = offerRequest.User;
    user.bubblesCount += shortfall;
    await user.save({ transaction: t });

    // Create transaction record
    await BubbleTransaction.create({
      fromUserId: adminId,
      toUserId: user.id,
      bubbleAmount: shortfall,
      type: 'transfer',
      status: 'completed',
      description: `Admin approved shortfall for Offer #${offerRequest.offerId} - ${offerRequest.Brand?.name || 'Brand'}`,
      giveaway: 0
    }, { transaction: t });

    // ✅ CHANGE STATUS TO 'completed' INSTEAD OF 'accepted'
    offerRequest.status = 'completed';
    offerRequest.redeemed = true;
    offerRequest.adminNotes = `${offerRequest.adminNotes || ''}\n\nApproved by admin. ${shortfall} bubbles transferred. Offer completed on ${new Date().toLocaleString()}.`;
    await offerRequest.save({ transaction: t });

    await t.commit();

    console.log(`✅ Request approved and completed. Admin ${admin.name} paid ${shortfall} bubbles to ${user.name}`);

    res.json({
      success: true,
      message: `Request approved and completed! ${shortfall} bubbles transferred to ${user.name}`,
      transaction: {
        fromAdmin: admin.name,
        toUser: user.name,
        amount: shortfall,
        adminRemainingBubbles: admin.bubblesCount,
        userNewBalance: user.bubblesCount
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('Approve request error:', error);
    res.status(400).json({ message: error.message || 'Failed to approve request' });
  }
});

// Reject offer request - FIXED
router.put('/offer-requests/:id/reject', async (req, res) => {
  const requestId = parseInt(req.params.id);
  const adminId = req.user.id;

  // Validate ID
  if (isNaN(requestId) || requestId <= 0) {
    return res.status(400).json({ message: 'Invalid request ID' });
  }

  try {
    console.log(`Admin ${adminId} rejecting request ${requestId}`);

    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    if (!offerRequest) {
      return res.status(404).json({ message: 'Offer request not found' });
    }

    if (offerRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Request is not pending' });
    }

    // Update status to rejected
    offerRequest.status = 'rejected';
    offerRequest.adminNotes = `${offerRequest.adminNotes || ''}\n\nRejected by admin on ${new Date().toLocaleString()}.`;
    await offerRequest.save();

    console.log(`✅ Request rejected for user ${offerRequest.User.name}`);

    res.json({
      success: true,
      message: `Request from ${offerRequest.User.name} rejected`,
      offerRequest
    });

  } catch (error) {
    console.error('Reject request error:', error);
    res.status(400).json({ message: error.message || 'Failed to reject request' });
  }
});






// ==================== OFFER REQUEST MANAGEMENT ====================

// ==================== OFFER REQUEST MANAGEMENT - FIXED PRICE IN PKR ====================

// Get all offer requests with filtering - FIXED to show price in PKR
// ==================== FIXED OFFER REQUEST ROUTES WITH BRAND PRICE ====================

// Get all offer requests - FIXED with proper Brand price fetching
router.get('/offer-requests', async (req, res) => {
  try {
    const { status, userId, brandId, startDate, endDate, search } = req.query;
    
    let whereClause = {};
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    if (userId) {
      const parsedUserId = parseInt(userId);
      if (!isNaN(parsedUserId)) {
        whereClause.userId = parsedUserId;
      }
    }
    
    if (brandId) {
      const parsedBrandId = parseInt(brandId);
      if (!isNaN(parsedBrandId)) {
        whereClause.brandId = parsedBrandId;
      }
    }
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        whereClause.createdAt = {
          [Op.between]: [start, end]
        };
      }
    }

    // Include all related models
    let includeClause = [
      {
        model: User,
        as: 'User',
        attributes: ['id', 'name', 'email', 'bubblesCount'],
        required: false
      },
      {
        model: Offer,
        as: 'Offer',
        attributes: ['id', 'title', 'discount', 'type', 'description', 'image', 'category'],
        required: false
      },
      {
        model: Brand,
        as: 'Brand',
        // GET ALL BRAND FIELDS INCLUDING PRICE
        attributes: ['id', 'name', 'category', 'price', 'location', 'rating', 'featured'],
        required: false  // This should be false to allow requests without brands
      }
    ];

    if (search) {
      includeClause[0].where = {
        [Op.or]: [
          { name: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } }
        ]
      };
    }
    
    console.log('Fetching offer requests with whereClause:', whereClause);
    
    const offerRequests = await OfferRequest.findAll({
      where: whereClause,
      include: includeClause,
      order: [['createdAt', 'DESC']]
    });

    console.log(`Found ${offerRequests.length} offer requests`);

    // Process each request
    const requestsWithTotal = offerRequests.map(request => {
      // DEBUG: Log the entire request object structure
      const requestData = request.toJSON();
      
      console.log(`\n=== Request ${request.id} DEBUG ===`);
      console.log('Request has totalAmount?', request.totalAmount !== undefined, request.totalAmount);
      console.log('Request has Brand?', request.Brand !== null);
      if (request.Brand) {
        console.log('Brand object:', {
          id: request.Brand.id,
          name: request.Brand.name,
          price: request.Brand.price,
          hasPrice: request.Brand.price !== undefined
        });
      }
      console.log('All request keys:', Object.keys(requestData));
      
      // TRY MULTIPLE PRICE SOURCES
      let price = 0;
      let priceSource = 'none';
      
      // 1. Direct from request
      if (request.totalAmount !== undefined && request.totalAmount !== null) {
        price = parseFloat(request.totalAmount);
        priceSource = 'request.totalAmount';
      }
      // 2. From Brand (this should work!)
      else if (request.Brand && request.Brand.price !== undefined && request.Brand.price !== null) {
        const brandPrice = request.Brand.price;
        // Handle if it's a string like "RS. 600" or just a number
        if (typeof brandPrice === 'string') {
          const cleanedPrice = brandPrice.replace(/[^0-9.]/g, '');
          price = parseFloat(cleanedPrice) || 0;
          priceSource = 'Brand.price (string)';
        } else {
          price = parseFloat(brandPrice);
          priceSource = 'Brand.price (number)';
        }
      }
      // 3. From request object directly (sometimes Sequelize nests it differently)
      else if (requestData.Brand && requestData.Brand.price !== undefined) {
        price = parseFloat(requestData.Brand.price);
        priceSource = 'requestData.Brand.price';
      }
      
      const discount = parseFloat(request.Offer?.discount || 0);
      const total = discount > 0 ? (price * (1 - discount / 100)) : price;
      
      console.log(`Request ${request.id}: price=${price} (from ${priceSource}), discount=${discount}%, total=${total}`);
      
      // Extract shortfall
      let shortfall = 0;
      if (request.adminNotes && request.adminNotes.includes('Shortfall:')) {
        const match = request.adminNotes.match(/Shortfall: (\d+)/);
        if (match) {
          shortfall = parseInt(match[1]) || 0;
        }
      }
      
      return {
        ...requestData,
        price: price.toFixed(2),
        totalAmount: total.toFixed(2),
        priceInPKR: `PKR ${price.toFixed(2)}`,
        totalInPKR: `PKR ${total.toFixed(2)}`,
        image: request.Offer?.image || null,
        category: request.Offer?.category || request.Brand?.category || 'Uncategorized',
        shortfall: shortfall,
        _debug: {
          priceSource,
          rawBrandPrice: request.Brand?.price,
          hasBrand: !!request.Brand,
          brandId: request.brandId
        }
      };
    });
    
    console.log(`✅ Returning ${requestsWithTotal.length} offer requests`);
    res.json(requestsWithTotal);
  } catch (error) {
    console.error('❌ Get offer requests error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get single offer request by ID
router.get('/offer-requests/:id', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    
    if (isNaN(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Invalid request ID' });
    }
    
    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'description', 'image', 'category']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'price', 'location', 'rating']
        }
      ]
    });
    
    if (!offerRequest) {
      return res.status(404).json({ message: 'Offer request not found' });
    }

    // Get price from Brand
    let price = 0;
    if (offerRequest.totalAmount) {
      price = parseFloat(offerRequest.totalAmount);
    } else if (offerRequest.Brand?.price) {
      const brandPrice = offerRequest.Brand.price;
      if (typeof brandPrice === 'string') {
        price = parseFloat(brandPrice.replace(/[^0-9.]/g, '')) || 0;
      } else {
        price = parseFloat(brandPrice);
      }
    }
    
    const discount = parseFloat(offerRequest.Offer?.discount || 0);
    const total = discount > 0 ? (price * (1 - discount / 100)) : price;
    
    let shortfall = 0;
    if (offerRequest.adminNotes && offerRequest.adminNotes.includes('Shortfall:')) {
      const match = offerRequest.adminNotes.match(/Shortfall: (\d+)/);
      if (match) {
        shortfall = parseInt(match[1]) || 0;
      }
    }
    
    const response = {
      ...offerRequest.toJSON(),
      price: price.toFixed(2),
      totalAmount: total.toFixed(2),
      priceInPKR: `PKR ${price.toFixed(2)}`,
      totalInPKR: `PKR ${total.toFixed(2)}`,
      image: offerRequest.Offer?.image || null,
      category: offerRequest.Offer?.category || offerRequest.Brand?.category || 'Uncategorized',
      shortfall: shortfall
    };
    
    res.json(response);
  } catch (error) {
    console.error('Get offer request error:', error);
    res.status(400).json({ message: error.message });
  }
});

// ==================== DEBUG ENDPOINT ====================
// Add this temporary endpoint to see what data is actually in the database
router.get('/offer-requests/:id/debug', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    
    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User'
        },
        {
          model: Offer,
          as: 'Offer'
        },
        {
          model: Brand,
          as: 'Brand'
        }
      ]
    });
    
    if (!offerRequest) {
      return res.status(404).json({ message: 'Not found' });
    }
    
    res.json({
      offerRequest: offerRequest.toJSON(),
      analysis: {
        'request.totalAmount': offerRequest.totalAmount,
        'Brand.price': offerRequest.Brand?.price,
        'Offer.discount': offerRequest.Offer?.discount,
        'Offer.type': offerRequest.Offer?.type,
        'All Offer fields': offerRequest.Offer,
        'All Brand fields': offerRequest.Brand
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update offer request status
router.put('/offer-requests/:id/status', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { status, adminNotes } = req.body;
    const adminId = req.user.id;

    if (!['pending', 'accepted', 'rejected', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        }
      ]
    });

    if (!offerRequest) {
      return res.status(404).json({ message: 'Offer request not found' });
    }

    const previousStatus = offerRequest.status;
    offerRequest.status = status;
    
    if (adminNotes) {
      offerRequest.adminNotes = `${offerRequest.adminNotes || ''}\n\nAdmin ${req.user.name} (${new Date().toLocaleString()}): ${adminNotes}`;
    }

    await offerRequest.save();

    // If status changed to 'accepted' from 'pending', handle shortfall if any
    if (previousStatus === 'pending' && status === 'accepted') {
      const shortfallMatch = offerRequest.adminNotes?.match(/Shortfall: (\d+) bubbles/);
      const shortfall = shortfallMatch ? parseInt(shortfallMatch[1]) : 0;

      if (shortfall > 0) {
        // Admin needs to manually transfer bubbles for shortfall
        console.log(`⚠️  Offer ${requestId} has shortfall of ${shortfall} bubbles. Admin needs to handle manually.`);
      }
    }

    // Log the status change
    console.log(`Admin ${req.user.name} changed offer request ${requestId} from ${previousStatus} to ${status}`);

    // Get updated request with all relations
    const updatedRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'description']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'price', 'location']
        }
      ]
    });

    res.json({
      message: 'Offer request status updated successfully',
      offerRequest: updatedRequest
    });
  } catch (error) {
    console.error('Update offer request status error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Add admin notes to offer request
router.post('/offer-requests/:id/notes', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { notes } = req.body;

    if (!notes || notes.trim() === '') {
      return res.status(400).json({ message: 'Notes are required' });
    }

    const offerRequest = await OfferRequest.findByPk(requestId);

    if (!offerRequest) {
      return res.status(404).json({ message: 'Offer request not found' });
    }

    const timestamp = new Date().toLocaleString();
    offerRequest.adminNotes = `${offerRequest.adminNotes || ''}\n\nAdmin ${req.user.name} (${timestamp}): ${notes}`;
    await offerRequest.save();

    res.json({
      message: 'Notes added successfully',
      offerRequest
    });
  } catch (error) {
    console.error('Add notes error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get offer request statistics
// Get offer request statistics - FIXED VERSION
router.get('/offer-requests/stats', async (req, res) => {
  try {
    const total = await OfferRequest.count();
    const pending = await OfferRequest.count({ where: { status: 'pending' } });
    const accepted = await OfferRequest.count({ where: { status: 'accepted' } });
    const rejected = await OfferRequest.count({ where: { status: 'rejected' } });
    const completed = await OfferRequest.count({ where: { status: 'completed' } });
    const cancelled = await OfferRequest.count({ where: { status: 'cancelled' } });

    // Calculate total shortfall amount
    // FIXED: Get all pending requests and extract shortfall from notes
    const pendingRequests = await OfferRequest.findAll({
      where: { 
        status: 'pending'
      }
    });

    let totalShortfall = 0;
    pendingRequests.forEach(request => {
      if (request.adminNotes && request.adminNotes.includes('Shortfall:')) {
        const match = request.adminNotes.match(/Shortfall: (\d+) bubbles/);
        if (match) {
          const shortfall = parseInt(match[1]);
          if (!isNaN(shortfall) && shortfall > 0) {
            totalShortfall += shortfall;
          }
        }
      }
    });

    res.json({
      total,
      pending,
      accepted,
      rejected,
      completed,
      cancelled,
      totalShortfall,
      pendingShortfallRequests: pendingRequests.filter(r => 
        r.adminNotes && r.adminNotes.includes('Shortfall:')
      ).length
    });
  } catch (error) {
    console.error('Get offer request stats error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Mark offer request as redeemed
router.post('/offer-requests/:id/redeem', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { redeemedBy } = req.body;

    const offerRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    if (!offerRequest) {
      return res.status(404).json({ message: 'Offer request not found' });
    }

    if (offerRequest.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted offers can be redeemed' });
    }

    if (offerRequest.redeemed) {
      return res.status(400).json({ message: 'Offer already redeemed' });
    }

    offerRequest.redeemed = true;
    offerRequest.status = 'completed';
    offerRequest.adminNotes = `${offerRequest.adminNotes || ''}\n\nRedeemed by: ${redeemedBy || req.user.name} on ${new Date().toLocaleString()}`;
    await offerRequest.save();

    res.json({
      message: 'Offer marked as redeemed',
      offerRequest
    });
  } catch (error) {
    console.error('Redeem offer error:', error);
    res.status(400).json({ message: error.message });
  }
});


// ==================== BUBBLE REQUEST MANAGEMENT ====================

// Get all bubble requests with filtering
router.get('/bubble-requests', async (req, res) => {
  try {
    const { status, userId, brandId, startDate, endDate, search } = req.query;
    
    let whereClause = {};
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    if (userId) {
      whereClause.userId = parseInt(userId);
    }
    
    if (brandId) {
      whereClause.brandId = parseInt(brandId);
    }
    
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    // Search in user name or offer title
    let includeClause = [
      {
        model: User,
        as: 'User',
        attributes: ['id', 'name', 'email', 'bubblesCount'],
        required: false
      },
      {
        model: Offer,
        as: 'Offer',
        attributes: ['id', 'title', 'discount', 'type', 'description'],
        required: false
      },
      {
        model: Brand,
        as: 'Brand',
        attributes: ['id', 'name', 'category', 'price', 'location'],
        required: false
      }
    ];

    if (search) {
      includeClause[0].where = {
        [Op.or]: [
          { name: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } }
        ]
      };
    }
    
    const bubbleRequests = await OfferRequest.findAll({
      where: whereClause,
      include: includeClause,
      order: [['createdAt', 'DESC']]
    });

    // Calculate total amount for each request
    const requestsWithTotal = bubbleRequests.map(request => {
      const price = request.Brand?.price || 0;
      const discount = request.Offer?.discount || 0;
      const total = discount > 0 ? (price * (1 - discount / 100)) : price;
      
      return {
        ...request.toJSON(),
        totalAmount: parseFloat(total).toFixed(2),
        shortfall: request.adminNotes?.includes('Shortfall') ? 
          parseInt(request.adminNotes.match(/Shortfall: (\d+)/)?.[1] || 0) : 0
      };
    });
    
    res.json({
      bubbles: requestsWithTotal
    });
  } catch (error) {
    console.error('Get bubble requests error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get bubble request by ID
router.get('/bubble-requests/:id', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    
    const bubbleRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'description']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'price', 'location']
        }
      ]
    });
    
    if (!bubbleRequest) {
      return res.status(404).json({ message: 'Bubble request not found' });
    }

    // Calculate total amount
    const price = bubbleRequest.Brand?.price || 0;
    const discount = bubbleRequest.Offer?.discount || 0;
    const total = discount > 0 ? (price * (1 - discount / 100)) : price;
    
    const response = {
      ...bubbleRequest.toJSON(),
      totalAmount: parseFloat(total).toFixed(2),
      shortfall: bubbleRequest.adminNotes?.includes('Shortfall') ? 
        parseInt(bubbleRequest.adminNotes.match(/Shortfall: (\d+)/)?.[1] || 0) : 0
    };
    
    res.json(response);
  } catch (error) {
    console.error('Get bubble request error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update bubble request status (THIS IS THE KEY ROUTE YOU'RE MISSING)
router.put('/bubble-requests/:id', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { status, adminNotes } = req.body;
    const adminId = req.user.id;

    // Map 'approved' to 'accepted' for database
    const dbStatus = status === 'approved' ? 'accepted' : status;

    if (!['pending', 'accepted', 'rejected', 'completed', 'cancelled'].includes(dbStatus)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const bubbleRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        }
      ]
    });

    if (!bubbleRequest) {
      return res.status(404).json({ message: 'Bubble request not found' });
    }

    const previousStatus = bubbleRequest.status;
    bubbleRequest.status = dbStatus;
    
    if (adminNotes && adminNotes.trim()) {
      bubbleRequest.adminNotes = `${bubbleRequest.adminNotes || ''}\n\nAdmin ${req.user.name} (${new Date().toLocaleString()}): ${adminNotes}`;
    } else {
      bubbleRequest.adminNotes = `${bubbleRequest.adminNotes || ''}\n\nStatus changed to ${dbStatus} by Admin ${req.user.name} on ${new Date().toLocaleString()}`;
    }

    await bubbleRequest.save();

    console.log(`Admin ${req.user.name} changed bubble request ${requestId} from ${previousStatus} to ${dbStatus}`);

    // Get updated request with all relations
    const updatedRequest = await OfferRequest.findByPk(requestId, {
      include: [
        {
          model: User,
          as: 'User',
          attributes: ['id', 'name', 'email', 'bubblesCount']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount', 'type', 'description']
        },
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'category', 'price', 'location']
        }
      ]
    });

    res.json({
      message: 'Bubble request status updated successfully',
      bubbleRequest: updatedRequest
    });
  } catch (error) {
    console.error('Update bubble request error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Add admin notes to bubble request
router.post('/bubble-requests/:id/notes', async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { notes } = req.body;

    if (!notes || notes.trim() === '') {
      return res.status(400).json({ message: 'Notes are required' });
    }

    const bubbleRequest = await OfferRequest.findByPk(requestId);

    if (!bubbleRequest) {
      return res.status(404).json({ message: 'Bubble request not found' });
    }

    const timestamp = new Date().toLocaleString();
    bubbleRequest.adminNotes = `${bubbleRequest.adminNotes || ''}\n\nAdmin ${req.user.name} (${timestamp}): ${notes}`;
    await bubbleRequest.save();

    res.json({
      message: 'Notes added successfully',
      bubbleRequest
    });
  } catch (error) {
    console.error('Add notes error:', error);
    res.status(400).json({ message: error.message });
  }
});






module.exports = router;