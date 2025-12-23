// routes/wallet.js
const express = require('express');
const auth = require('../middleware/auth');
const { User, WalletTransaction } = require('../models');

const router = express.Router();
router.use(auth);

// routes/auth.js - Set first depositing user as queue position 1
// This should be in your deposit endpoint or when user gets bubbles first time

// Add this logic to routes/wallet.js deposit-bubbles endpoint
router.post('/deposit-bubbles', async (req, res) => {
  const { bubbles } = req.body;
  if (bubbles <= 0) return res.status(400).json({ message: 'Invalid amount' });
  try {
    const user = await User.findByPk(req.user.id);
    
    // Check if this is user's first deposit and no queue position yet
    const wasFirstDeposit = user.bubblesCount === 0 && user.queuePosition === 0;
    
    user.bubblesCount += parseInt(bubbles);
    
    // If first deposit, check if they should be queue position 1
    if (wasFirstDeposit) {
      const currentQueueOne = await User.findOne({
        where: { queuePosition: 1 }
      });
      
      // If no one is at position 1, make this user position 1
      if (!currentQueueOne) {
        user.queuePosition = 1;
        console.log(`User ${user.name} set as Queue Position #1`);
      }
    }
    
    await user.save();
    await WalletTransaction.create({ userId: user.id, type: 'bubble_deposit', amount: bubbles });
    
    res.json({ 
      message: 'Bubbles deposited', 
      bubblesCount: user.bubblesCount,
      queuePosition: user.queuePosition
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});



router.post('/buy-bubbles', async (req, res) => {
  const { bubbles } = req.body;
  if (bubbles <= 0) return res.status(400).json({ message: 'Invalid amount' });
  const price = parseFloat(process.env.BUBBLE_PRICE || 1);
  const cost = bubbles * price;
  try {
    const user = await User.findByPk(req.user.id);
    if (parseFloat(user.walletBalance) < cost) return res.status(400).json({ message: 'Insufficient balance' });
    user.walletBalance = parseFloat(user.walletBalance) - cost;
    user.bubblesCount += parseInt(bubbles);
    await user.save();
    await WalletTransaction.create({ userId: user.id, type: 'bubble_purchase', amount: cost });
    res.json({ message: 'Bubbles purchased', bubblesCount: user.bubblesCount, walletBalance: user.walletBalance });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;