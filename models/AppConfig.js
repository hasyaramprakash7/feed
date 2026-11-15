const mongoose = require("mongoose");

const appConfigSchema = new mongoose.Schema({
  latestAndroidVersion: { 
    type: String, 
    required: true, 
    default: "1.0.0" 
  },
  latestIOSVersion: { 
    type: String, 
    required: true, 
    default: "1.0.0" 
  },
  forceUpdate: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

module.exports = mongoose.model("AppConfig", appConfigSchema);