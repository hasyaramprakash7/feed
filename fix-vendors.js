const mongoose = require('mongoose');
const Vendor = require('./models/Vendor');
require('dotenv').config();

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);
  const result = await Vendor.updateMany(
    { isApproved: false },
    { $set: { isApproved: true, isOnline: true } }
  );
  console.log(`Updated ${result.modifiedCount} vendors.`);
  process.exit(0);
}
fix();