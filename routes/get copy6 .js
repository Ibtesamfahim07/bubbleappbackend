// routes/get.js - FIXED VERSION with slotProgress validation
const express = require('express');
const auth = require('../middleware/auth');
const { User, BubbleTransaction, Giveaway, OfferRequest, Brand, Offer } = require('../models');
const { literal, Op } = require('sequelize');
const sequelize = require('../config/database');

const router = express.Router();
router.use(auth);

// ============================================================
// CRITICAL FIX: SlotProgress Validation Helper
// ============================================================
function validateAndFixSlotProgress(slotProgress, queueSlots) {
  console.log('🔍 Validating slotProgress:', typeof slotProgress, slotProgress);
  
  let parsed = slotProgress;
  
  // Handle null/undefined
  if (!parsed) {
    console.log('⚠️ slotProgress is null/undefined, initializing empty object');
    parsed = {};
  }
  
  // Handle string - parse JSON (possibly multiple times if double-stringified)
  let parseAttempts = 0;
  while (typeof parsed === 'string' && parseAttempts < 3) {
    parseAttempts++;
    try {
      parsed = JSON.parse(parsed);
      console.log(`✅ JSON parse attempt ${parseAttempts} succeeded`);
    } catch (e) {
      console.error(`❌ JSON parse attempt ${parseAttempts} failed:`, e.message);
      parsed = {};
      break;
    }
  }
  
  // If still a string after multiple parses, reset
  if (typeof parsed === 'string') {
    console.error('❌ slotProgress still a string after parsing, resetting');
    parsed = {};
  }
  
  // If not an object, reset
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error('❌ slotProgress is not a valid object, resetting');
    parsed = {};
  }
  
  // Check for corruption: if any value is a single character or non-numeric string
  const keys = Object.keys(parsed);
  let isCorrupted = false;
  
  // Corruption detection: too many keys (character-by-character corruption)
  if (keys.length > queueSlots + 5) {
    console.error(`❌ CORRUPTION DETECTED: Too many keys (${keys.length}) for ${queueSlots} slots`);
    isCorrupted = true;
  }
  
  // Corruption detection: values are single characters
  if (!isCorrupted) {
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length === 1 && isNaN(parseInt(value))) {
        console.error(`❌ CORRUPTION DETECTED: Key "${key}" has single char value "${value}"`);
        isCorrupted = true;
        break;
      }
    }
  }
  
  // If corrupted, reset entirely
  if (isCorrupted) {
    console.log('🔄 Resetting corrupted slotProgress to clean state');
    parsed = {};
  }
  
  // Build valid progress object with only valid slots
  const validProgress = {};
  const slots = parseInt(queueSlots) || 0;
  
  for (let i = 1; i <= slots; i++) {
    const key = i.toString();
    const value = parsed[key];
    
    if (typeof value === 'number' && !isNaN(value) && value >= 0 && value <= 400) {
      validProgress[key] = Math.floor(value);
    } else if (typeof value === 'string') {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 0 && num <= 400) {
        validProgress[key] = num;
      } else {
        validProgress[key] = 0;
      }
    } else {
      validProgress[key] = 0;
    }
  }
  
  console.log('✅ Validated slotProgress:', validProgress);
  return validProgress;
}

// ============================================================
// Helper: Stringify slotProgress for database storage
// ============================================================
function stringifySlotProgress(slotProgress) {
  if (typeof slotProgress === 'string') {
    return slotProgress;
  }
  return JSON.stringify(slotProgress);
}

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

