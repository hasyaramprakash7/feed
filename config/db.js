const mongoose = require("mongoose");

const connectDB = async () => {
  console.log("🔁 Attempting to connect to MongoDB...");

  try {
    if (!process.env.MONGO_URI) {
      throw new Error("❌ MONGO_URI is not defined in environment variables.");
    }

    console.log(`🌐 MONGO_URI: ${process.env.MONGO_URI}`);

    const conn = await mongoose.connect(process.env.MONGO_URI); // ⬅️ clean

    console.log("✅ MongoDB connection successful");
    console.log(`📦 Database: ${conn.connection.name}`);
    console.log(`🔌 Host: ${conn.connection.host}`);
    console.log(`🚪 Port: ${conn.connection.port}`);
  } catch (error) {
    console.error("❌ MongoDB connection failed.");
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
