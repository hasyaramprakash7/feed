// models/Property.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const h3 = require('h3-js');

// --- Validator Function ---
function arrayMinLength(val) {
    return val && val.length > 0;
}

// 1. Schema for Area Options (Floor Plans)
const AreaOptionSchema = new Schema({
    optionName: {
        type: String,
        required: [true, 'Area option name is required.'],
        default: 'Unit A',
    },
    superBuiltUpSqFt: {
        type: Number,
        required: [true, 'Super built-up area in sq.ft. is required.'],
        min: [100, 'Area must be at least 100 sq.ft.'],
    },
    priceCr: {
        type: Number,
        required: [true, 'Price in Crores is required.'],
        min: [0.01, 'Price must be greater than 0.'],
    },
    ratePerSqFt: {
        type: Number,
        required: [true, 'Rate per square foot is required.'],
    },
    govtChargesIncluded: {
        type: Boolean,
        default: false,
    },
    floorPlanImage: {
        type: String,
        required: false,
    }
}, { _id: true });

// 2. Schema for Location
const LocationSchema = new Schema({
    city: {
        type: String,
        required: [true, 'City is required.'],
        trim: true,
        index: true
    },
    locality: {
        type: String,
        required: [true, 'Locality is required.'],
        trim: true,
        index: true
    },
    state: {
        type: String,
        required: [true, 'State is required.'],
        trim: true,
        index: true
    },
    pincode: {
        type: String,
        required: [true, 'Pincode is required.'],
        trim: true,
        index: true
    },
    coordinates: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
        },
        coordinates: {
            type: [Number],
            index: '2dsphere',
        }
    }
});

// 3. Schema for Embedded Vendor
const VendorEmbeddedSchema = new Schema({
    vendorId: {
        type: Schema.Types.ObjectId,
        required: [true, 'Vendor ID is required.'],
        ref: 'User'
    },
    name: {
        type: String,
        required: [true, 'Vendor name is required.'],
    },
    phone: {
        type: String,
        required: false,
    },
    shopName: {
        type: String,
        required: false,
    },
    shopImage: {
        type: String,
        required: false,
    }
}, { _id: false });

// --- Main Property Schema ---
const PropertySchema = new Schema({
    title: {
        type: String,
        required: [true, 'Property title is required.'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters.']
    },
    propertyType: {
        type: String,
        required: [true, 'Property type is required.'],
        enum: {
            values: ['Independent House/Villa', 'Apartment', 'Plot', 'Commercial'],
            message: 'Property type must be Independent House/Villa, Apartment, Plot, or Commercial.'
        },
    },
    status: {
        type: String,
        required: [true, 'Status is required.'],
        enum: ['New Launch', 'Under Construction', 'Ready to Move', 'Resale'],
        default: 'Under Construction'
    },
    location: {
        type: LocationSchema,
        required: [true, 'Location details are required.']
    },
    minPriceCr: { type: Number, required: true },
    maxPriceCr: { type: Number, required: true },
    configuration: {
        bhk: {
            type: String,
            required: [true, 'BHK configuration is required.'],
            enum: ['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5+ BHK'],
            default: '3 BHK'
        },
        bathrooms: { type: Number, default: 1 },
        balconies: { type: Number, default: 0 },
        totalFloors: {
            type: Number,
            required: true,
            min: [1, 'Must have at least 1 floor.'],
        },
        propertyFloor: { type: Number, default: 1 },
        carParkingAvailable: { type: Boolean, default: true },
        furnishingStatus: {
            type: String,
            enum: ['Unfurnished', 'Semi-Furnished', 'Fully Furnished'],
            default: 'Unfurnished'
        },
        facing: {
            type: String,
            enum: ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West'],
            default: undefined
        },
        ownershipType: {
            type: String,
            enum: ['Freehold', 'Leasehold', 'Co-operative Society'],
            default: 'Freehold'
        }
    },
    areaOptions: {
        type: [AreaOptionSchema],
        required: [true, 'At least one area option is required.'],
        validate: [arrayMinLength, 'A property must have at least one area option.'],
    },
    projectHighlights: {
        type: [String],
        default: []
    },
    tags: {
        type: [String],
        default: []
    },
    amenities: {
        type: [String],
        default: []
    },
    possessionDate: {
        type: Date,
        required: [true, 'Possession date is required.']
    },
    builtYear: {
        type: Number,
        required: false
    },
    images: {
        type: [String],
        required: [true, 'At least one property image URL is required.'],
        validate: [arrayMinLength, 'At least one image is required.'],
    },
    contactedCount: { type: Number, default: 0 },
    vendor: {
        type: VendorEmbeddedSchema,
        required: [true, 'Vendor details are required.']
    },
    registrationId: {
        type: String,
        required: false
    },
    maintenanceCharges: {
        type: Number,
        required: false
    },
    websiteUrl: {
        type: String,
        required: false
    },
    virtualTourUrl: {
        type: String,
        required: false
    },
    h3Index: {
        type: String,
        index: true
    }
}, { timestamps: true });

// --- Pre‑save hook to compute H3 index from coordinates ---
PropertySchema.pre('save', function(next) {
    if (this.location && this.location.coordinates && this.location.coordinates.coordinates) {
        const [lng, lat] = this.location.coordinates.coordinates;
        if (lat && lng) {
            this.h3Index = h3.latLngToCell(lat, lng, 7);
        }
    }
    next();
});

// --- Text index for searching ---
PropertySchema.index({
    title: 'text',
    projectHighlights: 'text',
    tags: 'text',
    amenities: 'text'
}, {
    weights: { title: 10, projectHighlights: 5, tags: 3, amenities: 2 }
});

// --- Compound Index for efficient filtering ---
PropertySchema.index({
    'location.locality': 1,
    'configuration.bhk': 1,
    minPriceCr: 1
});

module.exports = mongoose.model('Property', PropertySchema);