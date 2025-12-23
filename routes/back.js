// routes/back.js
const express = require('express');
const auth = require('../middleware/auth');
const { BubbleTransaction, User } = require('../models');

const router = express.Router();
router.use(auth);

router.post('/pay', async (req, res) => {
  const { transactionId } = req.body;
  try {
    const transaction = await BubbleTransaction.findByPk(transactionId);
    if (!transaction || transaction.toUserId !== req.user.id || transaction.type !== 'support' || transaction.status !== 'pending') {
      return res.status(400).json({ message: 'Invalid transaction for payback' });
    }
    const payer = await User.findByPk(req.user.id); // original recipient
    const receiver = await User.findByPk(transaction.fromUserId); // original supporter
    const amount = transaction.bubbleAmount;
    if (payer.bubblesCount < amount) return res.status(400).json({ message: 'Insufficient bubbles' });
    payer.bubblesCount -= amount;
    receiver.bubblesCount += amount;
    await payer.save();
    await receiver.save();
    transaction.status = 'paidback';
    await transaction.save();
    await BubbleTransaction.create({
      fromUserId: req.user.id,
      toUserId: transaction.fromUserId,
      bubbleAmount: amount,
      type: 'payback',
      status: 'completed'
    });
    res.json({ message: 'Paid back successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/donate', async (req, res) => {
  const { transactionId } = req.body;
  try {
    const transaction = await BubbleTransaction.findByPk(transactionId);
    if (!transaction || transaction.fromUserId !== req.user.id || transaction.type !== 'support' || transaction.status !== 'pending') {
      return res.status(400).json({ message: 'Invalid transaction for donation' });
    }
    transaction.type = 'donation';
    transaction.status = 'donated';
    await transaction.save();
    res.json({ message: 'Marked as donation successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;