const mongoose = require('mongoose');
const { Schema } = mongoose;
const h3 = require('h3-js');

function arrayMinLength(val) {
  return val.length > 0;
}

const LocationSchema = new Schema({
  city: { type: String, required: true, trim: true, index: true },
  locality: { type: String, required: true, trim: true, index: true },
  state: { type: String, required: true, trim: true, index: true },
  pincode: { type: String, required: true, trim: true, index: true },
  coordinates: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      index: '2dsphere',
      required: [true, 'Coordinates are required for geo queries.']
    }
  }
});

const VendorEmbeddedSchema = new Schema({
  vendorId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  name: { type: String, required: true },
  contact: { type: String, required: true }
}, { _id: false });

const RentalSchema = new Schema({
  title: {
    type: String,
    required: [true, 'Rental title is required.'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters.']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters.']
  },
  rentalType: {
    type: String,
    required: [true, 'Rental type is required.'],
    enum: ['PG', 'Hotel', 'Apartment', 'Villa', 'Hostel', 'Guest House']
  },
  monthlyRent: {
    type: Number,
    required: [true, 'Monthly rent is required.'],
    min: [100, 'Rent must be at least 100.']
  },
  deposit: { type: Number, default: 0 },
  maintenanceCharges: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
  availableFrom: { type: Date, required: true },
  amenities: { type: [String], default: [] },
  images: {
    type: [String],
    required: [true, 'At least one image is required.'],
    validate: [arrayMinLength, 'At least one image is required.']
  },
  location: { type: LocationSchema, required: true },
  vendor: { type: VendorEmbeddedSchema, required: true },
  h3Index: { type: String, index: true },
  maxGuests: { type: Number, min: 1 },
  bedrooms: { type: Number, min: 0 },
  bathrooms: { type: Number, min: 0 },
  contactedCount: { type: Number, default: 0 }
}, { timestamps: true });

RentalSchema.pre('save', function(next) {
  if (this.location && this.location.coordinates && this.location.coordinates.coordinates) {
    const [lng, lat] = this.location.coordinates.coordinates;
    if (lat && lng) {
      this.h3Index = h3.latLngToCell(lat, lng, 7);
    }
  }
  next();
});

RentalSchema.index({
  title: 'text',
  description: 'text'
}, { weights: { title: 10, description: 5 } });

RentalSchema.index({
  'location.city': 1,
  'location.state': 1,
  'location.pincode': 1,
  monthlyRent: 1,
  rentalType: 1
});

module.exports = mongoose.model('Rental', RentalSchema);