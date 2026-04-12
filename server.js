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

// ── UPLOADS FOLDER ──
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── MULTER (ছবি আপলোড) ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const clean = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-');
    cb(null, Date.now() + '-' + clean);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('শুধু ছবি আপলোড করা যাবে'));
  }
});

// ── MIDDLEWARE ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── STATIC FILES ──
app.use(express.static(path.join(__dirname)));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/uploads', express.static(uploadDir));

// ── DATABASE ──
mongoose.connect(process.env.MONGO_URI, { family: 4, serverSelectionTimeoutMS: 10000 })
  .then(() => console.log('✅ MongoDB Connected!'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// ── MODELS ──
const userSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, lowercase: true },
  password: String, phone: String,
  role: { type: String, enum: ['customer','admin'], default: 'customer' },
  createdAt: { type: Date, default: Date.now }
});
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12); next();
});
const User = mongoose.model('User', userSchema);

// পণ্যের ছবি সহ Model
const productSchema = new mongoose.Schema({
  productId:   { type: Number, required: true, unique: true },
  name:        String,
  category:    String,
  imageUrl:    { type: String, default: '' },
  imagePath:   { type: String, default: '' },
  sizes: [{s: String, p: Number}],
  badge:       String,
  stock:       { type: Number, default: 100 },
  updatedAt:   { type: Date, default: Date.now }
});
const ProductData = mongoose.model('ProductData', productSchema);

const orderSchema = new mongoose.Schema({
  orderNumber:     { type: String, unique: true },
  customerName:    { type: String, required: true },
  customerPhone:   { type: String, required: true },
  customerAddress: { type: String, required: true },
  items: [{ name: String, size: String, price: Number, qty: Number, total: Number }],
  totalAmount:   { type: Number, required: true },
  paymentMethod: { type: String, default: 'cod' },
  paymentNumber: String,
  transactionId: String,
  status:        { type: String, enum: ['pending','confirmed','processing','shipped','delivered','cancelled'], default: 'pending' },
  note:          String,
  createdAt:     { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const newsletterSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Newsletter = mongoose.model('Newsletter', newsletterSchema);

// ── AUTH MIDDLEWARE ──
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'লগইন করুন' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'shekor_secret');
    req.user = await User.findById(decoded.id).select('-password');
    next();
  } catch { res.status(401).json({ error: 'টোকেন অবৈধ' }); }
};
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'অ্যাডমিন শুধু' });
  next();
};

// ════════════════════════════
//  IMAGE UPLOAD ROUTES
// ════════════════════════════

// একটি পণ্যের ছবি আপলোড
app.post('/api/upload/product/:productId', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ছবি দিন' });
    const imageUrl = `/uploads/${req.file.filename}`;
    const productId = parseInt(req.params.productId);

    // DB তে সেভ করো
    await ProductData.findOneAndUpdate(
      { productId },
      { imageUrl, imagePath: req.file.path, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, imageUrl, message: 'ছবি আপলোড সফল!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// সব পণ্যের ছবি একসাথে নাও
app.get('/api/products/images', async (req, res) => {
  try {
    const products = await ProductData.find({});
    const imageMap = {};
    products.forEach(p => { imageMap[p.productId] = p.imageUrl; });
    res.json({ imageMap });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// পণ্যের দাম ও তথ্য আপডেট
app.post('/api/products/update', async (req, res) => {
  try {
    const { productId, sizes, badge, stock, name } = req.body;
    await ProductData.findOneAndUpdate(
      { productId },
      { sizes, badge, stock, name, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: 'পণ্য আপডেট সফল!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// সব পণ্যের update data নাও
app.get('/api/products/data', async (req, res) => {
  try {
    const products = await ProductData.find({});
    res.json({ products });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  AUTH ROUTES
// ════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'সব তথ্য দিন' });
    if (await User.findOne({ email })) return res.status(400).json({ error: 'ইমেইল নিবন্ধিত' });
    const user = await User.create({ name, email, password, phone });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'shekor_secret', { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'shekor_secret', { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  ORDER ROUTES
// ════════════════════════════
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, customerPhone, customerAddress, items, totalAmount, paymentMethod, paymentNumber, transactionId, note } = req.body;
    if (!customerName || !customerPhone || !customerAddress)
      return res.status(400).json({ error: 'নাম, ফোন ও ঠিকানা দিন' });
    if (!items?.length) return res.status(400).json({ error: 'কার্টে পণ্য নেই' });
    const orderNumber = 'SK' + Date.now().toString().slice(-8);
    const order = await Order.create({
      orderNumber, customerName, customerPhone, customerAddress,
      items, totalAmount, paymentMethod: paymentMethod || 'cod',
      paymentNumber: paymentNumber || '', transactionId: transactionId || '', note: note || ''
    });
    res.status(201).json({ success: true, message: 'অর্ডার সফল!', orderNumber: order.orderNumber, order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders, total: orders.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders/track/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি' });
    res.json({ order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════
//  NEWSLETTER
// ════════════════════════════
app.post('/api/newsletter', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'ইমেইল দিন' });
    if (await Newsletter.findOne({ email })) return res.json({ message: 'ইতিমধ্যে সাবস্ক্রাইব!' });
    await Newsletter.create({ email });
    res.status(201).json({ message: '🌿 সাবস্ক্রাইব সফল!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN STATS ──
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [totalOrders, totalProducts, revenueData, pendingOrders] = await Promise.all([
      Order.countDocuments(),
      ProductData.countDocuments(),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.countDocuments({ status: 'pending' })
    ]);
    res.json({ totalOrders, totalProducts, pendingOrders, totalRevenue: revenueData[0]?.total || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HEALTH ──
app.get('/api/health', (req, res) => res.json({ status: 'OK', time: new Date() }));

// ── FRONTEND ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 শেকড় সার্ভার চালু: http://localhost:${PORT}`);
  console.log(`📸 ছবি আপলোড API: POST /api/upload/product/:id`);
});
