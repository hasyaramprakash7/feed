// migrate-h3.js
const mongoose = require('mongoose');
const h3 = require('h3-js');
const Vendor = require('./models/Vendor'); // adjust path to your Vendor model
require('dotenv').config(); // if you use .env

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/yourdb';

async function migrate() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const vendors = await Vendor.find({ 
      'address.latitude': { $exists: true, $ne: null },
      'address.longitude': { $exists: true, $ne: null }
    });

    let updated = 0;
    for (const v of vendors) {
      if (!v.h3Index) {
        const hex = h3.latLngToCell(
          v.address.latitude,
          v.address.longitude,
          8  // resolution – same as your route
        );
        v.h3Index = hex;
        await v.save();
        updated++;
        console.log(`🔄 Updated vendor ${v._id} (${v.shopName}) -> ${hex}`);
      }
    }

    console.log(`✅ Migration complete. Updated ${updated} vendors.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();