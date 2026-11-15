const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    insuranceProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InsuranceProduct",
      required: true,
    },
  
  },
  { timestamps: true }
);

// This is the key change:
module.exports = mongoose.models.Appointment || mongoose.model("Appointment", appointmentSchema);