// ============================================================
// HELPER: Rebalance Queue Positions
// ============================================================
async function rebalanceQueuePositions(transaction = null) {
  try {
    console.log('Rebalancing queue positions...');
    
    const options = { 
      where: { queuePosition: { [Op.gt]: 0 } },
      order: [['queuePosition', 'ASC']],
      attributes: ['id', 'queuePosition', 'queueSlots']
    };
    
    if (transaction) options.transaction = transaction;
    
    const queuedUsers = await User.findAll(options);
    
    let newPosition = 1;
    
    for (const user of queuedUsers) {
      const slots = parseInt(user.queueSlots) || 1;
      
      if (user.queuePosition !== newPosition) {
        const updateOptions = { where: { id: user.id } };
        if (transaction) updateOptions.transaction = transaction;
        
        await User.update({ queuePosition: newPosition }, updateOptions);
        console.log(`  Moved user ${user.id}: ${user.queuePosition} -> ${newPosition}`);
      }
      
      newPosition += slots;
    }
    
    console.log('Queue rebalanced');
  } catch (error) {
    console.error('Rebalance error:', error);
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
    
    console.log('\n=== NEARBY REQUEST ===');
    console.log('User:', req.user.id, '| Location:', location || 'All');
    
    if (!lat || !lng) {
      return res.status(400).json({ message: 'Coordinates required' });
    }
    
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);
    
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Current user:', {
      id: currentUser.id,
      name: currentUser.name,
      queuePosition: currentUser.queuePosition
    });

    // ✅ CHECK IF CURRENT USER HAS EVER SUPPORTED ANYONE
    const supportTransaction = await BubbleTransaction.findOne({
      where: {
        fromUserId: req.user.id,
        type: 'support',
        status: 'completed'
      }
    });

    const hasSupported = !!supportTransaction;
    const currentUserInQueue = currentUser.queuePosition > 0;

    console.log('🔍 SUPPORT CHECK:', {
      hasSupported: hasSupported,
      inQueue: currentUserInQueue,
      queuePosition: currentUser.queuePosition
    });

    const distanceFormula = literal(`(
      6371 * acos(
        cos(radians(${userLat})) * cos(radians(lat)) * 
        cos(radians(lng) - radians(${userLng})) + 
        sin(radians(${userLat})) * sin(radians(lat))
      )
    )`);
    
    let where = {
      id: { [Op.ne]: req.user.id },
      bubblesCount: { [Op.gt]: 0 },
      isActive: true,
      queuePosition: { [Op.gt]: 0 },
      queueSlots: { [Op.gt]: 0 }
    };

    if (location && location !== 'All') {
      const cities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar'];
      const areas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Qasimabad'];
      
      if (cities.includes(location)) where.city = location;
      else if (areas.includes(location)) where.area = location;
      else where[Op.or] = [{ city: location }, { area: location }];
    }

    const users = await User.findAll({
      attributes: ['id', 'name', 'lat', 'lng', 'bubblesCount', 'city', 'area', 
                   'queuePosition', 'queueSlots', 'slotProgress', 'createdAt', [distanceFormula, 'distance']],
      where,
      having: literal(`distance < ${searchRadius}`),
      order: [['queuePosition', 'ASC']],
      limit: 50
    });
    
    console.log(`Found ${users.length} users in queue`);

    // ✅ FILTERING LOGIC BASED ON SUPPORT STATUS
    const filtered = [];

    for (const u of users) {
      const uSlots = parseInt(u.queueSlots) || 0;
      const uQueuePos = parseInt(u.queuePosition) || 0;
      
      if (uSlots <= 0) continue;
      
      // ✅ FRESH USER (never supported anyone): Only show Queue #1
      if (!hasSupported) {
        if (uQueuePos === 1) {
          filtered.push(u);
          console.log(`✅ FRESH USER - Showing Queue #1: ${u.name}`);
        } else {
          console.log(`❌ FRESH USER - Hiding ${u.name} (Queue #${uQueuePos}) - must support Queue #1 first`);
        }
      } 
      // ✅ USER WHO HAS SUPPORTED: Show all users above them (lower queue positions)
      else {
        if (currentUserInQueue && currentUser.queuePosition > 0) {
          // User is in queue - show users with LOWER queue positions only
          if (uQueuePos < currentUser.queuePosition) {
            filtered.push(u);
            console.log(`✅ IN QUEUE - Showing ${u.name} (Queue #${uQueuePos}) - above current user (Queue #${currentUser.queuePosition})`);
          } else {
            console.log(`❌ IN QUEUE - Hiding ${u.name} (Queue #${uQueuePos}) - not above current user (Queue #${currentUser.queuePosition})`);
          }
        } else {
          // User has supported but not in queue (edge case) - show Queue #1 only
          if (uQueuePos === 1) {
            filtered.push(u);
            console.log(`✅ SUPPORTED BUT NOT IN QUEUE - Showing Queue #1: ${u.name}`);
          } else {
            console.log(`❌ SUPPORTED BUT NOT IN QUEUE - Hiding ${u.name} (Queue #${uQueuePos})`);
          }
        }
      }
    }

    console.log(`After filter: ${filtered.length} users visible to current user (hasSupported: ${hasSupported})`);

    // Build cards from filtered users
    const cards = [];

    for (const u of filtered) {
      const slots = parseInt(u.queueSlots) || 1;
      const basePos = parseInt(u.queuePosition) || 0;
      const dist = parseFloat(u.getDataValue('distance')).toFixed(1);

      const progress = validateAndFixSlotProgress(u.slotProgress, slots);
      
      console.log(`📊 User ${u.name} validated slotProgress:`, progress);

      const loc = [u.area, u.city].filter(Boolean).join(', ') || 'Unknown';

      for (let i = 0; i < slots; i++) {
        const slotNum = i + 1;
        const slotPos = basePos + i;
        const prog = progress[slotNum.toString()] || 0;
        const pct = Math.round((prog / 400) * 100);
        
        console.log(`  Slot ${slotNum}: progress = ${prog}/400 (${pct}%)`);

        let color = '#10b981';
        if (slotPos === 1) color = '#ef4444';
        else if (slotPos <= 5) color = '#f59e0b';
        else if (slotPos <= 10) color = '#3b82f6';

        cards.push({
          id: `${u.id}-slot-${i}`,
          userId: u.id,
          userName: u.name,
          bubbleAmount: u.bubblesCount,
          totalBubbles: u.bubblesCount,
          creatorColor: color,
          description: `Queue #${slotPos} • ${prog}/400 (${pct}%) • ${loc}`,
          distance: dist,
          lat: u.lat,
          lng: u.lng,
          city: u.city,
          area: u.area,
          locationDisplay: loc,
          queuePosition: slotPos,
          queueProgress: prog,
          queueRequired: 400,
          queueProgressPercent: pct,
          remainingForSlot: 400 - prog,
          queueSlots: slots,
          slotIndex: i,
          slotNumber: slotNum,
          baseQueuePosition: basePos,
          isInQueue: true,
          canSupport: true,
          isOwnCard: false
        });
      }
    }

    cards.sort((a, b) => a.queuePosition - b.queuePosition);
    console.log(`Returning ${cards.length} Nearby cards\n`);

    res.json(cards);
  } catch (error) {
    console.error('Nearby error:', error);
    res.status(400).json({ message: error.message });
  }
});


