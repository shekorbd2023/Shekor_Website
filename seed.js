const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  family: 4
})
  .then(() => console.log('✅ MongoDB Connected — সিড শুরু হচ্ছে...'))
  .catch(err => {
    console.error('❌ MongoDB সংযোগ ব্যর্থ:', err.message);
    process.exit(1);
  });

const productSchema = new mongoose.Schema({
  name: String, slug: String, category: String,
  description: String, price: Number, stock: Number,
  emoji: String, badge: String, featured: Boolean,
  ratings: { average: Number, count: Number },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model('Product', productSchema);

const products = [
  { name: 'হিমালয়ান ব্রাউন রাইস', slug: 'himalayan-brown-rice', category: 'grains', description: 'পাথর-মিলে তৈরি সম্পূর্ণ শস্য চাল। ফাইবার ও খনিজ সমৃদ্ধ।', price: 320, stock: 200, emoji: '🌾', badge: 'বেস্টসেলার', featured: true, ratings: { average: 4.8, count: 142 } },
  { name: 'কাঁচা বন মধু', slug: 'raw-forest-honey', category: 'honey', description: 'বন্য পাহাড়ি মৌচাক থেকে কোল্ড-এক্সট্র্যাক্টেড।', price: 580, stock: 80, emoji: '🍯', badge: 'অর্গানিক', featured: true, ratings: { average: 4.9, count: 98 } },
  { name: 'কোল্ড-প্রেস সরিষার তেল', slug: 'cold-press-mustard-oil', category: 'honey', description: 'প্রথম চাপে নিষ্কাশিত, সমস্ত প্রাকৃতিক পুষ্টি সংরক্ষিত।', price: 420, stock: 120, emoji: '🫙', badge: 'বিশুদ্ধ', featured: false, ratings: { average: 4.7, count: 76 } },
  { name: 'উচ্চ কার্কিউমিন হলুদ', slug: 'high-curcumin-turmeric', category: 'herbs', description: '৫.৫% কার্কিউমিন সমৃদ্ধ হলুদ।', price: 180, stock: 300, emoji: '🟡', badge: 'তাজা', featured: false, ratings: { average: 4.6, count: 203 } },
  { name: 'A2 দেশি গরুর দুধ', slug: 'a2-desi-cow-milk', category: 'dairy', description: 'ঘাস খাওয়া দেশি গরু থেকে প্রতিদিন তাজা সংগ্রহ।', price: 90, stock: 50, emoji: '🥛', badge: 'দৈনিক তাজা', featured: true, ratings: { average: 4.9, count: 315 } },
  { name: 'লাল মসুর ডাল', slug: 'red-lentil-masoor', category: 'grains', description: 'কোনো কৃত্রিম সার ছাড়াই উৎপাদিত প্রোটিন সমৃদ্ধ ডাল।', price: 140, stock: 400, emoji: '🫘', badge: 'অর্গানিক', featured: false, ratings: { average: 4.5, count: 87 } },
  { name: 'মরিঙ্গা পাউডার', slug: 'moringa-leaf-powder', category: 'herbs', description: 'কমলার চেয়ে ৭ গুণ বেশি ভিটামিন C।', price: 350, stock: 90, emoji: '🌿', badge: 'সুপারফুড', featured: true, ratings: { average: 4.8, count: 124 } },
  { name: 'খামারের কালচারড মাখন', slug: 'cultured-farm-butter', category: 'dairy', description: 'ঘাস-খাওয়া গরুর ক্রিম থেকে হাতে তৈরি কালচারড মাখন।', price: 280, stock: 60, emoji: '🧈', badge: 'কারিগরি', featured: false, ratings: { average: 4.7, count: 59 } }
];

async function seed() {
  try {
    await Product.deleteMany({});
    console.log('পুরনো পণ্য মুছে ফেলা হয়েছে');
    await Product.insertMany(products);
    console.log(products.length + 'টি পণ্য সফলভাবে যোগ করা হয়েছে!');
    products.forEach(p => console.log('  ' + p.emoji + ' ' + p.name + ' - ' + p.price));
    console.log('এখন চালান: npm run dev');
    mongoose.disconnect();
  } catch (err) {
    console.error('Seed ব্যর্থ:', err.message);
    mongoose.disconnect();
    process.exit(1);
  }
}

seed();
