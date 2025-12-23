// routes/get.js - COMPLETE VERSION
// routes/get.js - COMPLETE VERSION
const express = require('express');
const auth = require('../middleware/auth');
const { User, BubbleTransaction, Giveaway } = require('../models'); // âœ… Added Giveaway
const { literal, Op } = require('sequelize');
const sequelize = require('../config/database'); // âœ… Added this line

const router = express.Router();
router.use(auth);



// Add this helper function at the top of get.js file
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

// Add new endpoint for available cities
router.get('/available-cities', async (req, res) => {
  try {
    const cities = await getCitiesWithUsers();
    res.json(cities);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Add new endpoint for available areas
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
    
    // Get current user with location info AND slotProgress
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
    
    // Base conditions - exclude current user from OTHER users search
    let whereConditions = {
      id: { [Op.ne]: req.user.id },
      bubblesCount: { [Op.gt]: 0 },
      isActive: true,
      queuePosition: { [Op.gt]: 0 }
    };

    // Apply location filter based on selected option
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

    // Get OTHER users with location filtering AND slotProgress
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
    
    // FILTER BASED ON QUEUE RULES
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

    // CREATE MULTIPLE CARDS FOR USERS WITH MULTIPLE QUEUE SLOTS
    // CREATE MULTIPLE CARDS FOR USERS WITH MULTIPLE QUEUE SLOTS
const expandedUsers = [];

for (const user of filteredUsers) {
  const queueSlots = parseInt(user.queueSlots) || 1;
  const bubblesCount = parseInt(user.bubblesCount);
  const baseQueuePosition = parseInt(user.queuePosition) || 0;
  const requiredBubbles = 400;
  const distance = user.getDataValue ? parseFloat(user.getDataValue('distance')).toFixed(1) : '0.0';
  const isOwnCard = false;

  // Parse slotProgress JSON - CRITICAL FIX
  let slotProgress = user.slotProgress || {};
  if (typeof slotProgress === 'string') {
    try {
      slotProgress = JSON.parse(slotProgress);
    } catch (e) {
      console.error('Error parsing slotProgress for user', user.id, ':', e);
      slotProgress = {};
    }
  }

  console.log(`Processing user ${user.name} - slotProgress:`, slotProgress); // DEBUG LOG

  const locationParts = [];
  if (user.area) locationParts.push(user.area);
  if (user.city && user.city !== user.area) locationParts.push(user.city);
  if (user.province && user.province !== user.city) locationParts.push(user.province);
  const locationDisplay = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown';

  // Create cards for each queue slot with INCREMENTAL queue positions
  for (let slotIndex = 0; slotIndex < queueSlots; slotIndex++) {
    const slotNumber = slotIndex + 1;
    const currentQueuePosition = baseQueuePosition + slotIndex;
    
    // CRITICAL FIX: Get progress for THIS specific slot from slotProgress JSON
    const currentSlotProgress = parseInt(slotProgress[slotNumber.toString()] || 0);
    const remainingForSlot = requiredBubbles - currentSlotProgress;
    const queueProgressPercent = requiredBubbles > 0 ? Math.round((currentSlotProgress / requiredBubbles) * 100) : 0;

    // Color based on CURRENT queue position
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
    const description = `Queue #${currentQueuePosition}${slotLabel} â€¢ ${currentSlotProgress}/${requiredBubbles} (${queueProgressPercent}%) â€¢ ${locationDisplay}`;
    
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
      queueProgress: currentSlotProgress, // ACTUAL progress for this slot
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

    // Sort by queue position
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



// router.get('/nearby', async (req, res) => {
//   try {
//     const { lat, lng, radius = 10, location } = req.query;
//     console.log('Backend - Nearby request params:', { lat, lng, radius, location, userId: req.user.id });
    
//     if (!lat || !lng) {
//       return res.status(400).json({ message: 'Latitude and longitude are required' });
//     }
    
//     const userLat = parseFloat(lat);
//     const userLng = parseFloat(lng);
//     const searchRadius = parseFloat(radius);
    
//     if (isNaN(userLat) || isNaN(userLng) || isNaN(searchRadius)) {
//       return res.status(400).json({ message: 'Invalid coordinates or radius' });
//     }
    
//     console.log('Backend - Searching from coordinates:', { userLat, userLng, searchRadius, location });
    
//     // Get current user with location info AND slotProgress
//     const currentUser = await User.findByPk(req.user.id, {
//       attributes: ['id', 'name', 'queuePosition', 'queueSlots', 'queueBubbles', 'requiredBubbles', 'bubblesCount', 'country', 'province', 'city', 'area', 'lat', 'lng', 'slotProgress']
//     });

//     if (!currentUser) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     console.log('Current user queue status:', {
//       id: currentUser.id,
//       queuePosition: currentUser.queuePosition,
//       queueSlots: currentUser.queueSlots,
//       inQueue: currentUser.queuePosition > 0,
//       slotProgress: currentUser.slotProgress
//     });

//     const distanceFormula = literal(`(
//       6371 * acos(
//         cos(radians(${userLat})) * 
//         cos(radians(lat)) * 
//         cos(radians(lng) - radians(${userLng})) + 
//         sin(radians(${userLat})) * 
//         sin(radians(lat))
//       )
//     )`);
    
//     // Base conditions - exclude current user from OTHER users search
//     let whereConditions = {
//       id: { [Op.ne]: req.user.id },
//       bubblesCount: { [Op.gt]: 0 },
//       isActive: true,
//       queuePosition: { [Op.gt]: 0 }
//     };

//     // Apply location filter based on selected option
//     if (location && location !== 'All') {
//       console.log('Applying location filter to DATABASE users:', location);
      
//       const knownCities = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Quetta', 'Peshawar', 'Sukkur', 'Larkana', 'Mirpurkhas', 'Gwadar', 'Turbat', 'Khuzdar', 'Mardan', 'Abbottabad', 'Swat', 'Gujranwala', 'Sialkot'];
//       const knownAreas = ['Bahria Town', 'DHA', 'Clifton', 'Gulshan', 'Malir', 'Saddar', 'North Nazimabad', 'Gulberg', 'Johar Town', 'Model Town', 'Latifabad', 'Qasimabad', 'Cantonment', 'Hussainabad', 'F-6', 'F-7', 'F-8', 'G-6', 'G-7', 'Blue Area'];
      
//       if (knownCities.includes(location)) {
//         whereConditions.city = location;
//         console.log('Filtering by CITY:', location);
//       } else if (knownAreas.includes(location)) {
//         whereConditions.area = location;
//         console.log('Filtering by AREA:', location);
//       } else {
//         whereConditions[Op.or] = [
//           { country: location },
//           { province: location },
//           { city: location },
//           { area: location }
//         ];
//         console.log('Filtering by ANY location field:', location);
//       }
//     }
    
//     console.log('Backend - Final WHERE conditions:', JSON.stringify(whereConditions, null, 2));

//     // Get OTHER users with location filtering AND slotProgress
//     const users = await User.findAll({
//       attributes: [
//         'id', 'name', 'email', 'lat', 'lng', 'bubblesCount',
//         'country', 'province', 'city', 'area',
//         'queuePosition', 'queueBubbles', 'requiredBubbles', 'queueSlots', 'slotProgress',
//         [distanceFormula, 'distance']
//       ],
//       where: whereConditions,
//       having: literal(`distance < ${searchRadius}`),
//       order: [
//         ['queuePosition', 'ASC'],
//         ['bubblesCount', 'DESC'],
//         [literal('distance'), 'ASC']
//       ],
//       limit: 50
//     });
    
//     console.log(`Backend - Found ${users.length} other users in queue with location filter: ${location || 'All'}`);
    
//     if (users.length > 0) {
//       console.log('Returned users locations:', users.map(u => ({ name: u.name, city: u.city, area: u.area })));
//     }
    
//     // FILTER BASED ON QUEUE RULES
//     const filteredUsers = [];
//     const currentUserInQueue = currentUser.queuePosition > 0;

//     for (const user of users) {
//       if (!currentUserInQueue) {
//         if (user.queuePosition === 1) {
//           filteredUsers.push(user);
//           console.log(`Showing user ${user.name} (Queue #1, ${user.area}) to non-queue user`);
//         }
//       } else {
//         if (user.queuePosition < currentUser.queuePosition) {
//           filteredUsers.push(user);
//           console.log(`Showing user ${user.name} (Queue #${user.queuePosition}, ${user.area}) to user in queue #${currentUser.queuePosition}`);
//         }
//       }
//     }

//     // ADD CURRENT USER'S OWN QUEUE CARDS (if they are in queue)
//     if (currentUserInQueue) {
//       let includeOwnCards = false;
      
//       if (!location || location === 'All') {
//         includeOwnCards = true;
//       } else {
//         if (currentUser.city === location || currentUser.area === location) {
//           includeOwnCards = true;
//         }
//       }
      
//       if (includeOwnCards) {
//         filteredUsers.push({
//           id: currentUser.id,
//           name: currentUser.name,
//           email: currentUser.email,
//           lat: currentUser.lat,
//           lng: currentUser.lng,
//           bubblesCount: currentUser.bubblesCount,
//           country: currentUser.country,
//           province: currentUser.province,
//           city: currentUser.city,
//           area: currentUser.area,
//           queuePosition: currentUser.queuePosition,
//           queueBubbles: currentUser.queueBubbles,
//           requiredBubbles: currentUser.requiredBubbles,
//           queueSlots: currentUser.queueSlots,
//           slotProgress: currentUser.slotProgress,
//           getDataValue: (field) => {
//             if (field === 'distance') return 0;
//             return currentUser[field];
//           },
//           isOwnCard: true
//         });
//         console.log(`Added current user's own ${currentUser.queueSlots} queue cards`);
//       } else {
//         console.log(`Current user cards NOT included - location filter '${location}' doesn't match`);
//       }
//     }

//     // CREATE MULTIPLE CARDS FOR USERS WITH MULTIPLE QUEUE SLOTS
//     const expandedUsers = [];

//     for (const user of filteredUsers) {
//       const queueSlots = parseInt(user.queueSlots) || 1;
//       const bubblesCount = parseInt(user.bubblesCount);
//       const baseQueuePosition = parseInt(user.queuePosition) || 0;
//       const requiredBubbles = 400;
//       const distance = user.getDataValue ? parseFloat(user.getDataValue('distance')).toFixed(1) : '0.0';
//       const isOwnCard = user.isOwnCard || false;

//       // Parse slotProgress JSON
//       let slotProgress = user.slotProgress || {};
//       if (typeof slotProgress === 'string') {
//         try {
//           slotProgress = JSON.parse(slotProgress);
//         } catch (e) {
//           console.error('Error parsing slotProgress:', e);
//           slotProgress = {};
//         }
//       }

//       const locationParts = [];
//       if (user.area) locationParts.push(user.area);
//       if (user.city && user.city !== user.area) locationParts.push(user.city);
//       if (user.province && user.province !== user.city) locationParts.push(user.province);
//       const locationDisplay = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown';

//       // Create cards for each queue slot with INCREMENTAL queue positions
//       for (let slotIndex = 0; slotIndex < queueSlots; slotIndex++) {
//         const slotNumber = slotIndex + 1;
//         const currentQueuePosition = baseQueuePosition + slotIndex;
        
//         // Get progress for THIS specific slot from slotProgress JSON
//         const currentSlotProgress = slotProgress[slotNumber.toString()] || 0;
//         const remainingForSlot = requiredBubbles - currentSlotProgress;
//         const queueProgress = requiredBubbles > 0 ? Math.round((currentSlotProgress / requiredBubbles) * 100) : 0;

//         // Color based on CURRENT queue position
//         let creatorColor = '#10b981';
//         if (isOwnCard) {
//           creatorColor = '#8b5cf6';
//         } else if (currentQueuePosition > 0) {
//           if (currentQueuePosition === 1) {
//             creatorColor = '#ef4444';
//           } else if (currentQueuePosition <= 5) {
//             creatorColor = '#f59e0b';
//           } else if (currentQueuePosition <= 10) {
//             creatorColor = '#3b82f6';
//           } else {
//             creatorColor = '#10b981';
//           }
//         }

//         const slotLabel = queueSlots > 1 ? ` [Slot ${slotNumber}/${queueSlots}]` : '';
//         const ownLabel = isOwnCard ? ' ðŸ‘¤ YOU' : '';
//         const description = `Queue #${currentQueuePosition}${slotLabel}${ownLabel} â€¢ ${currentSlotProgress}/${requiredBubbles} (${queueProgress}%) â€¢ ${locationDisplay}`;
        
//         console.log(`Creating card for ${user.name} slot ${slotNumber}: progress ${currentSlotProgress}/${requiredBubbles}, remaining ${remainingForSlot}`);
        
//         expandedUsers.push({
//           id: `${user.id}-slot-${slotIndex}`,
//           userId: user.id,
//           userName: user.name,
//           bubbleAmount: bubblesCount,
//           totalBubbles: bubblesCount,
//           creatorColor: creatorColor,
//           description: description,
//           distance: distance,
//           lat: user.lat,
//           lng: user.lng,
          
//           country: user.country,
//           province: user.province,
//           city: user.city,
//           area: user.area,
//           locationDisplay: locationDisplay,
          
//           queuePosition: currentQueuePosition,
//           queueProgress: currentSlotProgress, // ACTUAL progress for this slot
//           queueRequired: requiredBubbles,
//           queueProgressPercent: queueProgress,
//           remainingForSlot: remainingForSlot, // How much is still needed
//           queueSlots: queueSlots,
//           slotIndex: slotIndex,
//           slotNumber: slotNumber, // 1-indexed slot number
//           baseQueuePosition: baseQueuePosition,
          
//           isInQueue: currentQueuePosition > 0,
//           canSupport: !isOwnCard && bubblesCount > 0,
//           isOwnCard: isOwnCard
//         });
//       }
//     }

//     // Sort by queue position
//     expandedUsers.sort((a, b) => a.queuePosition - b.queuePosition);

//     console.log(`Backend - Returning ${expandedUsers.length} cards with slot progress data`);
    
//     if (!currentUserInQueue && expandedUsers.length === 0) {
//       console.log('Backend - No Queue #1 user found for non-queue user');
//     }

//     res.json(expandedUsers);
//   } catch (error) {
//     console.error('Backend - Nearby users error:', error);
//     res.status(400).json({ message: error.message || 'Failed to get nearby users' });
//   }
// });


// router.get('/incomplete-queue', async (req, res) => {
//   try {
//     console.log('Backend - Getting incomplete queue cards for user:', req.user.id);
    
//     const currentUser = await User.findByPk(req.user.id);
//     if (!currentUser || currentUser.queuePosition === 0) {
//       return res.json([]);
//     }

//     // Parse slotProgress JSON
//     let slotProgress = {};
//     try {
//       slotProgress = currentUser.slotProgress ? JSON.parse(currentUser.slotProgress) : {};
//     } catch (error) {
//       console.error('Error parsing slotProgress:', error);
//       slotProgress = {};
//     }

//     const requiredBubbles = currentUser.requiredBubbles || 400;
//     const cards = [];

//     // Get supporter counts for each slot
//     const transactions = await BubbleTransaction.findAll({
//       where: {
//         toUserId: currentUser.id,
//         status: 'completed'
//       },
//       order: [['createdAt', 'ASC']],
//       raw: true
//     });

//     // Calculate which supporters contributed to which slots
//     const slotSupporters = {};
//     let cumulativeBubbles = 0;
    
//     for (const tx of transactions) {
//       const startCumulative = cumulativeBubbles;
//       cumulativeBubbles += tx.bubbleAmount;
      
//       const startSlot = Math.floor(startCumulative / requiredBubbles) + 1;
//       const endSlot = Math.floor((cumulativeBubbles - 1) / requiredBubbles) + 1;
      
//       for (let slotNum = startSlot; slotNum <= endSlot; slotNum++) {
//         if (!slotSupporters[slotNum]) {
//           slotSupporters[slotNum] = new Set();
//         }
        
//         const slotStart = (slotNum - 1) * requiredBubbles;
//         const slotEnd = slotNum * requiredBubbles;
        
//         const contributionStart = Math.max(startCumulative, slotStart);
//         const contributionEnd = Math.min(cumulativeBubbles, slotEnd);
//         const contribution = contributionEnd - contributionStart;
        
//         if (contribution > 0) {
//           slotSupporters[slotNum].add(tx.fromUserId);
//         }
//       }
//     }

//     // Create cards for incomplete slots that have supporters
//     for (const [slotNum, progress] of Object.entries(slotProgress)) {
//       const slotNumber = parseInt(slotNum);
//       const slotProgressValue = parseInt(progress);
      
//       // Only show slots that are incomplete and have at least 1 supporter
//       if (slotProgressValue > 0 && slotProgressValue < requiredBubbles && slotSupporters[slotNumber]?.size > 0) {
//         cards.push({
//           id: `active-slot-${slotNumber}`,
//           userId: currentUser.id,
//           userName: currentUser.name,
//           bubbleAmount: currentUser.bubblesCount,
//           queuePosition: currentUser.queuePosition,
//           queueProgress: slotProgressValue,
//           queueRequired: requiredBubbles,
//           queueProgressPercent: Math.round((slotProgressValue / requiredBubbles) * 100),
//           slotNumber: slotNumber,
//           supporterCount: slotSupporters[slotNumber].size,
//           isOwnCard: true,
//           creatorColor: currentUser.color || '#f59e0b',
//           area: currentUser.area,
//           city: currentUser.city,
//           locationDisplay: currentUser.area && currentUser.city 
//             ? `${currentUser.area}, ${currentUser.city}` 
//             : (currentUser.city || currentUser.area || 'Unknown'),
//           description: `Queue #${slotNumber} â€¢ ${slotProgressValue}/${requiredBubbles} (${Math.round((slotProgressValue / requiredBubbles) * 100)}%) â€¢ ${currentUser.area || currentUser.city || 'Unknown'}`,
//         });
//       }
//     }

//     // Sort by slot number
//     cards.sort((a, b) => a.slotNumber - b.slotNumber);

//     console.log(`Backend - Found ${cards.length} active slots for user ${currentUser.id}`);
//     res.json(cards);
//   } catch (error) {
//     console.error('Backend - Incomplete queue error:', error);
//     res.status(400).json({ message: error.message });
//   }
// });


router.get('/incomplete-queue', async (req, res) => {
  try {
    console.log('Backend - Getting incomplete queue cards for user:', req.user.id);
    
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser || currentUser.queuePosition === 0) {
      console.log('Backend - User not in queue or not found:', { userId: req.user.id, queuePosition: currentUser?.queuePosition });
      return res.json([]);
    }

    // Parse slotProgress JSON
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

    // Get supporter counts for each slot
    const transactions = await BubbleTransaction.findAll({
      where: {
        toUserId: currentUser.id,
        status: 'completed'
      },
      order: [['createdAt', 'ASC']],
      raw: true
    });

    // Calculate which supporters contributed to which slots
    const slotSupporters = {};
    const slotFirstTransaction = {}; // ADD THIS LINE - Track first transaction date per slot

    let cumulativeBubbles = 0;
    
    for (const tx of transactions) {
      const startCumulative = cumulativeBubbles;
      cumulativeBubbles += tx.bubbleAmount;
      
      const startSlot = Math.floor(startCumulative / requiredBubbles) + 1;
      const endSlot = Math.floor((cumulativeBubbles - 1) / requiredBubbles) + 1;
      
      for (let slotNum = startSlot; slotNum <= endSlot; slotNum++) {
        if (!slotSupporters[slotNum]) {
          slotSupporters[slotNum] = new Set();
          slotFirstTransaction[slotNum] = tx.createdAt; // ADD THIS LINE - Store first transaction date

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

    // Create cards for ALL incomplete slots
    for (let slotNum = 1; slotNum <= queueSlots; slotNum++) {
      const slotProgressValue = parseInt(slotProgress[slotNum] || 0);
      const supporterCount = slotSupporters[slotNum]?.size || 0;
      
      // Include slot if it's incomplete (progress < requiredBubbles)
      if (slotProgressValue < requiredBubbles) {
        const queueProgressPercent = requiredBubbles > 0 ? Math.round((slotProgressValue / requiredBubbles) * 100) : 0;
        const locationDisplay = currentUser.area && currentUser.city 
          ? `${currentUser.area}, ${currentUser.city}` 
          : (currentUser.city || currentUser.area || 'Unknown');
        const description = `Queue #${slotNum} â€¢ ${slotProgressValue}/${requiredBubbles} (${queueProgressPercent}%) â€¢ ${locationDisplay}`;
        
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
 // ADD THIS LINE

        });
      }
    }

    // Sort by slot number
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

    // Build supporter list with cumulative tracking
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
        
        // Track each transaction with cumulative position
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

    // Apply location filter
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

    // If slotNumber provided, filter for specific slot
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
      // For cumulative view (no slotNumber), exclude in-progress bubbles
      const user = await User.findByPk(userId);
      if (user) {
        const totalReceived = transactions.reduce((sum, tx) => sum + tx.bubbleAmount, 0);
        const completedSlots = Math.floor(totalReceived / 400);
        const totalCompleted = completedSlots * 400;
        const inProgress = totalReceived % 400;
        
        if (inProgress > 0) {
          // Adjust supporters to exclude in-progress portion
          const adjustedSupporters = [];
          
          for (const supporter of supporters) {
            let adjustedTotal = 0;
            
            for (const tx of supporter.transactions) {
              if (tx.cumulativeEnd <= totalCompleted) {
                // Entire transaction is in completed slots
                adjustedTotal += tx.amount;
              } else if (tx.cumulativeStart < totalCompleted) {
                // Transaction spans completed and in-progress
                adjustedTotal += totalCompleted - tx.cumulativeStart;
              }
              // If tx.cumulativeStart >= totalCompleted, entire transaction is in-progress, skip it
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
   
    // Sort by total supported (descending)
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
// Add new cumulative endpoint
router.get('/completed-cumulative', async (req, res) => {
  try {
    console.log('Backend - Getting cumulative completed for user:', req.user.id);
    
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

    res.json([{
  id: 'cumulative-total',
  userId: currentUser.id,
  userName: currentUser.name,
  bubbleAmount: totalCompleted,
  completedSlots: completedSlots,
  inProgressBubbles: inProgress,
  totalReceived: totalReceived,
  creatorColor: '#10b981',
  description: `${completedSlots} Completed Slots â€¢ ${totalCompleted} bubbles`,
  status: 'completed',
  isCumulative: true
}]);
  } catch (error) {
    console.error('Backend - Cumulative completed error:', error);
    res.status(400).json({ message: error.message });
  }
});


// Get leaderboard - ranks users by total bubbles supported
router.get('/leaderboard', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    console.log('Backend - Getting leaderboard, limit:', limit);
    
    // Get all completed support transactions grouped by supporter
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
    
    // Enrich with user details
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
        
        // Determine level based on total supported
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
    // Get users who supported me (I'm the receiver)
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
      
      // Determine description based on transaction type
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
        type: tx.type, // ADD THIS - pass type to frontend
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
    
    // Get all sent transactions (grouped by recipient)
    const sentTransactions = await BubbleTransaction.findAll({
      where: { 
        fromUserId: req.user.id, 
        status: 'completed' 
      },
      attributes: [
        'toUserId',
        'type', // ADD THIS
        [literal('SUM(bubbleAmount)'), 'totalBubbles'],
        [literal('COUNT(*)'), 'transactionCount'],
        [literal('MAX(createdAt)'), 'lastTransaction']
      ],
      group: ['toUserId', 'type'], // ADD type to group
      order: [[literal('lastTransaction'), 'DESC']],
      raw: true
    });
    
    // Get all received transactions (grouped by sender)
    const receivedTransactions = await BubbleTransaction.findAll({
      where: { 
        toUserId: req.user.id,
        status: 'completed'
      },
      attributes: [
        'fromUserId',
        'type', // ADD THIS
        [literal('SUM(bubbleAmount)'), 'totalBubbles'],
        [literal('COUNT(*)'), 'transactionCount'],
        [literal('MAX(createdAt)'), 'lastTransaction']
      ],
      group: ['fromUserId', 'type'], // ADD type to group
      order: [[literal('lastTransaction'), 'DESC']],
      raw: true
    });
    
    console.log(`Backend - Found ${sentTransactions.length} sent groups, ${receivedTransactions.length} received groups`);
    
    // Process sent transactions
    const enrichedSentTransactions = [];
    for (const transaction of sentTransactions) {
      const toUser = await User.findByPk(transaction.toUserId, {
        attributes: ['id', 'name', 'lat', 'lng', 'bubbleGoal', 'bubblesReceived', 'goalActive']
      });
      
      const totalBubbles = parseInt(transaction.totalBubbles);
      const transactionCount = parseInt(transaction.transactionCount);
      const isDonation = transaction.type === 'donation'; // CHECK TYPE
      
      // Format description based on type
      let description;
      if (isDonation) {
        description = transactionCount > 1 
          ? `Sent ${totalBubbles} bubbles (${transactionCount} times) - Free Giveaway` 
          : `Sent ${totalBubbles} bubbles - Free Giveaway`;
      } else {
        description = transactionCount > 1 
          ? `Sent ${totalBubbles} bubbles (${transactionCount} times)` 
          : `Sent ${totalBubbles} bubbles`;
      }
      
      enrichedSentTransactions.push({
        id: `sent-${transaction.toUserId}-${transaction.type}`,
        userId: transaction.toUserId,
        userName: toUser ? toUser.name : 'Unknown User',
        bubbleAmount: totalBubbles,
        transactionCount: transactionCount,
        creatorColor: isDonation ? '#f59e0b' : '#f59e0b', // Can use different colors
        description: description,
        status: 'completed',
        type: transaction.type, // ADD THIS
        createdAt: transaction.lastTransaction,
        updatedAt: transaction.lastTransaction,
        isReceived: false,
        isDonation: isDonation, // ADD THIS FLAG
        goalInfo: toUser ? {
          goal: toUser.bubbleGoal,
          received: toUser.bubblesReceived,
          active: toUser.goalActive
        } : null
      });
    }
    
    // Process received transactions
    const enrichedReceivedTransactions = [];
    for (const transaction of receivedTransactions) {
      const fromUser = await User.findByPk(transaction.fromUserId, {
        attributes: ['id', 'name', 'lat', 'lng']
      });
      
      const totalBubbles = parseInt(transaction.totalBubbles);
      const transactionCount = parseInt(transaction.transactionCount);
      const isDonation = transaction.type === 'donation'; // CHECK TYPE
      
      // Format description based on type
      let description;
      if (isDonation) {
        description = transactionCount > 1 
          ? `Received ${totalBubbles} bubbles (${transactionCount} times) - Free Giveaway` 
          : `Received ${totalBubbles} bubbles - Free Giveaway`;
      } else {
        description = transactionCount > 1 
          ? `Received ${totalBubbles} bubbles (${transactionCount} times)` 
          : `Received ${totalBubbles} bubbles`;
      }
      
      enrichedReceivedTransactions.push({
        id: `received-${transaction.fromUserId}-${transaction.type}`,
        userId: transaction.fromUserId,
        userName: fromUser ? fromUser.name : 'Unknown User',
        bubbleAmount: totalBubbles,
        transactionCount: transactionCount,
        creatorColor: '#10b981',
        description: description,
        status: 'completed',
        type: transaction.type, // ADD THIS
        createdAt: transaction.lastTransaction,
        updatedAt: transaction.lastTransaction,
        isReceived: true,
        isDonation: isDonation // ADD THIS FLAG
      });
    }
    
    // Combine and sort by last transaction date
    const allTransactions = [...enrichedSentTransactions, ...enrichedReceivedTransactions]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    
    console.log(`Backend - Returning ${allTransactions.length} grouped completed transactions`);
    res.json(allTransactions);
  } catch (error) {
    console.error('Backend - Completed transactions error:', error);
    res.status(400).json({ message: error.message || 'Failed to get completed transactions' });
  }
});

router.get('/transaction-details/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { type = 'both' } = req.query; // 'sent', 'received', or 'both'
    
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
    
    // Check if supporter has enough bubbles
    if (fromUser.bubblesCount < bubbleAmount) {
      return res.status(400).json({ 
        message: `Insufficient bubbles. You have ${fromUser.bubblesCount}, trying to send ${bubbleAmount}` 
      });
    }

    // Validate target slot exists for this user
    if (targetSlotNumber > toUser.queueSlots) {
      return res.status(400).json({ 
        message: `Invalid slot. User only has ${toUser.queueSlots} slots (you tried slot ${targetSlotNumber})` 
      });
    }
    
    // QUEUE RULE validation
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

    // CRITICAL FIX: Get or initialize slot progress
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

    // Deduct bubbles from supporter
    fromUser.bubblesCount -= bubbleAmount;
    
    // Update slot progress
    slotProgress[slotKey] = newProgress;

    console.log(`AFTER UPDATE - slotProgress object:`, slotProgress);

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
      toUser.bubblesCount += bubblesEarned;
      
      // Reduce queue slots
      toUser.queueSlots = Math.max(0, toUser.queueSlots - 1);
      
      // If all slots completed, remove from queue
      if (toUser.queueSlots === 0) {
        toUser.queuePosition = 0;
        toUser.queueBubbles = 0;
        slotProgress = {};
        console.log(`${toUser.name} completed all queue slots, removed from queue`);
      }
      
      console.log(`Slot ${targetSlotNumber} completed! User earned ${bubblesEarned} bubbles. Remaining slots: ${toUser.queueSlots}`);
    }

    // CRITICAL FIX: Save updated slot progress as JSON STRING
    toUser.slotProgress = JSON.stringify(slotProgress);
    
    console.log(`SAVING to DB - slotProgress:`, toUser.slotProgress);
    
    // AUTO-GENERATE QUEUE SLOTS FOR SUPPORTER
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
        
        // Initialize slot progress for supporter
        const supporterSlotProgress = {};
        for (let i = 1; i <= queueSlotsToOpen; i++) {
          supporterSlotProgress[i.toString()] = 0;
        }
        fromUser.slotProgress = JSON.stringify(supporterSlotProgress); // â† JSON.stringify
        
        console.log(`Supporter added to queue at position ${fromUser.queuePosition} with ${queueSlotsToOpen} slots`);
      } else {
        const currentSlots = fromUser.queueSlots;
        fromUser.queueSlots += queueSlotsToOpen;
        
        // Add new slots to progress tracking
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
        fromUser.slotProgress = JSON.stringify(supporterSlotProgress); // â† JSON.stringify
        
        console.log(`Supporter now has ${fromUser.queueSlots} total queue slots`);
      }
    }
    
    // SAVE BOTH USERS
    await fromUser.save();
    await toUser.save();
    
    console.log('âœ… Both users saved to database');
    
    // REBALANCE QUEUE POSITIONS AFTER SLOT COMPLETION
    if (slotCompleted) {
      await rebalanceQueuePositions();
    }
    
    // Create transaction record
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
    
    // FETCH FRESH DATA FROM DATABASE
    const updatedToUser = await User.findByPk(toUserId);
    let updatedSlotProgress = {};
    if (updatedToUser.slotProgress) {
      if (typeof updatedToUser.slotProgress === 'string') {
        updatedSlotProgress = JSON.parse(updatedToUser.slotProgress);
      } else {
        updatedSlotProgress = updatedToUser.slotProgress;
      }
    }

    console.log('âœ… Fresh data from DB - slotProgress:', updatedSlotProgress);

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
    
    console.log('âœ… Support response:', responseData);
    res.json(responseData);
  } catch (error) {
    console.error('Backend - Support error:', error);
    res.status(400).json({ message: error.message || 'Support failed' });
  }
});

// Keep the rebalanceQueuePositions function as is
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

// Set a bubble goal
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
    
    // Check if user already has an active goal
    if (user.goalActive && user.bubbleGoal > 0) {
      return res.status(400).json({ 
        message: 'You already have an active goal. Complete or cancel it first.' 
      });
    }
    
    user.bubbleGoal = parseInt(bubbleGoal);
    user.bubblesReceived = 0; // Reset progress
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

// Cancel/Complete a goal
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
    
    // If goal was completed, give user the bubbles
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

// Get user's current goal status
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


//user giveaway - FIXED

//user giveaway - FIXED

//user giveaway - FIXED

//user giveaway - FIXED

router.post('/giveaway/donate', async (req, res) => {
  const { category, bubbles } = req.body;
  const userId = req.user?.id;

  console.log('ðŸŽ Giveaway donation request:', { userId, category, bubbles });

  if (!userId) return res.status(401).json({ message: 'User not authenticated' });
  if (!category || !bubbles || bubbles <= 0)
    return res.status(400).json({ message: 'category, bubbles (>0) required' });

  const t = await sequelize.transaction();
  try {
    console.log(`\nðŸŽ GIVEAWAY DONATION START`);
    console.log(`   Donor: User ${userId}`);
    console.log(`   Category: ${category}`);
    console.log(`   Donation: ${bubbles} bubbles`);

    // ----- 1. Donor validation -----
    const donor = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!donor) throw new Error('Donor not found');
    if (donor.bubblesCount < bubbles)
      throw new Error(`Insufficient bubbles. You have ${donor.bubblesCount}, trying to donate ${bubbles}`);

    // ----- 2. Giveaway validation -----
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

    // ----- 3. Deduct from donor -----
    donor.bubblesCount -= bubbles;
    await donor.save({ transaction: t });
    console.log(`   âœ… Deducted ${bubbles} from donor. New balance: ${donor.bubblesCount}`);

    // ----- 4. Record donation transaction -----
    await BubbleTransaction.create({
      fromUserId: userId,
      toUserId: userId,
      bubbleAmount: bubbles,
      type: 'donation',
      status: 'completed',
      giveaway: 1,
      description: `Donated ${bubbles} bubbles to ${category} Giveaway`,
    }, { transaction: t });
    console.log(`   âœ… Recorded donation transaction`);

    // ----- 5. Fetch eligible users -----
    const eligibleUsers = await sequelize.query(`
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

    const eligibleCount = eligibleUsers.length;

    if (eligibleCount === 0) {
      await t.rollback();
      return res.status(400).json({ message: 'No eligible users found.' });
    }

    console.log(`   ðŸ“Š Found ${eligibleCount} eligible users`);

    // ----- 6. Distribute bubbles in memory (multi-round logic) -----
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

      console.log(`   ðŸŽ¯ Round ${round} â†’ ${user.name} +${giveAmount}, Remaining: ${remaining}`);

      userIndex++;
      if (userIndex >= eligibleUsers.length) {
        userIndex = 0;
        round++;
      }
    }

    console.log(`\nâœ… Distribution finished in ${round - 1} rounds`);
    console.log(`   Remaining: ${remaining} (should be 0)`);

    // ----- 7. Prepare bulk inserts -----
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
        description: `${category} Giveaway Distribution`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      updates.push(`WHEN ${id} THEN bubblesCount + ${data.totalReceived}`);
      totalDistributed += data.totalReceived;
      recipientsList.push({
        rank: recipientsList.length + 1,
        userId: id,
        name: data.name,
        totalDonated: data.totalDonated,
        received: data.totalReceived,
      });
    }

    // ----- 8. Bulk insert -----
    await BubbleTransaction.bulkCreate(finalTransactions, { transaction: t });
    console.log(`   âœ… Inserted ${finalTransactions.length} transfer transactions`);

    // ----- 9. Bulk update users -----
    const ids = Array.from(recipientMap.keys()).join(',');
    await sequelize.query(`
      UPDATE Users 
      SET bubblesCount = CASE id ${updates.join(' ')} END
      WHERE id IN (${ids});
    `, { transaction: t });
    console.log(`   âœ… Updated ${recipientMap.size} user balances`);

    // ----- 10. Update giveaway (DO NOT mark distributed) -----
    // Only update totalDonated, keep distributed=false for future donations
    await sequelize.query(
      `UPDATE Giveaways 
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

    console.log(`âœ… COMPLETE - Distributed ${totalDistributed} bubbles across ${recipientMap.size} users`);

    // âœ… Fetch updated donor profile to return to frontend
    const updatedDonor = await User.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'bubblesCount', 'queuePosition', 'queueBubbles', 'queueSlots']
    });

    res.json({
      success: true,
      message: `Distributed ${totalDistributed} bubbles to ${recipientMap.size} users`,
      distribution: {
        giveawayId: giveaway.id,
        category,
        amountPerUser,
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
    console.error('âŒ Giveaway donate error:', e);
    console.error('Error details:', e.message);
    res.status(400).json({ message: e.message || 'Donation failed' });
  }
});

// Get giveaway preview (accessible to all users)
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
    console.error('âŒ Preview error:', e);
    res.status(400).json({ message: e.message || 'Failed to fetch preview' });
  }
});


// ---------------------------------------------------

// ---------------------------------------------------
router.get('/leaderboard-giveaway', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // ONLY donation transactions (type = 'donation')
    const donationStats = await BubbleTransaction.findAll({
      where: {
        status: 'completed',
        type: 'donation'               // <-- ONLY giveaway donations
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

        // Same level/gradient logic you already use
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
          points: totalDonated,          // <-- same key used by UI
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






// ---------------------------------------------------
// GET TOP 3 DONORS FOR HOME SCREEN
// ---------------------------------------------------
router.get('/top-three-donors', async (req, res) => {
  try {
    console.log('Backend - Getting top 3 donors');
    
    // Get top 3 donation leaders
    const donationStats = await BubbleTransaction.findAll({
      where: { 
        status: 'completed',
        type: 'donation'  // ONLY donations
      },
      attributes: [
        'fromUserId',
        [literal('SUM(bubbleAmount)'), 'totalDonated'],
        [literal('COUNT(*)'), 'donationCount']
      ],
      group: ['fromUserId'],
      order: [[literal('totalDonated'), 'DESC']],
      limit: 3,  // Top 3 only
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
        
        // Determine level based on total donated
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
          points: totalDonated,  // Total donated
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

// Get user's giveaway bubbles
router.get('/user/giveaway-bubbles', async (req, res) => {
  try {
    console.log('🎁 Backend - Getting giveaway bubbles for user:', req.user.id);
    
    const giveawayTransactions = await BubbleTransaction.findAll({
      where: {
        toUserId: req.user.id,
        status: 'completed',
        type: 'transfer', // Only transfer type transactions are giveaways
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





module.exports = router;