// ── DNS FIX (MongoDB connection fix) ──
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── DATABASE ──
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  family: 4
})
  .then(() => console.log('✅ MongoDB Connected — ডাটাবেস সংযুক্ত!'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// ── USER MODEL ──
const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  phone:     { type: String, default: '' },
  address:   { type: String, default: '' },
  role:      { type: String, enum: ['customer', 'admin'], default: 'customer' },
  createdAt: { type: Date, default: Date.now }
});
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
const User = mongoose.model('User', userSchema);

// ── PRODUCT MODEL ──
const productSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  slug:        { type: String, required: true, unique: true },
  category:    { type: String, required: true },
  description: { type: String, required: true },
  price:       { type: Number, required: true },
  stock:       { type: Number, default: 100 },
  emoji:       { type: String, default: '🌿' },
  badge:       { type: String, default: 'অর্গানিক' },
  featured:    { type: Boolean, default: false },
  ratings:     { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
  createdAt:   { type: Date, default: Date.now }
});
const Product = mongoose.model('Product', productSchema);

// ── ORDER MODEL ──
const orderSchema = new mongoose.Schema({
  orderNumber:     { type: String, unique: true },
  customerName:    { type: String, required: true },
  customerPhone:   { type: String, required: true },
  customerAddress: { type: String, required: true },
  items: [{
    name: String, size: String, price: Number, qty: Number, total: Number
  }],
  totalAmount:   { type: Number, required: true },
  paymentMethod: { type: String, enum: ['bkash', 'nagad', 'rocket', 'cod'], default: 'cod' },
  paymentNumber: { type: String, default: '' },
  transactionId: { type: String, default: '' },
  status:        { type: String, enum: ['pending','confirmed','processing','shipped','delivered','cancelled'], default: 'pending' },
  note:          { type: String, default: '' },
  createdAt:     { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// ── NEWSLETTER ──
const newsletterSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Newsletter = mongoose.model('Newsletter', newsletterSchema);

// ── AUTH MIDDLEWARE ──
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'লগইন করুন' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    next();
  } catch { res.status(401).json({ error: 'টোকেন অবৈধ' }); }
};
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'অ্যাডমিন শুধু' });
  next();
};

// ════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'সব তথ্য দিন' });
    if (await User.findOne({ email })) return res.status(400).json({ error: 'ইমেইল নিবন্ধিত' });
    const user = await User.create({ name, email, password, phone });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', protect, (req, res) => res.json({ user: req.user }));

// ════════════════════════════════════
//  ORDER ROUTES (no login required)
// ════════════════════════════════════

// অর্ডার দিন
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, customerPhone, customerAddress, items, totalAmount, paymentMethod, paymentNumber, transactionId, note } = req.body;

    if (!customerName || !customerPhone || !customerAddress)
      return res.status(400).json({ error: 'নাম, ফোন ও ঠিকানা দিন' });
    if (!items || items.length === 0)
      return res.status(400).json({ error: 'কার্টে পণ্য নেই' });

    // Order number generate
    const orderNumber = 'SK' + Date.now().toString().slice(-8);

    const order = await Order.create({
      orderNumber, customerName, customerPhone, customerAddress,
      items, totalAmount, paymentMethod: paymentMethod || 'cod',
      paymentNumber: paymentNumber || '',
      transactionId: transactionId || '',
      note: note || ''
    });

    res.status(201).json({
      success: true,
      message: 'অর্ডার সফল হয়েছে!',
      orderNumber: order.orderNumber,
      order
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// সব অর্ডার দেখুন (admin)
app.get('/api/orders', protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders, total: orders.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// অর্ডার স্ট্যাটাস আপডেট
app.put('/api/orders/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// অর্ডার নম্বর দিয়ে ট্র্যাক
app.get('/api/orders/track/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি' });
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════
//  PRODUCT ROUTES
// ════════════════════════════════════
app.get('/api/products', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category && category !== 'all' ? { category } : {};
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ products, total: products.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json({ product });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ product });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', protect, adminOnly, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'পণ্য মুছে ফেলা হয়েছে' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════
//  NEWSLETTER
// ════════════════════════════════════
app.post('/api/newsletter', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'ইমেইল দিন' });
    if (await Newsletter.findOne({ email })) return res.json({ message: 'ইতিমধ্যে সাবস্ক্রাইব!' });
    await Newsletter.create({ email });
    res.status(201).json({ message: '🌿 সাবস্ক্রাইব সফল!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════
//  ADMIN STATS
// ════════════════════════════════════
app.get('/api/admin/stats', protect, adminOnly, async (req, res) => {
  try {
    const [totalOrders, totalProducts, totalUsers, revenueData, pendingOrders, recentOrders] = await Promise.all([
      Order.countDocuments(),
      Product.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.countDocuments({ status: 'pending' }),
      Order.find().sort({ createdAt: -1 }).limit(5)
    ]);
    res.json({
      totalOrders, totalProducts, totalUsers, pendingOrders,
      totalRevenue: revenueData[0]?.total || 0,
      recentOrders
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HEALTH ──
app.get('/api/health', (req, res) => res.json({ status: 'OK', time: new Date() }));

// ── FRONTEND ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 শেকড় সার্ভার চালু: http://localhost:${PORT}`);
  console.log(`📦 অর্ডার API: http://localhost:${PORT}/api/orders`);
});
