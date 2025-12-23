// routes/get.js - COMPLETE FIXED VERSION
const express = require('express');
const auth = require('../middleware/auth');
const { User, BubbleTransaction, Giveaway } = require('../models');
const { literal, Op } = require('sequelize');
const sequelize = require('../config/database');

const router = express.Router();
router.use(auth);

// Helper functions
async function getCitiesWithUsers() {
  try {
    const cities = await User.findAll({
      attributes: [
        [literal('DISTINCT city'), 'city']
      ],
      where: {
        city: { [Op.ne]: null },
        queuePosition: { [Op.gt]: 0 },
        bubblesCount: { [Op.gt]: 0 }
      },
      raw: true
    });
    
    return cities.map(c => c.city).filter(Boolean);
  } catch (error) {
    console.error('Error getting cities with users:', error);
    return [];
  }
}

async function getAreasWithUsers(city) {
  try {
    const areas = await User.findAll({
      attributes: [
        [literal('DISTINCT area'), 'area']
      ],
      where: {
        city: city,
        area: { [Op.ne]: null },
        queuePosition: { [Op.gt]: 0 },
        bubblesCount: { [Op.gt]: 0 }
      },
      raw: true
    });
    
    return areas.map(a => a.area).filter(Boolean);
  } catch (error) {
    console.error('Error getting areas with users:', error);
    return [];
  }
}

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

// Routes
router.get('/available-cities', async (req, res) => {
  try {
    const cities = await getCitiesWithUsers();
    res.json(cities);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/available-areas/:city', async (req, res) => {
  try {
    const { city } = req.params;
    const areas = await getAreasWithUsers(city);
    res.json(areas);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 10, location } = req.query;
    console.log('Backend - Nearby request params:', { lat, lng, radius, location, userId: req.user.id });
    
    if (!lat || !lng) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }
    
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);
    
    if (isNaN(userLat) || isNaN(userLng) || isNaN(searchRadius)) {
      return res.status(400).json({ message: 'Invalid coordinates or radius' });
    }
    
    console.log('Backend - Searching from coordinates:', { userLat, userLng, searchRadius, location });
    
    const currentUser = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'queuePosition', 'queueSlots', 'queueBubbles', 'requiredBubbles', 'bubblesCount', 'country', 'province', 'city', 'area', 'lat', 'lng', 'slotProgress']
    });

    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Current user queue status:', {
      id: currentUser.id,
      queuePosition: currentUser.queuePosition,
      queueSlots: currentUser.queueSlots,
      inQueue: currentUser.queuePosition > 0,
      slotProgress: currentUser.slotProgress
    });

    const distanceFormula = literal(`(
      6371 * acos(
        cos(radians(${userLat})) * 
        cos(radians(lat)) * 
        cos(radians(lng) - radians(${userLng})) + 
        sin(radians(${userLat})) * 
        sin(radians(lat))
      )
    )`);
    
    let whereConditions = {
      id: { [Op.ne]: req.user.id },
      bubblesCount: { [Op.gt]: 0 },
      isActive: true,
      queuePosition: { [Op.gt]: 0 }
    };

    if (location && location !== 'All') {
      console.log('Applying location filter to DATABASE users:', location);
      
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar', 'Sukkur', 'Larkana', 'Mirpurkhas', 'Gwadar', 'Turbat', 'Khuzdar', 'Mardan', 'Abbottabad', 'Swat', 'Gujranwala', 'Sialkot'];
      const knownAreas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Gulberg', 'Johar Town', 'Model Town', 'Latifabad', 'Qasimabad', 'Cantonment', 'Hussainabad', 'F-6', 'F-7', 'F-8', 'G-6', 'G-7', 'Blue Area'];
      
      if (knownCities.includes(location)) {
        whereConditions.city = location;
        console.log('Filtering by CITY:', location);
      } else if (knownAreas.includes(location)) {
        whereConditions.area = location;
        console.log('Filtering by AREA:', location);
      } else {
        whereConditions[Op.or] = [
          { country: location },
          { province: location },
          { city: location },
          { area: location }
        ];
        console.log('Filtering by ANY location field:', location);
      }
    }
    
    console.log('Backend - Final WHERE conditions:', JSON.stringify(whereConditions, null, 2));

    const users = await User.findAll({
      attributes: [
        'id', 'name', 'email', 'lat', 'lng', 'bubblesCount',
        'country', 'province', 'city', 'area',
        'queuePosition', 'queueBubbles', 'requiredBubbles', 'queueSlots', 'slotProgress',
        [distanceFormula, 'distance']
      ],
      where: whereConditions,
      having: literal(`distance < ${searchRadius}`),
      order: [
        ['queuePosition', 'ASC'],
        ['bubblesCount', 'DESC'],
        [literal('distance'), 'ASC']
      ],
      limit: 50
    });
    
    console.log(`Backend - Found ${users.length} other users in queue with location filter: ${location || 'All'}`);
    
    if (users.length > 0) {
      console.log('Returned users locations:', users.map(u => ({ name: u.name, city: u.city, area: u.area })));
    }
    
    const filteredUsers = [];
    const currentUserInQueue = currentUser.queuePosition > 0;

    for (const user of users) {
      if (!currentUserInQueue) {
        if (user.queuePosition === 1) {
          filteredUsers.push(user);
          console.log(`Showing user ${user.name} (Queue #1, ${user.area}) to non-queue user`);
        }
      } else {
        if (user.queuePosition < currentUser.queuePosition) {
          filteredUsers.push(user);
          console.log(`Showing user ${user.name} (Queue #${user.queuePosition}, ${user.area}) to user in queue #${currentUser.queuePosition}`);
        }
      }
    }

    const expandedUsers = [];

    for (const user of filteredUsers) {
      const queueSlots = parseInt(user.queueSlots) || 1;
      const bubblesCount = parseInt(user.bubblesCount);
      const baseQueuePosition = parseInt(user.queuePosition) || 0;
      const requiredBubbles = 400;
      const distance = user.getDataValue ? parseFloat(user.getDataValue('distance')).toFixed(1) : '0.0';
      const isOwnCard = false;

      let slotProgress = user.slotProgress || {};
      if (typeof slotProgress === 'string') {
        try {
          slotProgress = JSON.parse(slotProgress);
        } catch (e) {
          console.error('Error parsing slotProgress for user', user.id, ':', e);
          slotProgress = {};
        }
      }

      console.log(`Processing user ${user.name} - slotProgress:`, slotProgress);

      const locationParts = [];
      if (user.area) locationParts.push(user.area);
      if (user.city && user.city !== user.area) locationParts.push(user.city);
      if (user.province && user.province !== user.city) locationParts.push(user.province);
      const locationDisplay = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown';

      for (let slotIndex = 0; slotIndex < queueSlots; slotIndex++) {
        const slotNumber = slotIndex + 1;
        const currentQueuePosition = baseQueuePosition + slotIndex;
        
        const currentSlotProgress = parseInt(slotProgress[slotNumber.toString()] || 0);
        const remainingForSlot = requiredBubbles - currentSlotProgress;
        const queueProgressPercent = requiredBubbles > 0 ? Math.round((currentSlotProgress / requiredBubbles) * 100) : 0;

        let creatorColor = '#10b981';
        if (currentQueuePosition === 1) {
          creatorColor = '#ef4444';
        } else if (currentQueuePosition <= 5) {
          creatorColor = '#f59e0b';
        } else if (currentQueuePosition <= 10) {
          creatorColor = '#3b82f6';
        } else {
          creatorColor = '#10b981';
        }

        const slotLabel = queueSlots > 1 ? ` [Slot ${slotNumber}/${queueSlots}]` : '';
        const description = `Queue #${currentQueuePosition}${slotLabel} • ${currentSlotProgress}/${requiredBubbles} (${queueProgressPercent}%) • ${locationDisplay}`;
        
        console.log(`Creating card for ${user.name} slot ${slotNumber}: progress ${currentSlotProgress}/${requiredBubbles}, remaining ${remainingForSlot}`);
        
        expandedUsers.push({
          id: `${user.id}-slot-${slotIndex}`,
          userId: user.id,
          userName: user.name,
          bubbleAmount: bubblesCount,
          totalBubbles: bubblesCount,
          creatorColor: creatorColor,
          description: description,
          distance: distance,
          lat: user.lat,
          lng: user.lng,
          
          country: user.country,
          province: user.province,
          city: user.city,
          area: user.area,
          locationDisplay: locationDisplay,
          
          queuePosition: currentQueuePosition,
          queueProgress: currentSlotProgress,
          queueRequired: requiredBubbles,
          queueProgressPercent: queueProgressPercent,
          remainingForSlot: remainingForSlot,
          queueSlots: queueSlots,
          slotIndex: slotIndex,
          slotNumber: slotNumber,
          baseQueuePosition: baseQueuePosition,
          
          isInQueue: currentQueuePosition > 0,
          canSupport: true,
          isOwnCard: false
        });
      }
    }

    expandedUsers.sort((a, b) => a.queuePosition - b.queuePosition);

    console.log(`Backend - Returning ${expandedUsers.length} cards with slot progress data`);
    
    if (!currentUserInQueue && expandedUsers.length === 0) {
      console.log('Backend - No Queue #1 user found for non-queue user');
    }

    res.json(expandedUsers);
  } catch (error) {
    console.error('Backend - Nearby users error:', error);
    res.status(400).json({ message: error.message || 'Failed to get nearby users' });
  }
});