router.get('/incomplete-queue', async (req, res) => {
  try {
    console.log('\n=== INCOMPLETE QUEUE (Active Tab) ===');
    console.log('User:', req.user.id);
    
    const user = await User.findByPk(req.user.id);
    
    if (!user) {
      console.log('User not found');
      return res.json([]);
    }
    
    const qPos = parseInt(user.queuePosition) || 0;
    const qSlots = parseInt(user.queueSlots) || 0;
    
    console.log('Queue Position:', qPos, '| Slots:', qSlots, '| Raw SlotProgress:', user.slotProgress);
    
    if (qPos === 0 || qSlots === 0) {
      console.log('Not in queue or no slots');
      return res.json([]);
    }

    // ✅ FIXED: Use validation helper
    const slotProgress = validateAndFixSlotProgress(user.slotProgress, qSlots);
    
    console.log('Validated progress:', slotProgress);

    const cards = [];
    const REQUIRED = 400;

    for (let slotNum = 1; slotNum <= qSlots; slotNum++) {
      const progress = slotProgress[slotNum.toString()] || 0;
      
      if (progress < REQUIRED) {
        const pct = Math.round((progress / REQUIRED) * 100);
        const actualPos = qPos + (slotNum - 1);
        const loc = [user.area, user.city].filter(Boolean).join(', ') || 'Unknown';
        
        console.log(`  Card ${slotNum}: Queue #${actualPos}, Progress ${progress}/${REQUIRED}`);
        
        cards.push({
          id: `active-slot-${slotNum}`,
          userId: user.id,
          userName: user.name,
          bubbleAmount: user.bubblesCount,
          queuePosition: actualPos,
          queueProgress: progress,
          queueRequired: REQUIRED,
          queueProgressPercent: pct,
          slotNumber: slotNum,
          slotIndex: slotNum - 1,
          supporterCount: 0,
          isOwnCard: true,
          creatorColor: '#f59e0b',
          area: user.area,
          city: user.city,
          locationDisplay: loc,
          description: `Queue #${actualPos} • ${progress}/${REQUIRED} (${pct}%) • ${loc}`,
          createdAt: new Date().toISOString()
        });
      }
    }

    console.log(`Returning ${cards.length} Active cards\n`);
    res.json(cards);
  } catch (error) {
    console.error('Incomplete queue error:', error);
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
    const { location } = req.query;
    
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

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
    
    if (location && location !== 'All') {
      console.log(`Backend - Applying location filter to supporters: "${location}"`);
      
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar', 'Sukkur', 'Larkana', 'Mirpurkhas', 'Gwadar', 'Turbat', 'Khuzdar', 'Mardan', 'Abbottabad', 'Swat', 'Gujranwala', 'Sialkot'];
      const knownAreas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Gulberg', 'Johar Town', 'Model Town', 'Latifabad', 'Qasimabad', 'Cantonment', 'Hussainabad', 'F-6', 'F-7', 'F-8', 'G-6', 'G-7', 'Blue Area'];
      
      const isCity = knownCities.includes(location);
      
      supporters = supporters.filter(supporter => {
        if (isCity) {
          return supporter.city === location;
        } else {
          return supporter.area === location || 
                 supporter.city === location || 
                 supporter.province === location ||
                 supporter.country === location;
        }
      });
      
      console.log(`Backend - After filter: ${supporters.length} supporters from location: ${location}`);
    }

    supporters.sort((a, b) => b.totalSupported - a.totalSupported);

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
      supporters: supporters,
      totalSupporters: filteredTotalSupporters,
      totalSupport: filteredTotalSupport,
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
    
    // ============================================================
    // 1. GET BUBBLE TRANSACTIONS (existing logic)
    // ============================================================
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
    
    console.log(`Backend - Found ${allTransactions.length} bubble transactions`);
    
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
      const isAdminOfferSupport = type === 'admin_offer_support';
      
      if (type === 'transfer' && transaction.description && transaction.description.includes('Giveaway')) {
        isDonation = true;
        type = 'donation';
        
        if (!isSent) {
          description = 'Free Giveaway';
        } 
        else {
          description = 'Donated to Giveaway';
        }
      } else if (type === 'donation') {
        description = 'Free Giveaway';
      } else if (isAdminOfferSupport) {
        description = transaction.description || `Offer Request - Admin Support: ${transaction.bubbleAmount} bubbles`;
      } else if (type === 'support') {
        description = isSent 
          ? `Sent ${transaction.bubbleAmount} bubbles`
          : `Received ${transaction.bubbleAmount} bubbles`;
      }
      
      enrichedTransactions.push({
        id: transaction.id,
        userId: otherUserId,
        userName: isAdminOfferSupport ? 'Admin' : (otherUser ? otherUser.name : 'Unknown User'),
        bubbleAmount: transaction.bubbleAmount,
        transactionCount: 1,
        creatorColor: isAdminOfferSupport ? '#10b981' : (isDonation ? '#f59e0b' : (isSent ? '#f59e0b' : '#10b981')),
        description: description,
        status: 'completed',
        type: type,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        isReceived: !isSent || isAdminOfferSupport,
        isDonation: isDonation,
        isAdminOfferSupport: isAdminOfferSupport,
        isSupport: type === 'support',
        targetSlotNumber: transaction.targetSlotNumber,
        source: 'bubble_transaction' // ✅ NEW: Mark source
      });
    }
    
    // ============================================================
    // 2. GET ACCEPTED/COMPLETED OFFER REQUESTS (new logic)
    // ============================================================
    const offerRequests = await OfferRequest.findAll({
      where: {
        userId: req.user.id,
        status: {
          [Op.in]: ['accepted', 'completed'] // ✅ Get both accepted and completed
        }
      },
      include: [
        {
          model: Brand,
          as: 'Brand',
          attributes: ['id', 'name', 'price']
        },
        {
          model: Offer,
          as: 'Offer',
          attributes: ['id', 'title', 'discount']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    
    console.log(`Backend - Found ${offerRequests.length} offer requests`);
    
    // ✅ Convert offer requests to transaction format
    for (const request of offerRequests) {
      const brandName = request.Brand?.name || 'Unknown Brand';
      const offerTitle = request.Offer?.title || 'Offer';
      const price = parseFloat(request.Brand?.price || 0);
      const discount = parseFloat(request.Offer?.discount || 0);
      const finalPrice = discount > 0 ? price * (1 - discount / 100) : price;
      
      // Extract shortfall from adminNotes if present
      let shortfall = 0;
      if (request.adminNotes && request.adminNotes.includes('Shortfall:')) {
        const match = request.adminNotes.match(/Shortfall: (\d+)/);
        if (match) {
          shortfall = parseInt(match[1]) || 0;
        }
      }
      
      enrichedTransactions.push({
        id: `offer-request-${request.id}`, // ✅ Unique ID
        userId: null,
        userName: shortfall > 0 ? 'Admin' : brandName, // ✅ Show Admin if shortfall exists
        bubbleAmount: shortfall > 0 ? shortfall : Math.round(finalPrice), // ✅ Show shortfall or price
        transactionCount: 1,
        creatorColor: '#10b981', // ✅ Green for offers
        description: shortfall > 0 
          ? `Offer: ${brandName}` // ✅ SIMPLIFIED - Just brand name
          : `Offer Redeemed: ${offerTitle} at ${brandName}`,
        status: request.status,
        type: shortfall > 0 ? 'admin_offer_support' : 'offer_redemption', // ✅ Different types
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        isReceived: shortfall > 0, // ✅ Only received if admin helped
        isDonation: false,
        isAdminOfferSupport: shortfall > 0, // ✅ Only if admin helped
        isSupport: false,
        targetSlotNumber: null,
        source: 'offer_request', // ✅ Mark source
        offerRequestId: request.id,
        brandName: brandName,
        offerTitle: offerTitle,
        price: finalPrice,
        discount: discount,
        shortfall: shortfall
      });
    }
    
    // ============================================================
    // 3. SORT ALL TRANSACTIONS BY DATE (newest first)
    // ============================================================
    enrichedTransactions.sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    console.log(`Backend - Returning ${enrichedTransactions.length} total transactions (${allTransactions.length} bubble + ${offerRequests.length} offers)`);
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
  const t = await sequelize.transaction();
  
  try {
    const { toUserId, bubbleAmount, targetSlotNumber } = req.body;
    
    console.log('\n========================================');
    console.log('SUPPORT REQUEST');
    console.log('========================================');
    console.log('From:', req.user.id, '| To:', toUserId, '| Amount:', bubbleAmount, '| Slot:', targetSlotNumber);
    
    if (!toUserId || !bubbleAmount) {
      await t.rollback();
      return res.status(400).json({ message: 'User ID and bubble amount are required' });
    }
    if (bubbleAmount <= 0) {
      await t.rollback();
      return res.status(400).json({ message: 'Bubble amount must be positive' });
    }
    if (toUserId == req.user.id) {
      await t.rollback();
      return res.status(400).json({ message: 'Cannot support yourself' });
    }
    if (!targetSlotNumber || targetSlotNumber <= 0) {
      await t.rollback();
      return res.status(400).json({ message: 'Target slot number is required' });
    }
    
    const fromUser = await User.findByPk(req.user.id, { transaction: t, lock: t.LOCK.UPDATE });
    const toUser = await User.findByPk(toUserId, { transaction: t, lock: t.LOCK.UPDATE });
    
    if (!fromUser) { await t.rollback(); return res.status(404).json({ message: 'Your account not found' }); }
    if (!toUser) { await t.rollback(); return res.status(404).json({ message: 'Target user not found' }); }
    
    console.log('FROM:', fromUser.name, '| Bubbles:', fromUser.bubblesCount, '| Pos:', fromUser.queuePosition, '| Slots:', fromUser.queueSlots);
    console.log('TO:', toUser.name, '| Bubbles:', toUser.bubblesCount, '| Pos:', toUser.queuePosition, '| Slots:', toUser.queueSlots);
    console.log('TO Raw slotProgress:', toUser.slotProgress);
    
    if (fromUser.bubblesCount < bubbleAmount) {
      await t.rollback();
      return res.status(400).json({ message: `Insufficient bubbles. Have ${fromUser.bubblesCount}, need ${bubbleAmount}` });
    }

    if (toUser.queueSlots <= 0) {
      await t.rollback();
      return res.status(400).json({ message: 'Target user has no queue slots' });
    }
    if (targetSlotNumber > toUser.queueSlots) {
      await t.rollback();
      return res.status(400).json({ message: `Invalid slot. User has ${toUser.queueSlots} slots` });
    }
    
    if (fromUser.queuePosition === 0) {
      if (toUser.queuePosition !== 1) {
        await t.rollback();
        return res.status(400).json({ message: 'Must support Queue #1 to join' });
      }
    } else {
      if (toUser.queuePosition >= fromUser.queuePosition) {
        await t.rollback();
        return res.status(400).json({ message: 'Can only support users above you' });
      }
    }
    
    // ✅ CRITICAL FIX: Use validation helper for receiver
    let toSlotProgress = validateAndFixSlotProgress(toUser.slotProgress, toUser.queueSlots);
    console.log('TO Validated slotProgress:', toSlotProgress);
    
    const slotKey = targetSlotNumber.toString();
    const prevProgress = toSlotProgress[slotKey] || 0;
    const newProgress = prevProgress + bubbleAmount;
    const REQUIRED = 400;
    
    console.log(`Slot ${targetSlotNumber}: ${prevProgress} + ${bubbleAmount} = ${newProgress}/${REQUIRED}`);
    
    fromUser.bubblesCount = parseInt(fromUser.bubblesCount) - bubbleAmount;
    
    toSlotProgress[slotKey] = newProgress;
    
    toUser.bubblesReceived = parseInt(toUser.bubblesReceived || 0) + bubbleAmount;
    console.log(`Updated bubblesReceived: ${toUser.bubblesReceived}`);
    
    let slotCompleted = false;
    let earned = 0;
    
    if (newProgress >= REQUIRED) {
      slotCompleted = true;
      earned = REQUIRED;
      
      console.log(`★ SLOT ${targetSlotNumber} COMPLETED ★`);
      
      toUser.bubblesCount = parseInt(toUser.bubblesCount) + earned;
      
      delete toSlotProgress[slotKey];
      
      const oldKeys = Object.keys(toSlotProgress).map(k => parseInt(k)).sort((a, b) => a - b);
      const newProgress2 = {};
      let newNum = 1;
      for (const oldKey of oldKeys) {
        newProgress2[newNum.toString()] = toSlotProgress[oldKey.toString()];
        newNum++;
      }
      toSlotProgress = newProgress2;
      
      toUser.queueSlots = Math.max(0, parseInt(toUser.queueSlots) - 1);
      
      if (toUser.queueSlots === 0) {
        toUser.queuePosition = 0;
        toSlotProgress = {};
        console.log('Receiver removed from queue');
      }
      
      console.log('Receiver now has', toUser.queueSlots, 'slots');
    }
    
    // ✅ CRITICAL FIX: Always stringify for database storage
    toUser.slotProgress = JSON.stringify(toSlotProgress);
    console.log('TO Final slotProgress (stringified):', toUser.slotProgress);
    
    const slotsForSupporter = Math.floor(bubbleAmount / 100);
    console.log(`Supporter gets ${slotsForSupporter} slots (${bubbleAmount}/100)`);
    
    if (slotsForSupporter > 0) {
      // ✅ CRITICAL FIX: Use validation helper for supporter
      let fromSlotProgress = validateAndFixSlotProgress(fromUser.slotProgress, fromUser.queueSlots || 0);
      
      if (fromUser.queuePosition === 0) {
        const allQueued = await User.findAll({
          where: { queuePosition: { [Op.gt]: 0 }, id: { [Op.ne]: toUser.id } },
          attributes: ['id', 'queuePosition', 'queueSlots'],
          transaction: t
        });
        
        let maxPos = 0;
        if (toUser.queuePosition > 0 && toUser.queueSlots > 0) {
          maxPos = toUser.queuePosition + toUser.queueSlots - 1;
        }
        for (const u of allQueued) {
          const uMax = u.queuePosition + (parseInt(u.queueSlots) || 1) - 1;
          if (uMax > maxPos) maxPos = uMax;
        }
        
        fromUser.queuePosition = maxPos + 1;
        fromUser.queueSlots = slotsForSupporter;
        
        fromSlotProgress = {};
        for (let i = 1; i <= slotsForSupporter; i++) {
          fromSlotProgress[i.toString()] = 0;
        }
        
        console.log(`Supporter JOINED at position ${fromUser.queuePosition} with ${slotsForSupporter} slots`);
      } else {
        const current = parseInt(fromUser.queueSlots) || 0;
        fromUser.queueSlots = current + slotsForSupporter;
        
        for (let i = current + 1; i <= fromUser.queueSlots; i++) {
          fromSlotProgress[i.toString()] = 0;
        }
        
        console.log(`Supporter now has ${fromUser.queueSlots} slots`);
      }
      
      // ✅ CRITICAL FIX: Always stringify for database storage
      fromUser.slotProgress = JSON.stringify(fromSlotProgress);
      console.log('FROM Final slotProgress (stringified):', fromUser.slotProgress);
    }
    
    await fromUser.save({ transaction: t });
    await toUser.save({ transaction: t });
    
    if (slotCompleted) {
      await rebalanceQueuePositions(t);
    }
    
    const tx = await BubbleTransaction.create({
      fromUserId: req.user.id,
      toUserId: parseInt(toUserId),
      bubbleAmount,
      targetSlotNumber,
      type: 'support',
      status: 'completed',
      queuePosition: fromUser.queuePosition,
      slotsOpened: slotsForSupporter
    }, { transaction: t });
    
    await t.commit();
    
    const finalFrom = await User.findByPk(req.user.id);
    const finalTo = await User.findByPk(toUserId);
    
    // ✅ Use validation helper for final response
    const fromProg = validateAndFixSlotProgress(finalFrom.slotProgress, finalFrom.queueSlots);
    const toProg = validateAndFixSlotProgress(finalTo.slotProgress, finalTo.queueSlots);
    
    console.log('========================================');
    console.log('FINAL - Supporter:', finalFrom.name, '| Pos:', finalFrom.queuePosition, '| Slots:', finalFrom.queueSlots, '| Progress:', fromProg);
    console.log('FINAL - Receiver:', finalTo.name, '| Pos:', finalTo.queuePosition, '| Slots:', finalTo.queueSlots, '| Progress:', toProg);
    console.log('========================================\n');
    
    const finalSlotProgress = slotCompleted ? 0 : newProgress;
    console.log(`📤 Sending response - Slot ${targetSlotNumber}: ${finalSlotProgress}/${REQUIRED}`);
    
    res.json({
      message: slotCompleted 
        ? `Slot ${targetSlotNumber} completed! ${toUser.name} earned ${earned} bubbles!` 
        : `Supported slot ${targetSlotNumber}: ${newProgress}/${REQUIRED}`,
      slotCompleted,
      slotNumber: targetSlotNumber,
      slotProgress: finalSlotProgress,
      supporterJoinedQueue: finalFrom.queuePosition > 0,
      supporterQueuePosition: finalFrom.queuePosition,
      queueSlotsOpened: slotsForSupporter,
      supporterTotalSlots: finalFrom.queueSlots,
      transaction: tx,
      user: {
        id: finalFrom.id,
        name: finalFrom.name,
        email: finalFrom.email,
        bubblesCount: parseInt(finalFrom.bubblesCount),
        queuePosition: finalFrom.queuePosition,
        queueBubbles: finalFrom.queueBubbles,
        queueSlots: finalFrom.queueSlots,
        slotProgress: fromProg
      },
      receiverData: {
        id: finalTo.id,
        name: finalTo.name,
        bubblesCount: parseInt(finalTo.bubblesCount),
        queueSlots: finalTo.queueSlots,
        queuePosition: finalTo.queuePosition,
        slotProgress: toProg
      }
    });
    
  } catch (error) {
    await t.rollback();
    console.error('Support error:', error);
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

router.post('/giveaway/donate', async (req, res) => {
  const { category, bubbles, location } = req.body;
  const donorId = req.user?.id;

  console.log('🎁 Giveaway donation request:', { donorId, category, bubbles, location });

  if (!donorId) return res.status(401).json({ message: 'User not authenticated' });
  if (!category || !bubbles || bubbles <= 0)
    return res.status(400).json({ message: 'category, bubbles (>0) required' });

  const t = await sequelize.transaction();
  try {
    console.log(`\n🎁 ==================== PERCENTAGE-BASED GIVEAWAY ====================`);
    console.log(`   Donor: User ${donorId}`);
    console.log(`   Category: ${category}`);
    console.log(`   Donation: ${bubbles} bubbles`);
    console.log(`   Location: ${location || 'All'}`);

    // 1. Validate donor
    const donor = await User.findByPk(donorId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!donor) throw new Error('Donor not found');
    if (donor.bubblesCount < bubbles)
      throw new Error(`Insufficient bubbles. You have ${donor.bubblesCount}, trying to donate ${bubbles}`);

    // 2. Get giveaway settings
    const giveaway = await Giveaway.findOne({
      where: { category, distributed: false },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!giveaway) throw new Error(`No active ${category} giveaway. Admin hasn't set it up yet.`);
    if (!giveaway.isActive) throw new Error(`${category} giveaway is currently disabled by admin.`);

    const percentage = parseFloat(giveaway.percentagePerUser) || 25;
    console.log(`   Percentage: ${percentage}%`);

    // 3. Deduct from donor and add to pool
    donor.bubblesCount -= bubbles;
    await donor.save({ transaction: t });

    giveaway.totalAmount = (giveaway.totalAmount || 0) + bubbles;
    const availablePool = giveaway.totalAmount + (giveaway.holdAmount || 0);
    console.log(`   Pool after donation: ${availablePool}`);

    // 4. Record donation transaction
    await BubbleTransaction.create({
      fromUserId: donorId,
      toUserId: donorId,
      bubbleAmount: bubbles,
      type: 'donation',
      status: 'completed',
      giveaway: 1,
      description: `Donated ${bubbles} to ${category} Giveaway Pool`,
    }, { transaction: t });

    // 5. Get eligible users with their giveback amounts
    let eligibleQuery = `
      SELECT 
        u.id, 
        u.name, 
        u.area, 
        u.city,
        COALESCE(SUM(bt.bubbleAmount), 0) AS totalGiveback
      FROM users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1 
        AND u.id != :donorId
        AND bt.type = 'back'
        AND bt.status = 'completed'
    `;

    if (location && location !== 'All') {
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar'];
      if (knownCities.includes(location)) {
        eligibleQuery += ` AND u.city = :location `;
      } else {
        eligibleQuery += ` AND (u.city = :location OR u.area = :location) `;
      }
    }

    eligibleQuery += `
      GROUP BY u.id, u.name, u.area, u.city
      HAVING totalGiveback > 0
      ORDER BY totalGiveback DESC
    `;

    const eligibleUsers = await sequelize.query(eligibleQuery, {
      replacements: { donorId, ...(location && location !== 'All' ? { location } : {}) },
      type: sequelize.QueryTypes.SELECT,
      transaction: t,
    });

    if (eligibleUsers.length === 0) {
      await t.rollback();
      return res.status(400).json({ 
        message: location && location !== 'All' 
          ? `No eligible users found in ${location}.`
          : 'No eligible users found.'
      });
    }

    console.log(`   Eligible users: ${eligibleUsers.length}`);

    // 6. Get existing reward records
    const userIds = eligibleUsers.map(u => u.id);
    const existingRewards = await sequelize.query(`
      SELECT userId, lastRewardedGivebackAmount, totalRewardsReceived
      FROM user_giveaway_rewards
      WHERE userId IN (:userIds) AND category = :category
    `, {
      replacements: { userIds, category },
      type: sequelize.QueryTypes.SELECT,
      transaction: t
    });

    const rewardMap = new Map();
    for (const r of existingRewards) {
      rewardMap.set(r.userId, {
        lastRewarded: r.lastRewardedGivebackAmount || 0,
        totalReceived: r.totalRewardsReceived || 0
      });
    }

    // 7. Calculate rewards based on NEW giveback amounts only
    const distributions = [];
    let totalToDistribute = 0;

    for (const user of eligibleUsers) {
      const totalGiveback = parseInt(user.totalGiveback);
      const existing = rewardMap.get(user.id) || { lastRewarded: 0, totalReceived: 0 };
      
      const newGivebackAmount = totalGiveback - existing.lastRewarded;
      
      if (newGivebackAmount > 0) {
        const reward = Math.floor(newGivebackAmount * (percentage / 100));
        
        if (reward > 0) {
          distributions.push({
            userId: user.id,
            name: user.name,
            location: `${user.area || ''} ${user.city || ''}`.trim() || 'Unknown',
            totalGiveback: totalGiveback,
            previouslyRewarded: existing.lastRewarded,
            newGivebackAmount: newGivebackAmount,
            calculatedReward: reward,
            actualReward: 0
          });
          totalToDistribute += reward;
        }
      }
    }

    console.log(`   Total calculated rewards: ${totalToDistribute}`);
    console.log(`   Available pool: ${availablePool}`);

    // 8. Adjust rewards if pool is insufficient
    let actualDistributed = 0;

    if (totalToDistribute <= availablePool) {
      for (const d of distributions) {
        d.actualReward = d.calculatedReward;
        actualDistributed += d.actualReward;
      }
    } else {
      const ratio = availablePool / totalToDistribute;
      for (const d of distributions) {
        d.actualReward = Math.floor(d.calculatedReward * ratio);
        actualDistributed += d.actualReward;
      }
    }

    // 9. Create transactions and update balances
    const recipientsList = [];
    const transactionsToCreate = [];

    for (const d of distributions) {
      if (d.actualReward > 0) {
        transactionsToCreate.push({
          fromUserId: donorId,
          toUserId: d.userId,
          bubbleAmount: d.actualReward,
          type: 'transfer',
          status: 'completed',
          giveaway: 1,
          description: `${category} Giveaway (${percentage}% of ${d.newGivebackAmount} giveback)`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        recipientsList.push({
          rank: recipientsList.length + 1,
          userId: d.userId,
          name: d.name,
          location: d.location,
          totalGiveback: d.totalGiveback,
          newGiveback: d.newGivebackAmount,
          received: d.actualReward,
        });
      }
    }

    if (transactionsToCreate.length > 0) {
      await BubbleTransaction.bulkCreate(transactionsToCreate, { transaction: t });
    }

    // Update user balances and reward tracking
    for (const d of distributions) {
      if (d.actualReward > 0) {
        await sequelize.query(`
          UPDATE users SET bubblesCount = bubblesCount + :amount WHERE id = :userId
        `, {
          replacements: { amount: d.actualReward, userId: d.userId },
          transaction: t
        });

        await sequelize.query(`
          INSERT INTO user_giveaway_rewards (userId, category, lastRewardedGivebackAmount, totalRewardsReceived, lastRewardedAt, createdAt, updatedAt)
          VALUES (:userId, :category, :lastRewarded, :totalReceived, NOW(), NOW(), NOW())
          ON DUPLICATE KEY UPDATE 
            lastRewardedGivebackAmount = :lastRewarded,
            totalRewardsReceived = totalRewardsReceived + :reward,
            lastRewardedAt = NOW(),
            updatedAt = NOW()
        `, {
          replacements: { 
            userId: d.userId, 
            category,
            lastRewarded: d.totalGiveback,
            totalReceived: d.actualReward,
            reward: d.actualReward
          },
          transaction: t
        });
      }
    }

    // 10. Update giveaway pool
    const holdAmount = availablePool - actualDistributed;
    giveaway.totalAmount = 0;
    giveaway.holdAmount = holdAmount;
    giveaway.totalDonated = (giveaway.totalDonated || 0) + bubbles;
    await giveaway.save({ transaction: t });

    console.log(`   Actually distributed: ${actualDistributed}`);
    console.log(`   Moved to hold: ${holdAmount}`);

    await t.commit();

    const updatedDonor = await User.findByPk(donorId, {
      attributes: ['id', 'name', 'email', 'bubblesCount', 'queuePosition', 'queueBubbles', 'queueSlots']
    });

    res.json({
      success: true,
      message: `Distributed ${actualDistributed} bubbles to ${recipientsList.length} users based on ${percentage}% of their giveback`,
      distribution: {
        giveawayId: giveaway.id,
        category,
        percentage: percentage,
        totalDonated: bubbles,
        totalDistributed: actualDistributed,
        heldForLater: holdAmount,
        recipientCount: recipientsList.length,
        recipients: recipientsList,
        location: location || 'All',
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
    res.status(400).json({ message: e.message || 'Donation failed' });
  }
});

router.get('/giveaway/eligible-users/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { location } = req.query;
    const donorId = req.user.id;

    const giveaway = await Giveaway.findOne({
      where: { category, distributed: false },
      attributes: ['id', 'percentagePerUser', 'totalAmount', 'holdAmount', 'isActive']
    });

    if (!giveaway) {
      return res.status(404).json({ message: `No active ${category} giveaway` });
    }

    if (!giveaway.isActive) {
      return res.json({
        eligibleCount: 0,
        percentage: giveaway.percentagePerUser || 25,
        availablePool: 0,
        topDonors: [],
        isActive: false,
        disabledMessage: `${category} giveaway is currently disabled by admin`
      });
    }

    const percentage = parseFloat(giveaway.percentagePerUser) || 25;
    const availablePool = (giveaway.totalAmount || 0) + (giveaway.holdAmount || 0);

    // ✅ FIXED: Use subquery to avoid HAVING alias issue
    let query = `
      SELECT 
        sub.id,
        sub.name,
        sub.area,
        sub.city,
        sub.totalGiveback,
        sub.lastRewarded
      FROM (
        SELECT 
          u.id, 
          u.name, 
          u.area, 
          u.city,
          COALESCE(SUM(bt.bubbleAmount), 0) AS totalGiveback,
          COALESCE(MAX(ugr.lastRewardedGivebackAmount), 0) AS lastRewarded
        FROM users u
        JOIN bubble_transactions bt ON bt.fromUserId = u.id
        LEFT JOIN user_giveaway_rewards ugr ON ugr.userId = u.id AND ugr.category = :category
        WHERE u.isActive = 1 
          AND u.id != :donorId
          AND bt.type = 'back'
          AND bt.status = 'completed'
    `;

    if (location && location !== 'All') {
      const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar'];
      if (knownCities.includes(location)) {
        query += ` AND u.city = :location `;
      } else {
        query += ` AND (u.city = :location OR u.area = :location) `;
      }
    }

    query += `
        GROUP BY u.id, u.name, u.area, u.city
      ) AS sub
      WHERE sub.totalGiveback > sub.lastRewarded
      ORDER BY (sub.totalGiveback - sub.lastRewarded) DESC
    `;

    const eligibleUsers = await sequelize.query(query, {
      replacements: { donorId, category, ...(location && location !== 'All' ? { location } : {}) },
      type: sequelize.QueryTypes.SELECT,
    });

    const topDonors = eligibleUsers.slice(0, 5).map((user, index) => {
      const newGiveback = user.totalGiveback - user.lastRewarded;
      const potentialReward = Math.floor(newGiveback * (percentage / 100));
      
      return {
        rank: index + 1,
        userId: user.id,
        name: user.name,
        location: `${user.area || ''} ${user.city || ''}`.trim() || 'Unknown',
        totalGiveback: user.totalGiveback,
        newGiveback: newGiveback,
        potentialReward: potentialReward
      };
    });

    res.json({
      eligibleCount: eligibleUsers.length,
      percentage: percentage,
      availablePool: availablePool,
      holdAmount: giveaway.holdAmount || 0,
      topDonors,
      locationApplied: location && location !== 'All' ? location : 'All Locations',
      isActive: true
    });
  } catch (e) {
    console.error('❌ Get eligible users error:', e);
    res.status(400).json({ message: e.message || 'Failed to get eligible users' });
  }
});

router.get('/giveaway/eligible-cities', async (req, res) => {
  try {
    const cities = await sequelize.query(`
      SELECT DISTINCT u.city 
      FROM users u
      JOIN bubble_transactions bt ON bt.fromUserId = u.id
      WHERE u.isActive = 1
        AND u.city IS NOT NULL
        AND bt.type = 'back'
        AND bt.status = 'completed'
        
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
        AND bt.type = 'back'
        AND bt.status = 'completed'
        
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
      WHERE type = 'back'
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

router.get('/user/bubble-breakdown', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`\n💰 ==================== BUBBLE BREAKDOWN ====================`);
    console.log(`   User ID: ${userId}`);

    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'bubblesCount']
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log(`   User: ${user.name}`);
    console.log(`   Current Total: ${user.bubblesCount} bubbles`);
    console.log(`   ────────────────────────────────────────────────────────`);

    console.log(`   🔥 Fetching LATEST deposit...`);
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

    console.log(`   🔥 Checking SUPPORT RECEIVED bubbles...`);
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

    console.log(`   🔥 Checking GIVEAWAY bubbles...`);
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

    console.log(`   ────────────────────────────────────────────────────────`);
    console.log(`   📊 BREAKDOWN:`);
    console.log(`      Latest Deposit:   ${depositedBubbles}`);
    console.log(`      From Support:     ${supportReceivedBubbles}`);
    console.log(`      From Giveaway:    ${giveawayBubbles}`);
    console.log(`      ────────────────────`);
    console.log(`      Current Balance:  ${user.bubblesCount}`);
    console.log(`   ══════════════════════════════════════════════════════\n`);

    const response = {
      depositedBubbles: depositedBubbles,
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

router.get('/user/bubble-diagnostic', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`\n🔍 [DIAGNOSTIC] Checking transactions for user ${userId}`);

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

    const typeBreakdown = {
      support: receivedTransactions.filter(t => t.type === 'support').length,
      transfer: receivedTransactions.filter(t => t.type === 'transfer').length,
      donation: receivedTransactions.filter(t => t.type === 'donation').length,
      other: receivedTransactions.filter(t => !['support', 'transfer', 'donation'].includes(t.type)).length,
    };

    const giveawayBreakdown = {
      giveaway: receivedTransactions.filter(t => t.giveaway === 1).length,
      nonGiveaway: receivedTransactions.filter(t => t.giveaway === 0 || t.giveaway === null).length,
    };

    const bubbleBreakdown = {
      totalFromGiveaway: receivedTransactions
        .filter(t => t.giveaway === 1)
        .reduce((sum, t) => sum + parseInt(t.bubbleAmount), 0),
      totalFromSupport: receivedTransactions
        .filter(t => t.giveaway === 0 || t.giveaway === null)
        .reduce((sum, t) => sum + parseInt(t.bubbleAmount), 0),
    };

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

router.get('/back-owed', async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('\n💸 /back-owed called for user:', userId);
    
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'bubblesReceived']
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const returnedResult = await sequelize.query(`
      SELECT COALESCE(SUM(bubbleAmount), 0) as totalReturned
      FROM bubble_transactions
      WHERE fromUserId = :userId
        AND type = 'back'
        AND status = 'completed'
    `, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT
    });
    
    const totalReturned = parseInt(returnedResult[0].totalReturned) || 0;
    const totalReceived = parseInt(user.bubblesReceived) || 0;
    const totalOwed = totalReceived - totalReturned;
    
    console.log('💸 Received:', totalReceived, '| Returned:', totalReturned, '| Owed:', totalOwed);
    
    const data = totalOwed > 0 ? [{
      id: 'total',
      name: 'All Supporters',
      email: null,
      received: totalReceived,
      returned: totalReturned,
      owed: totalOwed
    }] : [];
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('❌ Error fetching owed bubbles:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/give-back', async (req, res) => {
  const t = await sequelize.transaction();
  
  try {
    const { bubbleAmount } = req.body;
    const fromUserId = req.user.id;

    console.log('\n💸 ==================== GIVE-BACK REQUEST ====================');
    console.log(`   User ID: ${fromUserId}`);
    console.log(`   Amount: ${bubbleAmount}`);

    if (!bubbleAmount || bubbleAmount <= 0) {
      await t.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid bubble amount' 
      });
    }

    const fromUser = await User.findByPk(fromUserId, { transaction: t });
    if (!fromUser) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'User not found' });
    }
    
    if (fromUser.bubblesCount < bubbleAmount) {
      await t.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient bubbles' 
      });
    }
    
    // Check how much user has already returned
    const returnedResult = await sequelize.query(`
      SELECT COALESCE(SUM(bubbleAmount), 0) as totalReturned
      FROM bubble_transactions
      WHERE fromUserId = :fromUserId
        AND type = 'back'
        AND status = 'completed'
    `, {
      replacements: { fromUserId },
      type: sequelize.QueryTypes.SELECT,
      transaction: t
    });
    
    const totalReturned = parseInt(returnedResult[0].totalReturned) || 0;
    const totalReceived = parseInt(fromUser.bubblesReceived) || 0;
    const actualOwed = totalReceived - totalReturned;
    
    if (actualOwed <= 0) {
      await t.rollback();
      return res.status(400).json({ 
        success: false, 
        message: 'No bubbles owed' 
      });
    }

    const amountToGiveBack = Math.min(bubbleAmount, actualOwed);

    // ========== DEDUCT BUBBLES FROM USER ==========
    await fromUser.update({ 
      bubblesCount: fromUser.bubblesCount - amountToGiveBack 
    }, { transaction: t });

    // ========== CREATE BACK TRANSACTION ==========
    const bubbleTransaction = await BubbleTransaction.create({
      fromUserId,
      toUserId: fromUserId,
      bubbleAmount: amountToGiveBack,
      type: 'back',
      status: 'completed',
      description: `Returned ${amountToGiveBack} bubbles`
    }, { transaction: t });

    console.log(`   ✅ Created back transaction: ${bubbleTransaction.id}`);

    // ========== AUTOMATIC GIVEAWAY REWARDS FROM ALL CATEGORIES ==========
    // Check all active giveaways and give rewards from holdAmount
    
    // ========== AUTOMATIC GIVEAWAY REWARDS FROM ALL CATEGORIES ==========
const [activeGiveaways] = await sequelize.query(`
  SELECT id, category, percentagePerUser, holdAmount, totalDonated, setByAdminId
  FROM giveaways 
  WHERE distributed = 0 
    AND isActive = 1
    AND holdAmount > 0
`, { transaction: t });

let totalRewardGiven = 0;
const rewardsBreakdown = [];

for (const giveaway of activeGiveaways) {
  const category = giveaway.category;
  const percentagePerUser = parseFloat(giveaway.percentagePerUser) || 25;
  const availableHold = parseInt(giveaway.holdAmount) || 0;
  const adminId = giveaway.setByAdminId || 1; // Use admin who set up giveaway, or fallback to ID 1

  // Calculate reward based on this giveback amount
  const calculatedReward = Math.floor(amountToGiveBack * (percentagePerUser / 100));
  
  // Only give what's available in holdAmount
  const actualReward = Math.min(calculatedReward, availableHold);

  if (actualReward > 0) {
    console.log(`   📊 ${category}: Calculated ${calculatedReward}, Available ${availableHold}, Giving ${actualReward}`);

    // Deduct from giveaway holdAmount
    await sequelize.query(`
      UPDATE giveaways 
      SET holdAmount = holdAmount - :actualReward,
          updatedAt = NOW()
      WHERE id = :giveawayId
    `, {
      replacements: { actualReward, giveawayId: giveaway.id },
      transaction: t
    });

    // Update or insert user_giveaway_rewards tracking
    const [existingReward] = await sequelize.query(`
      SELECT id FROM user_giveaway_rewards
      WHERE userId = :userId AND category = :category
    `, {
      replacements: { userId: fromUserId, category },
      transaction: t
    });

    if (existingReward && existingReward.length > 0) {
      await sequelize.query(`
        UPDATE user_giveaway_rewards 
        SET lastRewardedGivebackAmount = lastRewardedGivebackAmount + :amountToGiveBack,
            totalRewardsReceived = totalRewardsReceived + :actualReward,
            lastRewardedAt = NOW(),
            updatedAt = NOW()
        WHERE userId = :userId AND category = :category
      `, {
        replacements: { amountToGiveBack, actualReward, userId: fromUserId, category },
        transaction: t
      });
    } else {
      await sequelize.query(`
        INSERT INTO user_giveaway_rewards 
          (userId, category, lastRewardedGivebackAmount, totalRewardsReceived, lastRewardedAt, createdAt, updatedAt)
        VALUES 
          (:userId, :category, :amountToGiveBack, :actualReward, NOW(), NOW(), NOW())
      `, {
        replacements: { userId: fromUserId, category, amountToGiveBack, actualReward },
        transaction: t
      });
    }

    // ✅ FIXED: Create reward transaction - fromUserId is admin/system, NOT the user
    await BubbleTransaction.create({
      fromUserId: adminId,        // FROM giveaway (admin who set it up)
      toUserId: fromUserId,       // TO the user receiving reward
      bubbleAmount: actualReward,
      type: 'giveaway_reward',
      status: 'completed',
      giveaway: 1,
      description: `${category} Giveaway Reward (${percentagePerUser}% of ${amountToGiveBack})`
    }, { transaction: t });

    totalRewardGiven += actualReward;
    rewardsBreakdown.push({
      category,
      percentage: percentagePerUser,
      reward: actualReward
    });

    console.log(`   ✅ ${category}: Gave ${actualReward} bubbles as reward`);
  }
}

    // ========== ADD TOTAL REWARDS TO USER BALANCE ==========
    if (totalRewardGiven > 0) {
      await fromUser.reload({ transaction: t });
      await fromUser.update({ 
        bubblesCount: fromUser.bubblesCount + totalRewardGiven 
      }, { transaction: t });
      console.log(`   💰 Total rewards given: ${totalRewardGiven} bubbles`);
    }

    await t.commit();

    // Fetch updated user balance
    const updatedUser = await User.findByPk(fromUserId, {
      attributes: ['bubblesCount']
    });

    console.log('   ==================== GIVE-BACK COMPLETE ====================\n');

    res.json({
      success: true,
      message: totalRewardGiven > 0 
        ? `Returned ${amountToGiveBack} bubbles and received ${totalRewardGiven} as giveaway rewards!`
        : `Returned ${amountToGiveBack} bubbles successfully`,
      data: {
        transaction: bubbleTransaction,
        amountReturned: amountToGiveBack,
        remainingOwed: actualOwed - amountToGiveBack,
        totalRewardGiven: totalRewardGiven,
        rewardsBreakdown: rewardsBreakdown,
        newBalance: updatedUser.bubblesCount
      }
    });

  } catch (error) {
    await t.rollback();
    console.error('❌ Error giving back bubbles:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// NEW: Fix corrupted slotProgress for a specific user
// ============================================================
router.post('/fix-slot-progress/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Only allow admin or the user themselves
    if (req.user.id !== parseInt(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`\n🔧 FIXING slotProgress for user ${userId}`);
    console.log('Before:', user.slotProgress);
    
    const queueSlots = parseInt(user.queueSlots) || 0;
    
    // Create clean slotProgress
    const cleanProgress = {};
    for (let i = 1; i <= queueSlots; i++) {
      cleanProgress[i.toString()] = 0;
    }
    
    // Save with explicit stringify
    user.slotProgress = JSON.stringify(cleanProgress);
    await user.save();
    
    console.log('After:', user.slotProgress);
    
    res.json({
      success: true,
      message: 'slotProgress fixed',
      before: 'corrupted',
      after: cleanProgress
    });
    
  } catch (error) {
    console.error('Fix slotProgress error:', error);
    res.status(400).json({ message: error.message });
  }
});

// ============================================================
// NEW: Fix ALL corrupted slotProgress (admin only)
// ============================================================
router.post('/fix-all-slot-progress', async (req, res) => {
  try {
    // Only allow admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin only' });
    }
    
    const users = await User.findAll({
      where: {
        queueSlots: { [Op.gt]: 0 }
      }
    });
    
    const fixed = [];
    
    for (const user of users) {
      const queueSlots = parseInt(user.queueSlots) || 0;
      const validated = validateAndFixSlotProgress(user.slotProgress, queueSlots);
      
      // Check if it was corrupted
      const raw = user.slotProgress;
      let wasCorrupted = false;
      
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          const keys = Object.keys(parsed);
          if (keys.length > queueSlots + 5) {
            wasCorrupted = true;
          }
        } catch (e) {
          wasCorrupted = true;
        }
      }
      
      if (wasCorrupted) {
        user.slotProgress = JSON.stringify(validated);
        await user.save();
        fixed.push({
          userId: user.id,
          name: user.name,
          slots: queueSlots,
          newProgress: validated
        });
        console.log(`🔧 Fixed user ${user.id} (${user.name})`);
      }
    }
    
    res.json({
      success: true,
      fixedCount: fixed.length,
      fixed: fixed
    });
    
  } catch (error) {
    console.error('Fix all slotProgress error:', error);
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;