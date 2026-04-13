const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// ── UPLOADS ──
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '-'))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── MIDDLEWARE ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/uploads', express.static(uploadDir));

// ── DATABASE ──
const MONGO_URI = process.env.MONGO_URI || '';
if (MONGO_URI) {
  mongoose.connect(MONGO_URI, { family: 4, serverSelectionTimeoutMS: 10000 })
    .then(() => console.log('✅ MongoDB Connected!'))
    .catch(err => console.error('❌ MongoDB Error:', err.message));
} else {
  console.log('⚠️ MONGO_URI নেই — ডাটাবেস ছাড়া চলছে');
}

// ════════════════════════════
//  MODELS
// ════════════════════════════

// Customer
const customerSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  phone:       { type: String, required: true, unique: true },
  email:       { type: String, default: '' },
  district:    { type: String, default: '' },
  address:     { type: String, default: '' },
  totalOrders: { type: Number, default: 0 },
  totalSpent:  { type: Number, default: 0 },
  lastOrderAt: { type: Date },
  createdAt:   { type: Date, default: Date.now }
});
const Customer = mongoose.model('Customer', customerSchema);

// Order
const orderSchema = new mongoose.Schema({
  orderNumber:      { type: String, unique: true },
  customerName:     { type: String, required: true },
  customerPhone:    { type: String, required: true },
  customerEmail:    { type: String, default: '' },
  customerDistrict: { type: String, default: '' },
  customerAddress:  { type: String, required: true },
  items: [{ name: String, size: String, price: Number, qty: Number, total: Number }],
  totalAmount:    { type: Number, required: true },
  deliveryCharge: { type: Number, default: 60 },
  paymentMethod:  { type: String, default: 'cod' },
  paymentNumber:  { type: String, default: '' },
  transactionId:  { type: String, default: '' },
  status: { type: String, enum: ['pending','confirmed','processing','shipped','delivered','cancelled'], default: 'pending' },
  note:     { type: String, default: '' },
  createdAt:{ type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// Newsletter
const newsletterSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Newsletter = mongoose.model('Newsletter', newsletterSchema);

// Product Data (images & prices)
const productDataSchema = new mongoose.Schema({
  productId: { type: Number, required: true, unique: true },
  imageUrl:  { type: String, default: '' },
  sizes:     [{ s: String, p: Number }],
  badge:     String,
  updatedAt: { type: Date, default: Date.now }
});
const ProductData = mongoose.model('ProductData', productDataSchema);

// ── AUTH MIDDLEWARE ──
const JWT_SECRET = process.env.JWT_SECRET || 'shekor_secret_2025';

// ════════════════════════════
//  ORDER ROUTES
// ════════════════════════════

// অর্ডার দিন — login ছাড়াই
app.post('/api/orders', async (req, res) => {
  try {
    const {
      customerName, customerPhone, customerEmail, customerDistrict,
      customerAddress, items, totalAmount, deliveryCharge,
      paymentMethod, paymentNumber, transactionId, note
    } = req.body;

    if (!customerName || !customerPhone || !customerAddress)
      return res.status(400).json({ error: 'নাম, ফোন ও ঠিকানা দিন' });
    if (!items || !items.length)
      return res.status(400).json({ error: 'কার্টে পণ্য নেই' });

    const orderNumber = 'SK' + Date.now().toString().slice(-8);

    const order = await Order.create({
      orderNumber, customerName, customerPhone,
      customerEmail: customerEmail || '',
      customerDistrict: customerDistrict || '',
      customerAddress, items, totalAmount,
      deliveryCharge: deliveryCharge || 60,
      paymentMethod: paymentMethod || 'cod',
      paymentNumber: paymentNumber || '',
      transactionId: transactionId || '',
      note: note || ''
    });

    // Customer database এ save করো
    try {
      const existing = await Customer.findOne({ phone: customerPhone });
      if (existing) {
        existing.totalOrders += 1;
        existing.totalSpent += totalAmount;
        existing.lastOrderAt = new Date();
        if (customerEmail) existing.email = customerEmail;
        if (customerDistrict) existing.district = customerDistrict;
        await existing.save();
      } else {
        await Customer.create({
          name: customerName, phone: customerPhone,
          email: customerEmail || '', district: customerDistrict || '',
          address: customerAddress, totalOrders: 1,
          totalSpent: totalAmount, lastOrderAt: new Date()
        });
      }
    } catch(e) { console.log('Customer save:', e.message); }

    res.status(201).json({
      success: true,
      message: 'অর্ডার সফল হয়েছে! 🎉',
      orderNumber: order.orderNumber
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// সব অর্ডার দেখুন
app.get('/api/orders', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders, total: orders.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// অর্ডার স্ট্যাটাস আপডেট
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id, { status: req.body.status }, { new: true }
    );
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// অর্ডার ট্র্যাক
app.get('/api/orders/track/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি' });
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  CUSTOMER ROUTES
// ════════════════════════════

// সব গ্রাহক
app.get('/api/customers', async (req, res) => {
  try {
    const customers = await Customer.find({}).sort({ createdAt: -1 });
    res.json({ customers, total: customers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// গ্রাহক খোঁজা
app.get('/api/customers/search', async (req, res) => {
  try {
    const { q } = req.query;
    const customers = await Customer.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { phone: { $regex: q } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).limit(20);
    res.json({ customers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  PRODUCT IMAGE UPLOAD
// ════════════════════════════

app.post('/api/upload/product/:productId', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ছবি দিন' });
    const imageUrl = `/uploads/${req.file.filename}`;
    await ProductData.findOneAndUpdate(
      { productId: parseInt(req.params.productId) },
      { imageUrl, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, imageUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products/data', async (req, res) => {
  try {
    const products = await ProductData.find({});
    res.json({ products });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  NEWSLETTER
// ════════════════════════════

app.post('/api/newsletter', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'ইমেইল দিন' });
    if (await Newsletter.findOne({ email }))
      return res.json({ message: 'ইতিমধ্যে সাবস্ক্রাইব!' });
    await Newsletter.create({ email });
    res.status(201).json({ message: '🌿 সাবস্ক্রাইব সফল!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  ADMIN STATS
// ════════════════════════════

app.get('/api/admin/stats', async (req, res) => {
  try {
    const [totalOrders, totalCustomers, revenueData, pendingOrders] = await Promise.all([
      Order.countDocuments(),
      Customer.countDocuments(),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.countDocuments({ status: 'pending' })
    ]);
    res.json({
      totalOrders, totalCustomers, pendingOrders,
      totalRevenue: revenueData[0]?.total || 0
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HEALTH ──
app.get('/api/health', (req, res) => res.json({ status: 'OK', time: new Date() }));

// ── FRONTEND ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── START ──
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 শেকড় সার্ভার: http://localhost:${PORT}`);
});