router.get('/incomplete-queue', async (req, res) => {
  try {
    console.log('Backend - Getting incomplete queue cards for user:', req.user.id);
    
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser || currentUser.queuePosition === 0) {
      console.log('Backend - User not in queue or not found:', { userId: req.user.id, queuePosition: currentUser?.queuePosition });
      return res.json([]);
    }

    let slotProgress = {};
    try {
      slotProgress = currentUser.slotProgress ? JSON.parse(currentUser.slotProgress) : {};
    } catch (error) {
      console.error('Error parsing slotProgress:', error);
      slotProgress = {};
    }

    const requiredBubbles = currentUser.requiredBubbles || 400;
    const queueSlots = parseInt(currentUser.queueSlots) || 1;
    const cards = [];

    const transactions = await BubbleTransaction.findAll({
      where: {
        toUserId: currentUser.id,
        status: 'completed'
      },
      order: [['createdAt', 'ASC']],
      raw: true
    });

    const slotSupporters = {};
    const slotFirstTransaction = {};

    let cumulativeBubbles = 0;
    
    for (const tx of transactions) {
      const startCumulative = cumulativeBubbles;
      cumulativeBubbles += tx.bubbleAmount;
      
      const startSlot = Math.floor(startCumulative / requiredBubbles) + 1;
      const endSlot = Math.floor((cumulativeBubbles - 1) / requiredBubbles) + 1;
      
      for (let slotNum = startSlot; slotNum <= endSlot; slotNum++) {
        if (!slotSupporters[slotNum]) {
          slotSupporters[slotNum] = new Set();
          slotFirstTransaction[slotNum] = tx.createdAt;
        }
        
        const slotStart = (slotNum - 1) * requiredBubbles;
        const slotEnd = slotNum * requiredBubbles;
        
        const contributionStart = Math.max(startCumulative, slotStart);
        const contributionEnd = Math.min(cumulativeBubbles, slotEnd);
        const contribution = contributionEnd - contributionStart;
        
        if (contribution > 0) {
          slotSupporters[slotNum].add(tx.fromUserId);
        }
      }
    }

    for (let slotNum = 1; slotNum <= queueSlots; slotNum++) {
      const slotProgressValue = parseInt(slotProgress[slotNum] || 0);
      const supporterCount = slotSupporters[slotNum]?.size || 0;
      
      if (slotProgressValue < requiredBubbles) {
        const queueProgressPercent = requiredBubbles > 0 ? Math.round((slotProgressValue / requiredBubbles) * 100) : 0;
        const locationDisplay = currentUser.area && currentUser.city 
          ? `${currentUser.area}, ${currentUser.city}` 
          : (currentUser.city || currentUser.area || 'Unknown');
        const description = `Queue #${slotNum} • ${slotProgressValue}/${requiredBubbles} (${queueProgressPercent}%) • ${locationDisplay}`;
        
        console.log('Backend - Creating card for slot:', {
          slotNumber: slotNum,
          slotProgress: slotProgressValue,
          requiredBubbles,
          supporterCount,
          queuePosition: currentUser.queuePosition,
          locationDisplay
        });

        cards.push({
          id: `active-slot-${slotNum}`,
          userId: currentUser.id,
          userName: currentUser.name,
          bubbleAmount: currentUser.bubblesCount,
          queuePosition: currentUser.queuePosition,
          queueProgress: slotProgressValue,
          queueRequired: requiredBubbles,
          queueProgressPercent: queueProgressPercent,
          slotNumber: slotNum,
          supporterCount: supporterCount,
          isOwnCard: true,
          creatorColor: currentUser.color || '#f59e0b',
          area: currentUser.area,
          city: currentUser.city,
          locationDisplay: locationDisplay,
          description: description,
          createdAt: slotFirstTransaction[slotNum] ? slotFirstTransaction[slotNum] : new Date().toISOString()
        });
      }
    }

    cards.sort((a, b) => a.slotNumber - b.slotNumber);

    console.log(`Backend - Found ${cards.length} incomplete slots for user ${currentUser.id}`);
    res.json(cards);
  } catch (error) {
    console.error('Backend - Incomplete queue error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/supporters/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { slotNumber, location } = req.query;
    console.log('Backend - Getting supporters for user:', userId, 'Slot:', slotNumber, 'Location:', location);

    const transactions = await BubbleTransaction.findAll({
      where: {
        toUserId: parseInt(userId),
        status: 'completed'
      },
      order: [['createdAt', 'ASC']],
      raw: true
    });

    const supporterMap = new Map();
    let cumulativeBubbles = 0;

    for (const tx of transactions) {
      const supporterId = tx.fromUserId;
      
      if (!supporterMap.has(supporterId)) {
        const supporter = await User.findByPk(supporterId, {
          attributes: ['id', 'name', 'area', 'city']
        });
        
        if (supporter) {
          supporterMap.set(supporterId, {
            id: supporter.id,
            name: supporter.name,
            avatar: supporter.name.charAt(0).toUpperCase(),
            location: `${supporter.area || supporter.city || 'Unknown'}`,
            city: supporter.city,
            area: supporter.area,
            totalSupported: 0,
            supportCount: 0,
            transactions: [],
            firstSupport: tx.createdAt,
            lastSupport: tx.createdAt
          });
        }
      }

      const supporterData = supporterMap.get(supporterId);
      if (supporterData) {
        supporterData.totalSupported += tx.bubbleAmount;
        supporterData.supportCount += 1;
        supporterData.lastSupport = tx.createdAt;
        
        supporterData.transactions.push({
          amount: tx.bubbleAmount,
          cumulativeStart: cumulativeBubbles,
          cumulativeEnd: cumulativeBubbles + tx.bubbleAmount,
          date: tx.createdAt
        });
        
        cumulativeBubbles += tx.bubbleAmount;
      }
    }

    let supporters = Array.from(supporterMap.values());
    console.log(`Backend - Before filter: ${supporters.length} total supporters`);

    if (location && location !== 'All') {
      console.log(`Backend - Applying location filter: "${location}"`);
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar', 'Sukkur', 'Larkana', 'Mirpurkhas', 'Gwadar', 'Turbat', 'Khuzdar', 'Mardan', 'Abbottabad', 'Swat', 'Gujranwala', 'Sialkot'];
      
      const isCity = knownCities.includes(location);
      console.log(`Backend - Is "${location}" a known city? ${isCity}`);
      
      supporters = supporters.filter(supporter => {
        const match = isCity ? supporter.city === location : supporter.area === location;
        console.log(`Backend - Supporter ${supporter.name} (${supporter.area}, ${supporter.city}) - Match: ${match}`);
        return match;
      });
      
      console.log(`Backend - After filter: ${supporters.length} supporters from location: ${location}`);
    } else {
      console.log(`Backend - No location filter applied (location: "${location}")`);
    }

    if (slotNumber) {
      const slot = parseInt(slotNumber);
      const slotStart = (slot - 1) * 400;
      const slotEnd = slot * 400;

      const slotSupporters = [];

      for (const supporter of supporters) {
        let slotContribution = 0;

        for (const tx of supporter.transactions) {
          const txStart = tx.cumulativeStart;
          const txEnd = tx.cumulativeEnd;

          if (txEnd > slotStart && txStart < slotEnd) {
            const contributionStart = Math.max(txStart, slotStart);
            const contributionEnd = Math.min(txEnd, slotEnd);
            const contribution = contributionEnd - contributionStart;
            if (contribution > 0) {
              slotContribution += contribution;
            }
          }
        }

        if (slotContribution > 0) {
          slotSupporters.push({
            id: supporter.id,
            name: supporter.name,
            avatar: supporter.avatar,
            location: supporter.location,
            totalSupported: slotContribution,
            supportCount: supporter.supportCount,
            originalTotal: supporter.totalSupported,
            slotContribution: slotContribution,
            firstSupport: supporter.firstSupport,
            lastSupport: supporter.lastSupport
          });
        }
      }

      supporters = slotSupporters;
    } else {
      const user = await User.findByPk(userId);
      if (user) {
        const totalReceived = transactions.reduce((sum, tx) => sum + tx.bubbleAmount, 0);
        const completedSlots = Math.floor(totalReceived / 400);
        const totalCompleted = completedSlots * 400;
        const inProgress = totalReceived % 400;
        
        if (inProgress > 0) {
          const adjustedSupporters = [];
          
          for (const supporter of supporters) {
            let adjustedTotal = 0;
            
            for (const tx of supporter.transactions) {
              if (tx.cumulativeEnd <= totalCompleted) {
                adjustedTotal += tx.amount;
              } else if (tx.cumulativeStart < totalCompleted) {
                adjustedTotal += totalCompleted - tx.cumulativeStart;
              }
            }
            
            if (adjustedTotal > 0) {
              adjustedSupporters.push({
                id: supporter.id,
                name: supporter.name,
                avatar: supporter.avatar,
                location: supporter.location,
                totalSupported: adjustedTotal,
                supportCount: supporter.supportCount,
                firstSupport: supporter.firstSupport,
                lastSupport: supporter.lastSupport
              });
            }
          }
          
          supporters = adjustedSupporters;
        }
      }
    }
   
    supporters.sort((a, b) => b.totalSupported - a.totalSupported);

    console.log(`Backend - Returning ${supporters.length} supporters`);
    res.json(supporters);
  } catch (error) {
    console.error('Backend - Get supporters error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/completed-separate', async (req, res) => {
  try {
    console.log('Backend - Getting separate completed transactions for user:', req.user.id);
    
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const receivedTransactions = await BubbleTransaction.findAll({
      where: {
        toUserId: req.user.id,
        status: 'completed'
      },
      order: [['updatedAt', 'ASC']]
    });

    const totalReceived = receivedTransactions.reduce((sum, tx) => sum + tx.bubbleAmount, 0);
    const completedSlots = Math.floor(totalReceived / 400);
    
    const separateCards = [];
    let bubbleCounter = 0;
    let txIndex = 0;
    
    for (let i = 0; i < completedSlots; i++) {
      const slotEnd = (i + 1) * 400;
      let slotCompletedDate = null;
      
      while (bubbleCounter < slotEnd && txIndex < receivedTransactions.length) {
        const tx = receivedTransactions[txIndex];
        bubbleCounter += tx.bubbleAmount;
        txIndex++;
        
        if (bubbleCounter >= slotEnd) {
          slotCompletedDate = tx.updatedAt || tx.createdAt;
          break;
        }
      }
      
      separateCards.push({
        id: `completed-slot-${i}`,
        userId: currentUser.id,
        userName: currentUser.name,
        bubbleAmount: 400,
        slotNumber: i + 1,
        totalBubbles: 400,
        creatorColor: '#10b981',
        description: `Completed Queue Slot #${i + 1} • 400 bubbles`,
        status: 'completed',
        isCompleted: true,
        createdAt: slotCompletedDate,
        updatedAt: slotCompletedDate
      });
    }

    res.json(separateCards);
  } catch (error) {
    console.error('Backend - Separate completed error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/completed-cumulative', async (req, res) => {
  try {
    console.log('Backend - Getting cumulative completed for user:', req.user.id);
    const { location } = req.query; // Add location parameter
    
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get received transactions
    const receivedTransactions = await BubbleTransaction.findAll({
      where: {
        toUserId: req.user.id,
        status: 'completed'
      }
    });

    const totalReceived = receivedTransactions.reduce((sum, tx) => sum + tx.bubbleAmount, 0);
    const completedSlots = Math.floor(totalReceived / 400);
    const totalCompleted = completedSlots * 400;
    const inProgress = totalReceived % 400;

    if (totalCompleted === 0) {
      return res.json([]);
    }

    // Get all supporters with their individual contributions
    const supporterMap = new Map();
    for (const tx of receivedTransactions) {
      const supporterId = tx.fromUserId;
      
      if (!supporterMap.has(supporterId)) {
        const supporter = await User.findByPk(supporterId, {
          attributes: ['id', 'name', 'area', 'city', 'country', 'province']
        });
        
        if (supporter) {
          supporterMap.set(supporterId, {
            id: supporter.id,
            name: supporter.name,
            avatar: supporter.name.charAt(0).toUpperCase(),
            location: `${supporter.area || ''} ${supporter.city || ''}`.trim() || 'Unknown',
            city: supporter.city,
            area: supporter.area,
            country: supporter.country,
            province: supporter.province,
            totalSupported: 0,
            supportCount: 0,
            firstSupport: tx.createdAt,
            lastSupport: tx.createdAt
          });
        }
      }

      const supporterData = supporterMap.get(supporterId);
      if (supporterData) {
        supporterData.totalSupported += tx.bubbleAmount;
        supporterData.supportCount += 1;
        supporterData.lastSupport = tx.createdAt;
      }
    }

    let supporters = Array.from(supporterMap.values());
    
    // Apply location filter if provided
    if (location && location !== 'All') {
      console.log(`Backend - Applying location filter to supporters: "${location}"`);
      
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar', 'Sukkur', 'Larkana', 'Mirpurkhas', 'Gwadar', 'Turbat', 'Khuzdar', 'Mardan', 'Abbottabad', 'Swat', 'Gujranwala', 'Sialkot'];
      const knownAreas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Gulberg', 'Johar Town', 'Model Town', 'Latifabad', 'Qasimabad', 'Cantonment', 'Hussainabad', 'F-6', 'F-7', 'F-8', 'G-6', 'G-7', 'Blue Area'];
      
      const isCity = knownCities.includes(location);
      
      supporters = supporters.filter(supporter => {
        if (isCity) {
          return supporter.city === location;
        } else {
          // Check area or any location field
          return supporter.area === location || 
                 supporter.city === location || 
                 supporter.province === location ||
                 supporter.country === location;
        }
      });
      
      console.log(`Backend - After filter: ${supporters.length} supporters from location: ${location}`);
    }

    supporters.sort((a, b) => b.totalSupported - a.totalSupported);

    // Calculate filtered totals
    const filteredTotalSupport = supporters.reduce((sum, s) => sum + s.totalSupported, 0);
    const filteredTotalSupporters = supporters.length;

    res.json([{
      id: 'cumulative-total',
      userId: currentUser.id,
      userName: currentUser.name,
      bubbleAmount: totalCompleted,
      completedSlots: completedSlots,
      inProgressBubbles: inProgress,
      totalReceived: totalReceived,
      creatorColor: '#10b981',
      description: `${completedSlots} Completed Slots • ${totalCompleted} bubbles`,
      status: 'completed',
      isCumulative: true,
      // Add filtered supporters data
      supporters: supporters,
      totalSupporters: filteredTotalSupporters,
      totalSupport: filteredTotalSupport,
      // Include location filter info
      locationFilter: location || 'All'
    }]);
  } catch (error) {
    console.error('Backend - Cumulative completed error:', error);
    res.status(400).json({ message: error.message });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    console.log('Backend - Getting leaderboard, limit:', limit);
    
    const supportStats = await BubbleTransaction.findAll({
      where: { 
        status: 'completed',
        type: 'support'
      },
      attributes: [
        'fromUserId',
        [literal('SUM(bubbleAmount)'), 'totalSupported'],
        [literal('COUNT(*)'), 'supportCount'],
        [literal('SUM(slotsOpened)'), 'totalSlotsOpened']
      ],
      group: ['fromUserId'],
      order: [[literal('totalSupported'), 'DESC']],
      limit: parseInt(limit),
      raw: true
    });
    
    console.log(`Backend - Found ${supportStats.length} supporters with stats:`, supportStats);
    
    const leaderboard = [];
    for (let i = 0; i < supportStats.length; i++) {
      const stat = supportStats[i];
      const user = await User.findByPk(stat.fromUserId, {
        attributes: ['id', 'name', 'email', 'country', 'province', 'city', 'area', 'queuePosition', 'queueSlots']
      });
      
      if (user) {
        const totalSupported = parseInt(stat.totalSupported);
        const supportCount = parseInt(stat.supportCount);
        const totalSlotsOpened = parseInt(stat.totalSlotsOpened) || 0;
        
        let level = 'Bronze';
        let gradient = ['#CD7F32', '#B8860B'];
        if (totalSupported >= 5000) {
          level = 'Diamond';
          gradient = ['#b9f2ff', '#667eea'];
        } else if (totalSupported >= 3000) {
          level = 'Platinum';
          gradient = ['#E5E4E2', '#C0C0C0'];
        } else if (totalSupported >= 1500) {
          level = 'Gold';
          gradient = ['#FFD700', '#FFA500'];
        } else if (totalSupported >= 500) {
          level = 'Silver';
          gradient = ['#C0C0C0', '#A8A8A8'];
        }
        
        const locationParts = [];
        if (user.area) locationParts.push(user.area);
        if (user.city && user.city !== user.area) locationParts.push(user.city);
        const location = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown';
        
        leaderboard.push({
          id: user.id,
          name: user.name,
          avatar: user.name.charAt(0).toUpperCase(),
          rank: i + 1,
          points: totalSupported,
          totalSupported: totalSupported,
          supportCount: supportCount,
          totalSlotsOpened: totalSlotsOpened,
          level: level,
          gradient: gradient,
          queuePosition: user.queuePosition,
          queueSlots: user.queueSlots,
          location: location,
          country: user.country,
          province: user.province,
          city: user.city,
          area: user.area
        });
      }
    }
    
    console.log(`Backend - Returning ${leaderboard.length} leaderboard entries`);
    res.json(leaderboard);
  } catch (error) {
    console.error('Backend - Leaderboard error:', error);
    res.status(400).json({ message: error.message || 'Failed to get leaderboard' });
  }
});

router.get('/active', async (req, res) => {
  try {
    const transactions = await BubbleTransaction.findAll({
      where: { 
        toUserId: req.user.id,
        status: 'completed'
      },
      attributes: [
        'fromUserId',
        [literal('SUM(bubbleAmount)'), 'totalSupported'],
        [literal('COUNT(*)'), 'supportCount']
      ],
      group: ['fromUserId'],
      order: [[literal('totalSupported'), 'DESC']],
      raw: true
    });
    
    const enriched = [];
    for (const tx of transactions) {
      const supporter = await User.findByPk(tx.fromUserId);
      enriched.push({
        userId: tx.fromUserId,
        userName: supporter?.name || 'Unknown',
        bubbleAmount: parseInt(tx.totalSupported),
        supportCount: parseInt(tx.supportCount),
        description: `Supported you ${tx.supportCount} times`
      });
    }
    
    res.json(enriched);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/completed-individual', async (req, res) => {
  try {
    const transactions = await BubbleTransaction.findAll({
      where: {
        [Op.or]: [
          { fromUserId: req.user.id },
          { toUserId: req.user.id }
        ],
        status: 'completed'
      },
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    
    const enriched = [];
    for (const tx of transactions) {
      const otherUser = await User.findByPk(
        tx.fromUserId === req.user.id ? tx.toUserId : tx.fromUserId
      );
      
      let description;
      if (tx.type === 'donation') {
        description = tx.toUserId === req.user.id 
          ? `Received ${tx.bubbleAmount} bubbles - Free Giveaway`
          : `Sent ${tx.bubbleAmount} bubbles - Free Giveaway`;
      } else {
        description = tx.toUserId === req.user.id 
          ? `Received ${tx.bubbleAmount} bubbles`
          : `Sent ${tx.bubbleAmount} bubbles`;
      }
      
      enriched.push({
        id: tx.id,
        userId: otherUser?.id,
        userName: otherUser?.name || 'Unknown',
        bubbleAmount: tx.bubbleAmount,
        isReceived: tx.toUserId === req.user.id,
        createdAt: tx.createdAt,
        type: tx.type,
        description: description
      });
    }
    
    res.json(enriched);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/completed', async (req, res) => {
  try {
    console.log('Backend - Getting completed transactions for user:', req.user.id);
    
    // Get ALL transactions (not grouped)
    const allTransactions = await BubbleTransaction.findAll({
      where: {
        [Op.or]: [
          { fromUserId: req.user.id },
          { toUserId: req.user.id }
        ],
        status: 'completed'
      },
      order: [['createdAt', 'DESC']],
      limit: 100,
      raw: true
    });
    
    console.log(`Backend - Found ${allTransactions.length} individual transactions`);
    
    const enrichedTransactions = [];
    
    for (const transaction of allTransactions) {
      const isSent = transaction.fromUserId === req.user.id;
      const otherUserId = isSent ? transaction.toUserId : transaction.fromUserId;
      
      const otherUser = await User.findByPk(otherUserId, {
        attributes: ['id', 'name']
      });
      
      let description = '';
      let type = transaction.type;
      let isDonation = type === 'donation';
      
      if (type === 'transfer' && transaction.description && transaction.description.includes('Giveaway')) {
        isDonation = true;
        type = 'donation';
        
        // For giveaway distributions (user received)
        if (!isSent) {
          description = 'Free Giveaway';
        } 
        // For giveaway donations (user donated)
        else {
          description = 'Donated to Giveaway';
        }
      } else if (type === 'donation') {
        description = 'Free Giveaway';
      } else if (type === 'support') {
        description = isSent 
          ? `Sent ${transaction.bubbleAmount} bubbles`
          : `Received ${transaction.bubbleAmount} bubbles`;
      }
      
      // Add transaction count information (always 1 for individual transactions)
      const transactionCount = 1;
      
      enrichedTransactions.push({
        id: transaction.id, // Use actual transaction ID
        userId: otherUserId,
        userName: otherUser ? otherUser.name : 'Unknown User',
        bubbleAmount: transaction.bubbleAmount,
        transactionCount: transactionCount,
        creatorColor: isDonation ? '#f59e0b' : (isSent ? '#f59e0b' : '#10b981'),
        description: description,
        status: 'completed',
        type: type,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        isReceived: !isSent,
        isDonation: isDonation,
        // For support transactions, show "to/from" info
        isSupport: type === 'support',
        targetSlotNumber: transaction.targetSlotNumber // Keep slot info if available
      });
    }
    
    console.log(`Backend - Returning ${enrichedTransactions.length} individual transactions`);
    res.json(enrichedTransactions);
  } catch (error) {
    console.error('Backend - Completed transactions error:', error);
    res.status(400).json({ message: error.message || 'Failed to get completed transactions' });
  }
});

router.get('/transaction-details/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { type = 'both' } = req.query;
    
    console.log('Backend - Getting transaction details:', { userId, type, requesterId: req.user.id });
    
    let whereConditions = [];
    
    if (type === 'sent' || type === 'both') {
      whereConditions.push({
        fromUserId: req.user.id,
        toUserId: parseInt(userId),
        status: 'completed'
      });
    }
    
    if (type === 'received' || type === 'both') {
      whereConditions.push({
        fromUserId: parseInt(userId),
        toUserId: req.user.id,
        status: 'completed'
      });
    }
    
    const transactions = await BubbleTransaction.findAll({
      where: {
        [Op.or]: whereConditions
      },
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    
    const otherUser = await User.findByPk(userId, {
      attributes: ['id', 'name', 'bubbleGoal', 'bubblesReceived', 'goalActive']
    });
    
    const detailedTransactions = transactions.map(transaction => ({
      id: transaction.id,
      bubbleAmount: transaction.bubbleAmount,
      type: transaction.fromUserId === req.user.id ? 'sent' : 'received',
      createdAt: transaction.createdAt,
      description: transaction.fromUserId === req.user.id 
        ? `Sent ${transaction.bubbleAmount} bubbles`
        : `Received ${transaction.bubbleAmount} bubbles`
    }));
    
    const summary = {
      totalSent: transactions
        .filter(t => t.fromUserId === req.user.id)
        .reduce((sum, t) => sum + t.bubbleAmount, 0),
      totalReceived: transactions
        .filter(t => t.toUserId === req.user.id)
        .reduce((sum, t) => sum + t.bubbleAmount, 0),
      transactionCount: transactions.length
    };
    
    res.json({
      otherUser: otherUser ? {
        id: otherUser.id,
        name: otherUser.name,
        goalInfo: {
          goal: otherUser.bubbleGoal,
          received: otherUser.bubblesReceived,
          active: otherUser.goalActive
        }
      } : null,
      summary,
      transactions: detailedTransactions
    });
  } catch (error) {
    console.error('Backend - Transaction details error:', error);
    res.status(400).json({ message: error.message || 'Failed to get transaction details' });
  }
});

router.post('/support', async (req, res) => {
  try {
    const { toUserId, bubbleAmount, targetSlotNumber } = req.body;
    
    console.log('Backend - Support request:', { 
      fromUserId: req.user.id, 
      toUserId, 
      bubbleAmount,
      targetSlotNumber 
    });
    
    if (!toUserId || !bubbleAmount) {
      return res.status(400).json({ message: 'User ID and bubble amount are required' });
    }
    
    if (bubbleAmount <= 0) {
      return res.status(400).json({ message: 'Bubble amount must be positive' });
    }
    
    if (toUserId == req.user.id) {
      return res.status(400).json({ message: 'Cannot support yourself' });
    }

    if (!targetSlotNumber || targetSlotNumber <= 0) {
      return res.status(400).json({ message: 'Target slot number is required' });
    }
    
    const fromUser = await User.findByPk(req.user.id);
    const toUser = await User.findByPk(toUserId);
    
    if (!fromUser) {
      return res.status(404).json({ message: 'Your account not found' });
    }
    
    if (!toUser) {
      return res.status(404).json({ message: 'Target user not found' });
    }
    
    if (fromUser.bubblesCount < bubbleAmount) {
      return res.status(400).json({ 
        message: `Insufficient bubbles. You have ${fromUser.bubblesCount}, trying to send ${bubbleAmount}` 
      });
    }

    if (targetSlotNumber > toUser.queueSlots) {
      return res.status(400).json({ 
        message: `Invalid slot. User only has ${toUser.queueSlots} slots (you tried slot ${targetSlotNumber})` 
      });
    }
    
    if (fromUser.queuePosition === 0) {
      if (toUser.queuePosition !== 1) {
        return res.status(400).json({ 
          message: 'You can only support the user at Queue Position #1. Support them first to join the queue!' 
        });
      }
    } else {
      if (toUser.queuePosition === 0 || toUser.queuePosition >= fromUser.queuePosition) {
        return res.status(400).json({ 
          message: 'You can only support users above you in the queue (with lower queue positions)' 
        });
      }
    }
    
    console.log('Queue validation passed:', {
      fromUserQueue: fromUser.queuePosition,
      toUserQueue: toUser.queuePosition,
      targetSlot: targetSlotNumber,
      canSupport: true
    });

    let slotProgress = {};
    if (toUser.slotProgress) {
      if (typeof toUser.slotProgress === 'string') {
        slotProgress = JSON.parse(toUser.slotProgress);
      } else {
        slotProgress = toUser.slotProgress;
      }
    }

    const slotKey = targetSlotNumber.toString();
    const currentProgress = parseInt(slotProgress[slotKey] || 0);
    const newProgress = currentProgress + bubbleAmount;
    const requiredPerSlot = 400;

    console.log(`BEFORE UPDATE - Slot ${targetSlotNumber}: ${currentProgress} + ${bubbleAmount} = ${newProgress} / ${requiredPerSlot}`);

    fromUser.bubblesCount -= bubbleAmount;
    
    slotProgress[slotKey] = newProgress;

    console.log(`AFTER UPDATE - slotProgress object:`, slotProgress);

    let slotCompleted = false;
    let bubblesEarned = 0;

    if (newProgress >= requiredPerSlot) {
      slotCompleted = true;
      bubblesEarned = requiredPerSlot;
      
      slotProgress[slotKey] = newProgress - requiredPerSlot;
      
      if (slotProgress[slotKey] === 0) {
        delete slotProgress[slotKey];
      }

      toUser.bubblesCount += bubblesEarned;
      
      toUser.queueSlots = Math.max(0, toUser.queueSlots - 1);
      
      if (toUser.queueSlots === 0) {
        toUser.queuePosition = 0;
        toUser.queueBubbles = 0;
        slotProgress = {};
        console.log(`${toUser.name} completed all queue slots, removed from queue`);
      }
      
      console.log(`Slot ${targetSlotNumber} completed! User earned ${bubblesEarned} bubbles. Remaining slots: ${toUser.queueSlots}`);
    }

    toUser.slotProgress = JSON.stringify(slotProgress);
    
    console.log(`SAVING to DB - slotProgress:`, toUser.slotProgress);
    
    const queueSlotsToOpen = Math.floor(bubbleAmount / 100);
    
    console.log(`Supporter gave ${bubbleAmount} bubbles, opening ${queueSlotsToOpen} queue slots`);
    
    if (queueSlotsToOpen > 0) {
      const allUsers = await User.findAll({
        where: {
          queuePosition: { [Op.gt]: 0 }
        },
        attributes: ['id', 'queuePosition', 'queueSlots'],
        order: [['queuePosition', 'DESC']]
      });
      
      let absoluteHighestPosition = 0;
      for (const u of allUsers) {
        const userMaxPosition = u.queuePosition + (u.queueSlots - 1);
        if (userMaxPosition > absoluteHighestPosition) {
          absoluteHighestPosition = userMaxPosition;
        }
      }
      
      console.log(`Absolute highest queue position: ${absoluteHighestPosition}`);
      
      if (fromUser.queuePosition === 0) {
        fromUser.queuePosition = absoluteHighestPosition + 1;
        fromUser.queueSlots = queueSlotsToOpen;
        
        const supporterSlotProgress = {};
        for (let i = 1; i <= queueSlotsToOpen; i++) {
          supporterSlotProgress[i.toString()] = 0;
        }
        fromUser.slotProgress = JSON.stringify(supporterSlotProgress);
        
        console.log(`Supporter added to queue at position ${fromUser.queuePosition} with ${queueSlotsToOpen} slots`);
      } else {
        const currentSlots = fromUser.queueSlots;
        fromUser.queueSlots += queueSlotsToOpen;
        
        let supporterSlotProgress = {};
        if (fromUser.slotProgress) {
          if (typeof fromUser.slotProgress === 'string') {
            supporterSlotProgress = JSON.parse(fromUser.slotProgress);
          } else {
            supporterSlotProgress = fromUser.slotProgress;
          }
        }
        
        for (let i = currentSlots + 1; i <= fromUser.queueSlots; i++) {
          supporterSlotProgress[i.toString()] = 0;
        }
        fromUser.slotProgress = JSON.stringify(supporterSlotProgress);
        
        console.log(`Supporter now has ${fromUser.queueSlots} total queue slots`);
      }
    }
    
    await fromUser.save();
    await toUser.save();
    
    console.log('✅ Both users saved to database');
    
    if (slotCompleted) {
      await rebalanceQueuePositions();
    }
    
    const transaction = await BubbleTransaction.create({
      fromUserId: req.user.id,
      toUserId: parseInt(toUserId),
      bubbleAmount: bubbleAmount,
      targetSlotNumber: targetSlotNumber,
      type: 'support',
      status: 'completed',
      queuePosition: fromUser.queuePosition,
      slotsOpened: queueSlotsToOpen
    });
    
    console.log('Support transaction created:', transaction.id);
    
    const updatedToUser = await User.findByPk(toUserId);
    let updatedSlotProgress = {};
    if (updatedToUser.slotProgress) {
      if (typeof updatedToUser.slotProgress === 'string') {
        updatedSlotProgress = JSON.parse(updatedToUser.slotProgress);
      } else {
        updatedSlotProgress = updatedToUser.slotProgress;
      }
    }

    console.log('✅ Fresh data from DB - slotProgress:', updatedSlotProgress);

    const responseData = {
      message: slotCompleted 
        ? `Slot ${targetSlotNumber} completed! ${toUser.name} earned ${bubblesEarned} bubbles!` 
        : `Supported slot ${targetSlotNumber}: ${newProgress}/${requiredPerSlot}`,
      slotCompleted: slotCompleted,
      slotNumber: targetSlotNumber,
      slotProgress: parseInt(updatedSlotProgress[slotKey] || 0),
      totalSlotProgress: newProgress,
      supporterJoinedQueue: fromUser.queuePosition > 0,
      supporterQueuePosition: fromUser.queuePosition,
      queueSlotsOpened: queueSlotsToOpen,
      supporterTotalSlots: fromUser.queueSlots,
      transaction: transaction,
      user: {
        id: fromUser.id,
        name: fromUser.name,
        email: fromUser.email,
        bubblesCount: parseInt(fromUser.bubblesCount),
        queuePosition: fromUser.queuePosition,
        queueBubbles: fromUser.queueBubbles,
        queueSlots: fromUser.queueSlots
      },
      receiverData: {
        id: updatedToUser.id,
        name: updatedToUser.name,
        bubblesCount: parseInt(updatedToUser.bubblesCount),
        queueSlots: updatedToUser.queueSlots,
        queuePosition: updatedToUser.queuePosition,
        slotProgress: updatedSlotProgress
      }
    };
    
    console.log('✅ Support response:', responseData);
    res.json(responseData);
  } catch (error) {
    console.error('Backend - Support error:', error);
    res.status(400).json({ message: error.message || 'Support failed' });
  }
});

router.post('/set-goal', async (req, res) => {
  try {
    const { bubbleGoal, goalDescription } = req.body;
    
    console.log('Backend - Set goal request:', { userId: req.user.id, bubbleGoal, goalDescription });
    
    if (!bubbleGoal || bubbleGoal <= 0) {
      return res.status(400).json({ message: 'Valid bubble goal is required (must be > 0)' });
    }
    
    if (bubbleGoal > 10000) {
      return res.status(400).json({ message: 'Bubble goal too high (max 10,000)' });
    }
    
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (user.goalActive && user.bubbleGoal > 0) {
      return res.status(400).json({ 
        message: 'You already have an active goal. Complete or cancel it first.' 
      });
    }
    
    user.bubbleGoal = parseInt(bubbleGoal);
    user.bubblesReceived = 0;
    user.goalDescription = goalDescription || `Help me reach ${bubbleGoal} bubbles!`;
    user.goalActive = true;
    
    await user.save();
    
    console.log(`Backend - Goal set for user ${user.name}: ${bubbleGoal} bubbles`);
    
    res.json({
      message: 'Goal set successfully',
      goal: {
        bubbleGoal: user.bubbleGoal,
        goalDescription: user.goalDescription,
        bubblesReceived: user.bubblesReceived,
        remaining: user.bubbleGoal - user.bubblesReceived,
        active: user.goalActive
      }
    });
  } catch (error) {
    console.error('Backend - Set goal error:', error);
    res.status(400).json({ message: error.message || 'Failed to set goal' });
  }
});

router.post('/cancel-goal', async (req, res) => {
  try {
    console.log('Backend - Cancel goal request for user:', req.user.id);
    
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (!user.goalActive) {
      return res.status(400).json({ message: 'No active goal to cancel' });
    }
    
    const wasCompleted = user.bubblesReceived >= user.bubbleGoal;
    
    if (wasCompleted) {
      user.bubblesCount = parseInt(user.bubblesCount) + parseInt(user.bubbleGoal);
    }
    
    user.goalActive = false;
    user.bubbleGoal = 0;
    user.bubblesReceived = 0;
    user.goalDescription = null;
    
    await user.save();
    
    console.log(`Backend - Goal ${wasCompleted ? 'completed' : 'cancelled'} for user ${user.name}`);
    
    res.json({
      message: wasCompleted ? 'Goal completed successfully!' : 'Goal cancelled',
      completed: wasCompleted,
      bubblesEarned: wasCompleted ? user.bubbleGoal : 0,
      currentBubbles: user.bubblesCount
    });
  } catch (error) {
    console.error('Backend - Cancel goal error:', error);
    res.status(400).json({ message: error.message || 'Failed to cancel goal' });
  }
});

router.get('/my-goal', async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'bubbleGoal', 'bubblesReceived', 'goalDescription', 'goalActive', 'bubblesCount']
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const goalData = {
      hasActiveGoal: user.goalActive,
      bubbleGoal: user.bubbleGoal,
      bubblesReceived: user.bubblesReceived,
      remaining: Math.max(0, user.bubbleGoal - user.bubblesReceived),
      progress: user.bubbleGoal > 0 ? Math.round((user.bubblesReceived / user.bubbleGoal) * 100) : 0,
      goalDescription: user.goalDescription,
      currentBubbles: user.bubblesCount,
      isCompleted: user.bubblesReceived >= user.bubbleGoal && user.bubbleGoal > 0
    };
    
    res.json(goalData);
  } catch (error) {
    console.error('Backend - Get goal error:', error);
    res.status(400).json({ message: error.message || 'Failed to get goal' });
  }
});

// Update the /giveaway/donate route to accept location parameter
router.post('/giveaway/donate', async (req, res) => {
  const { category, bubbles, location } = req.body; // Added location parameter
  const userId = req.user?.id;

  console.log('🎁 Giveaway donation request with location:', { 
    userId, 
    category, 
    bubbles,
    location 
  });

  if (!userId) return res.status(401).json({ message: 'User not authenticated' });
  if (!category || !bubbles || bubbles <= 0)
    return res.status(400).json({ message: 'category, bubbles (>0) required' });

  const t = await sequelize.transaction();
  try {
    console.log(`\n🎁 GIVEAWAY DONATION START`);
    console.log(`   Donor: User ${userId}`);
    console.log(`   Category: ${category}`);
    console.log(`   Location Filter: ${location || 'All'}`);
    console.log(`   Donation: ${bubbles} bubbles`);

    const donor = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!donor) throw new Error('Donor not found');
    if (donor.bubblesCount < bubbles)
      throw new Error(`Insufficient bubbles. You have ${donor.bubblesCount}, trying to donate ${bubbles}`);

    const giveaway = await Giveaway.findOne({
      where: { category, distributed: false },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!giveaway) {
      await t.rollback();
      return res.status(400).json({ message: `No active ${category} giveaway. Admin hasn't set it up yet.` });
    }

    const amountPerUser = giveaway.amountPerUser;
    if (amountPerUser <= 0) throw new Error('Invalid giveaway amount per user');

    console.log(`   Amount per user: ${amountPerUser}`);

    donor.bubblesCount -= bubbles;
    await donor.save({ transaction: t });
    console.log(`   ✅ Deducted ${bubbles} from donor. New balance: ${donor.bubblesCount}`);

    await BubbleTransaction.create({
      fromUserId: userId,
      toUserId: userId,
      bubbleAmount: bubbles,
      type: 'donation',
      status: 'completed',
      giveaway: 1,
      description: `Donated ${bubbles} bubbles to ${category} Giveaway${location && location !== 'All' ? ` (${location})` : ''}`,
    }, { transaction: t });
    console.log(`   ✅ Recorded donation transaction`);

    // Build query with location filter
    let eligibleUsersQuery = `
      SELECT u.id, u.name, u.createdAt, u.area, u.city,
             COALESCE(SUM(bt.bubbleAmount), 0) AS totalDonated
      FROM users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1 
        AND u.id != :donorId
        AND bt.type IN ('support', 'donation', 'transfer')
        AND bt.status = 'completed'
        AND (bt.giveaway = 0 OR bt.giveaway IS NULL)
    `;

    // Add location filter if provided
    if (location && location !== 'All') {
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar'];
      const knownAreas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Gulberg', 'Johar Town', 'Model Town'];
      
      if (knownCities.includes(location)) {
        eligibleUsersQuery += ` AND u.city = :location `;
      } else if (knownAreas.includes(location)) {
        eligibleUsersQuery += ` AND u.area = :location `;
      } else {
        eligibleUsersQuery += ` AND (u.city = :location OR u.area = :location) `;
      }
    }

    eligibleUsersQuery += `
      GROUP BY u.id, u.name, u.createdAt, u.area, u.city
      ORDER BY totalDonated DESC, u.createdAt ASC
    `;

    const eligibleUsers = await sequelize.query(eligibleUsersQuery, {
      replacements: { 
        donorId: userId,
        ...(location && location !== 'All' ? { location } : {})
      },
      type: sequelize.QueryTypes.SELECT,
      transaction: t,
    });

    const eligibleCount = eligibleUsers.length;

    if (eligibleCount === 0) {
      await t.rollback();
      return res.status(400).json({ 
        message: location && location !== 'All' 
          ? `No eligible users found in ${location}. Try selecting a different location or 'All'.`
          : 'No eligible users found.'
      });
    }

    console.log(`   📊 Found ${eligibleCount} eligible users in ${location || 'all locations'}`);

    // Rest of the distribution logic remains the same...
    let remaining = bubbles;
    const recipientMap = new Map();
    let round = 1;
    let userIndex = 0;

    while (remaining > 0 && eligibleUsers.length > 0) {
      const user = eligibleUsers[userIndex];
      const giveAmount = remaining >= amountPerUser ? amountPerUser : remaining;

      if (!recipientMap.has(user.id)) {
        recipientMap.set(user.id, { ...user, totalReceived: 0 });
      }

      recipientMap.get(user.id).totalReceived += giveAmount;
      remaining -= giveAmount;

      console.log(`   🎯 Round ${round} → ${user.name} (${user.city}/${user.area}) +${giveAmount}, Remaining: ${remaining}`);

      userIndex++;
      if (userIndex >= eligibleUsers.length) {
        userIndex = 0;
        round++;
      }
    }

    console.log(`\n✅ Distribution finished in ${round - 1} rounds`);
    console.log(`   Remaining: ${remaining} (should be 0)`);

    const finalTransactions = [];
    const updates = [];
    const recipientsList = [];

    let totalDistributed = 0;
    for (const [id, data] of recipientMap) {
      finalTransactions.push({
        fromUserId: userId,
        toUserId: id,
        bubbleAmount: data.totalReceived,
        type: 'transfer',
        status: 'completed',
        giveaway: 1,
        description: `${category} Giveaway Distribution${location && location !== 'All' ? ` (${location})` : ''}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      updates.push(`WHEN ${id} THEN bubblesCount + ${data.totalReceived}`);
      totalDistributed += data.totalReceived;
      recipientsList.push({
        rank: recipientsList.length + 1,
        userId: id,
        name: data.name,
        location: `${data.area || ''} ${data.city || ''}`.trim() || 'Unknown',
        totalDonated: data.totalDonated,
        received: data.totalReceived,
      });
    }

    await BubbleTransaction.bulkCreate(finalTransactions, { transaction: t });
    console.log(`   ✅ Inserted ${finalTransactions.length} transfer transactions`);

    const ids = Array.from(recipientMap.keys()).join(',');
    await sequelize.query(`
      UPDATE users 
      SET bubblesCount = CASE id ${updates.join(' ')} END
      WHERE id IN (${ids});
    `, { transaction: t });
    console.log(`   ✅ Updated ${recipientMap.size} user balances`);

    await sequelize.query(
      `UPDATE giveaways 
       SET totalDonated = COALESCE(totalDonated, 0) + :bubbles,
           eligibleUsers = :eligibleCount
       WHERE id = :giveawayId`,
      {
        replacements: {
          bubbles: bubbles,
          eligibleCount: eligibleCount,
          giveawayId: giveaway.id
        },
        transaction: t
      }
    );

    await t.commit();

    console.log(`✅ COMPLETE - Distributed ${totalDistributed} bubbles to ${recipientMap.size} users in ${location || 'all locations'}`);

    const updatedDonor = await User.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'bubblesCount', 'queuePosition', 'queueBubbles', 'queueSlots']
    });

    res.json({
      success: true,
      message: `Distributed ${totalDistributed} bubbles to ${recipientMap.size} users${location && location !== 'All' ? ` in ${location}` : ''}`,
      distribution: {
        giveawayId: giveaway.id,
        category,
        amountPerUser,
        location: location || 'All',
        rounds: round - 1,
        totalDistributed,
        recipientCount: recipientMap.size,
        recipients: recipientsList,
      },
      updatedUser: {
        id: updatedDonor.id,
        name: updatedDonor.name,
        email: updatedDonor.email,
        bubblesCount: parseInt(updatedDonor.bubblesCount),
        queuePosition: updatedDonor.queuePosition,
        queueBubbles: updatedDonor.queueBubbles,
        queueSlots: updatedDonor.queueSlots
      }
    });
  } catch (e) {
    await t.rollback();
    console.error('❌ Giveaway donate error:', e);
    console.error('Error details:', e.message);
    res.status(400).json({ message: e.message || 'Donation failed' });
  }
});


// routes/get.js - Add these routes after existing giveaway routes

// Get eligible users with location filter for giveaway
router.get('/giveaway/eligible-users/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { location } = req.query; // Can be city or area
    const donorId = req.user.id;

    console.log('🎁 Getting eligible users for giveaway with location filter:', {
      category,
      location,
      donorId
    });

    // Check if giveaway exists
    const giveaway = await Giveaway.findOne({
      where: { category, distributed: false },
      attributes: ['id', 'amountPerUser']
    });

    if (!giveaway) {
      return res.status(404).json({ message: `No active ${category} giveaway` });
    }

    // Base query
    let query = `
      SELECT u.id, u.name, u.createdAt, u.area, u.city, u.province,
             COALESCE(SUM(bt.bubbleAmount), 0) AS totalDonated
      FROM users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1 
        AND u.id != :donorId
        AND bt.type IN ('support', 'donation', 'transfer')
        AND bt.status = 'completed'
        AND (bt.giveaway = 0 OR bt.giveaway IS NULL)
    `;

    // Add location filter if provided
    if (location && location !== 'All') {
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar'];
      const knownAreas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Gulberg', 'Johar Town', 'Model Town'];
      
      if (knownCities.includes(location)) {
        query += ` AND u.city = :location `;
      } else if (knownAreas.includes(location)) {
        query += ` AND u.area = :location `;
      } else {
        // Check any location field
        query += ` AND (u.city = :location OR u.area = :location OR u.province = :location) `;
      }
    }

    query += `
      GROUP BY u.id, u.name, u.createdAt, u.area, u.city, u.province
      ORDER BY totalDonated DESC, u.createdAt ASC
    `;

    const eligibleUsers = await sequelize.query(query, {
      replacements: { 
        donorId,
        ...(location && location !== 'All' ? { location } : {})
      },
      type: sequelize.QueryTypes.SELECT,
    });

    // Get top donors for preview (max 5)
    const topDonors = eligibleUsers.slice(0, 5).map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.name,
      location: `${user.area || ''} ${user.city || ''}`.trim() || 'Unknown',
      totalDonated: user.totalDonated
    }));

    res.json({
      eligibleCount: eligibleUsers.length,
      amountPerUser: giveaway.amountPerUser,
      topDonors,
      locationApplied: location && location !== 'All' ? location : 'All Locations'
    });
  } catch (e) {
    console.error('❌ Get eligible users error:', e);
    res.status(400).json({ message: e.message || 'Failed to get eligible users' });
  }
});

// Get cities with eligible users for giveaway
router.get('/giveaway/eligible-cities', async (req, res) => {
  try {
    const cities = await sequelize.query(`
      SELECT DISTINCT u.city 
      FROM users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1
        AND u.city IS NOT NULL
        AND bt.type IN ('support', 'donation', 'transfer')
        AND bt.status = 'completed'
        AND (bt.giveaway = 0 OR bt.giveaway IS NULL)
      ORDER BY u.city ASC
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    const cityList = cities.map(c => c.city).filter(Boolean);
    res.json(cityList);
  } catch (e) {
    console.error('❌ Get eligible cities error:', e);
    res.status(400).json({ message: e.message });
  }
});

// Get areas for a specific city with eligible users
router.get('/giveaway/eligible-areas/:city', async (req, res) => {
  try {
    const { city } = req.params;
    
    const areas = await sequelize.query(`
      SELECT DISTINCT u.area 
      FROM users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1
        AND u.city = :city
        AND u.area IS NOT NULL
        AND bt.type IN ('support', 'donation', 'transfer')
        AND bt.status = 'completed'
        AND (bt.giveaway = 0 OR bt.giveaway IS NULL)
      ORDER BY u.area ASC
    `, {
      replacements: { city },
      type: sequelize.QueryTypes.SELECT
    });

    const areaList = areas.map(a => a.area).filter(Boolean);
    res.json(areaList);
  } catch (e) {
    console.error('❌ Get eligible areas error:', e);
    res.status(400).json({ message: e.message });
  }
});



router.get('/giveaway/preview/:category', async (req, res) => {
  try {
    const { category } = req.params;
    
    const giveaway = await Giveaway.findOne({ 
      where: { category, distributed: false },
      attributes: ['id', 'amountPerUser', 'totalDonated', 'createdAt'],
      raw: true
    });
    
    if (!giveaway) {
      return res.status(404).json({ message: `No active ${category} giveaway` });
    }

    const eligibleUsersResult = await sequelize.query(`
      SELECT COUNT(DISTINCT fromUserId) as count
      FROM bubble_transactions
      WHERE type IN ('support', 'donation', 'transfer')
      AND status = 'completed'
      AND (giveaway = 0 OR giveaway IS NULL)
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    const eligibleCount = eligibleUsersResult[0]?.count || 0;

    res.json({
      giveawayId: giveaway.id,
      category,
      amountPerUser: giveaway.amountPerUser,
      eligibleUsers: eligibleCount,
      totalDonated: giveaway.totalDonated || 0,
      createdAt: giveaway.createdAt
    });
  } catch (e) {
    console.error('❌ Preview error:', e);
    res.status(400).json({ message: e.message || 'Failed to fetch preview' });
  }
});

router.get('/leaderboard-giveaway', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const donationStats = await BubbleTransaction.findAll({
      where: {
        status: 'completed',
        type: 'donation'
      },
      attributes: [
        'fromUserId',
        [literal('SUM(bubbleAmount)'), 'totalDonated'],
        [literal('COUNT(*)'), 'donationCount']
      ],
      group: ['fromUserId'],
      order: [[literal('totalDonated'), 'DESC']],
      limit: parseInt(limit),
      raw: true
    });

    const leaderboard = [];
    for (let i = 0; i < donationStats.length; i++) {
      const stat = donationStats[i];
      const user = await User.findByPk(stat.fromUserId, {
        attributes: ['id', 'name', 'email', 'country', 'province', 'city', 'area']
      });

      if (user) {
        const totalDonated = parseInt(stat.totalDonated);
        const donationCount = parseInt(stat.donationCount);

        let level = 'Bronze';
        let gradient = ['#CD7F32', '#B8860B'];
        if (totalDonated >= 5000) {
          level = 'Diamond';   gradient = ['#b9f2ff', '#667eea'];
        } else if (totalDonated >= 3000) {
          level = 'Platinum';  gradient = ['#E5E4E2', '#C0C0C0'];
        } else if (totalDonated >= 1500) {
          level = 'Gold';      gradient = ['#FFD700', '#FFA500'];
        } else if (totalDonated >= 500) {
          level = 'Silver';    gradient = ['#C0C0C0', '#A8A8A8'];
        }

        const locationParts = [];
        if (user.area) locationParts.push(user.area);
        if (user.city && user.city !== user.area) locationParts.push(user.city);
        const location = locationParts.length ? locationParts.join(', ') : 'Unknown';

        leaderboard.push({
          id: user.id,
          name: user.name,
          avatar: user.name.charAt(0).toUpperCase(),
          rank: i + 1,
          points: totalDonated,
          totalDonated,
          donationCount,
          level,
          gradient,
          location,
          country: user.country,
          province: user.province,
          city: user.city,
          area: user.area
        });
      }
    }

    res.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard-giveaway error:', error);
    res.status(400).json({ message: error.message || 'Failed to get giveaway leaderboard' });
  }
});

router.get('/top-three-donors', async (req, res) => {
  try {
    console.log('Backend - Getting top 3 donors');
    
    const donationStats = await BubbleTransaction.findAll({
      where: { 
        status: 'completed',
        type: 'donation'
      },
      attributes: [
        'fromUserId',
        [literal('SUM(bubbleAmount)'), 'totalDonated'],
        [literal('COUNT(*)'), 'donationCount']
      ],
      group: ['fromUserId'],
      order: [[literal('totalDonated'), 'DESC']],
      limit: 3,
      raw: true
    });
    
    console.log(`Backend - Found ${donationStats.length} top donors`);
    
    const topThree = [];
    for (let i = 0; i < donationStats.length; i++) {
      const stat = donationStats[i];
      const user = await User.findByPk(stat.fromUserId, {
        attributes: ['id', 'name', 'email', 'country', 'province', 'city', 'area']
      });
      
      if (user) {
        const totalDonated = parseInt(stat.totalDonated);
        const donationCount = parseInt(stat.donationCount);
        
        let level = 'Bronze';
        let gradient = ['#CD7F32', '#B8860B'];
        if (totalDonated >= 5000) {
          level = 'Diamond';
          gradient = ['#b9f2ff', '#667eea'];
        } else if (totalDonated >= 3000) {
          level = 'Platinum';
          gradient = ['#E5E4E2', '#C0C0C0'];
        } else if (totalDonated >= 1500) {
          level = 'Gold';
          gradient = ['#FFD700', '#FFA500'];
        } else if (totalDonated >= 500) {
          level = 'Silver';
          gradient = ['#C0C0C0', '#A8A8A8'];
        }
        
        const locationParts = [];
        if (user.area) locationParts.push(user.area);
        if (user.city && user.city !== user.area) locationParts.push(user.city);
        const location = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown';
        
        topThree.push({
          id: user.id,
          name: user.name,
          avatar: user.name.charAt(0).toUpperCase(),
          rank: i + 1,
          points: totalDonated,
          totalDonated: totalDonated,
          donationCount: donationCount,
          level: level,
          gradient: gradient,
          location: location,
          country: user.country,
          province: user.province,
          city: user.city,
          area: user.area
        });
      }
    }
    
    console.log(`Backend - Returning ${topThree.length} top donors`);
    res.json(topThree);
  } catch (error) {
    console.error('Backend - Top donors error:', error);
    res.status(400).json({ message: error.message || 'Failed to get top donors' });
  }
});

router.get('/user/giveaway-bubbles', async (req, res) => {
  try {
    console.log('🎁 Backend - Getting giveaway bubbles for user:', req.user.id);
    
    const giveawayTransactions = await BubbleTransaction.findAll({
      where: {
        toUserId: req.user.id,
        status: 'completed',
        type: 'transfer',
        description: {
          [Op.or]: [
            { [Op.like]: '%Giveaway Distribution%' },
            { [Op.like]: '%Grocery Giveaway%' },
            { [Op.like]: '%Medical Giveaway%' },
            { [Op.like]: '%Education Giveaway%' }
          ]
        }
      },
      raw: true
    });
    
    const totalGiveawayBubbles = giveawayTransactions.reduce((sum, tx) => sum + tx.bubbleAmount, 0);
    
    console.log('🎁 Found giveaway bubbles:', totalGiveawayBubbles, 'from', giveawayTransactions.length, 'transactions');
    console.log('🎁 Sample transactions:', giveawayTransactions.slice(0, 3));
    
    res.json({
      giveawayBubbles: totalGiveawayBubbles,
      totalGiveawayBubbles,
      transactionCount: giveawayTransactions.length
    });
  } catch (error) {
    console.error('❌ Get giveaway bubbles error:', error);
    res.status(400).json({ message: error.message || 'Failed to get giveaway bubbles' });
  }
});


// FIXED VERSION - Add this to your get.js file (replace the previous version)

// ==================== BUBBLE BREAKDOWN ====================
// GET /get/user/bubble-breakdown
// Returns breakdown of user's bubbles by source
// ENHANCED VERSION with detailed logging
// Replace your existing /user/bubble-breakdown endpoint with this

// ==================== SIMPLE BUBBLE BREAKDOWN ROUTE ====================
// Just fetch the LATEST deposit amount, not sum all deposits
// Replace your existing /user/bubble-breakdown route with this

router.get('/user/bubble-breakdown', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`\n💰 ==================== BUBBLE BREAKDOWN ====================`);
    console.log(`   User ID: ${userId}`);

    // Get user info
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'bubblesCount']
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`   User: ${user.name}`);
    console.log(`   Current Total: ${user.bubblesCount} bubbles`);
    console.log(`   ──────────────────────────────────────────────────────`);

    // 1. GET LATEST DEPOSIT (not sum, just the most recent one)
    console.log(`   📥 Fetching LATEST deposit...`);
    const latestDepositResult = await sequelize.query(`
      SELECT amount
      FROM wallettransactions
      WHERE userId = :userId
        AND type = 'bubble_deposit'
      ORDER BY createdAt DESC
      LIMIT 1
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    const depositedBubbles = latestDepositResult[0]?.amount || 0;
    console.log(`   ✅ Latest Deposit: ${depositedBubbles} bubbles`);

    // 2. SUPPORT RECEIVED
    console.log(`   📥 Checking SUPPORT RECEIVED bubbles...`);
    const supportReceivedResult = await sequelize.query(`
      SELECT 
        COALESCE(SUM(bubbleAmount), 0) as totalReceived,
        COUNT(*) as supportCount
      FROM bubble_transactions
      WHERE toUserId = :userId
        AND status = 'completed'
        AND type = 'support'
        AND giveaway = 0
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    const supportReceivedBubbles = parseInt(supportReceivedResult[0]?.totalReceived || 0);
    const supportCount = parseInt(supportReceivedResult[0]?.supportCount || 0);
    console.log(`   ✅ From Support: ${supportReceivedBubbles} bubbles (${supportCount} transactions)`);

    // 3. GIVEAWAY BUBBLES
    console.log(`   📥 Checking GIVEAWAY bubbles...`);
    const giveawayResult = await sequelize.query(`
      SELECT 
        COALESCE(SUM(bubbleAmount), 0) as totalGiveaway,
        COUNT(*) as giveawayCount
      FROM bubble_transactions
      WHERE toUserId = :userId
        AND status = 'completed'
        AND giveaway = 1
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    const giveawayBubbles = parseInt(giveawayResult[0]?.totalGiveaway || 0);
    const giveawayCount = parseInt(giveawayResult[0]?.giveawayCount || 0);
    console.log(`   ✅ Giveaway: ${giveawayBubbles} bubbles (${giveawayCount} transactions)`);

    console.log(`   ──────────────────────────────────────────────────────`);
    console.log(`   📊 BREAKDOWN:`);
    console.log(`      Latest Deposit:   ${depositedBubbles}`);
    console.log(`      From Support:     ${supportReceivedBubbles}`);
    console.log(`      From Giveaway:    ${giveawayBubbles}`);
    console.log(`      ────────────────────`);
    console.log(`      Current Balance:  ${user.bubblesCount}`);
    console.log(`   ══════════════════════════════════════════════════════\n`);

    // Prepare response
    const response = {
      depositedBubbles: depositedBubbles,  // Latest deposit only
      supportReceivedBubbles: supportReceivedBubbles,
      giveawayBubbles: giveawayBubbles,
      totalBubbles: user.bubblesCount,
      breakdown: {
        deposited: depositedBubbles,
        fromSupport: supportReceivedBubbles,
        fromGiveaway: giveawayBubbles,
        current: user.bubblesCount
      }
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Bubble breakdown error:', error);
    res.status(400).json({ 
      message: error.message || 'Failed to get bubble breakdown',
      error: error.toString()
    });
  }
});

// ==================== END OF SIMPLE BUBBLE BREAKDOWN ROUTE ====================
// ==================== END OF FIXED ENDPOINT ====================





// DIAGNOSTIC ENDPOINT - Add this temporarily to debug
// You can remove this after fixing the issue

router.get('/user/bubble-diagnostic', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`\n🔍 [DIAGNOSTIC] Checking transactions for user ${userId}`);

    // Get all transactions where user received bubbles
    const receivedTransactions = await sequelize.query(`
      SELECT 
        id,
        fromUserId,
        toUserId,
        bubbleAmount,
        type,
        status,
        giveaway,
        description,
        createdAt
      FROM BubbleTransactions
      WHERE toUserId = :userId
        AND status = 'completed'
      ORDER BY createdAt DESC
      LIMIT 20
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`   Found ${receivedTransactions.length} received transactions`);

    // Count by type
    const typeBreakdown = {
      support: receivedTransactions.filter(t => t.type === 'support').length,
      transfer: receivedTransactions.filter(t => t.type === 'transfer').length,
      donation: receivedTransactions.filter(t => t.type === 'donation').length,
      other: receivedTransactions.filter(t => !['support', 'transfer', 'donation'].includes(t.type)).length,
    };

    // Count by giveaway status
    const giveawayBreakdown = {
      giveaway: receivedTransactions.filter(t => t.giveaway === 1).length,
      nonGiveaway: receivedTransactions.filter(t => t.giveaway === 0 || t.giveaway === null).length,
    };

    // Sum by category
    const bubbleBreakdown = {
      totalFromGiveaway: receivedTransactions
        .filter(t => t.giveaway === 1)
        .reduce((sum, t) => sum + parseInt(t.bubbleAmount), 0),
      totalFromSupport: receivedTransactions
        .filter(t => t.giveaway === 0 || t.giveaway === null)
        .reduce((sum, t) => sum + parseInt(t.bubbleAmount), 0),
    };

    // Get wallet deposits
    const deposits = await sequelize.query(`
      SELECT 
        id,
        userId,
        type,
        amount,
        createdAt
      FROM WalletTransactions
      WHERE userId = :userId
        AND type = 'bubble_deposit'
      ORDER BY createdAt DESC
      LIMIT 10
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`   Found ${deposits.length} wallet deposits`);

    const totalDeposited = deposits.reduce((sum, d) => sum + parseInt(d.amount), 0);

    // Get spending
    const spentTransactions = await sequelize.query(`
      SELECT COALESCE(SUM(bubbleAmount), 0) as totalSpent
      FROM BubbleTransactions
      WHERE fromUserId = :userId
        AND status = 'completed'
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });

    const totalSpent = parseInt(spentTransactions[0]?.totalSpent || 0);

    const diagnostic = {
      userId: userId,
      receivedTransactions: {
        count: receivedTransactions.length,
        typeBreakdown: typeBreakdown,
        giveawayBreakdown: giveawayBreakdown,
        bubbleBreakdown: bubbleBreakdown,
        recent: receivedTransactions.slice(0, 5),
      },
      deposits: {
        count: deposits.length,
        totalDeposited: totalDeposited,
        recent: deposits.slice(0, 3),
      },
      spending: {
        totalSpent: totalSpent,
      },
      calculated: {
        deposited: totalDeposited,
        fromSupport: bubbleBreakdown.totalFromSupport,
        fromGiveaway: bubbleBreakdown.totalFromGiveaway,
        spent: totalSpent,
        netTotal: totalDeposited + bubbleBreakdown.totalFromSupport + bubbleBreakdown.totalFromGiveaway - totalSpent,
      }
    };

    console.log(`   📊 Diagnostic Results:`, JSON.stringify(diagnostic, null, 2));

    res.json(diagnostic);

  } catch (error) {
    console.error('❌ Diagnostic error:', error);
    res.status(400).json({ 
      message: error.message,
      error: error.toString()
    });
  }
});

module.exports = router;