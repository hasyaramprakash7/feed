// controllers/Rental.controller.js
const Rental = require('../models/Rental.model.js');
const Vendor = require('../models/Vendor');
const {
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
} = require('../config/multerCloudinary');

const sendError = (res, statusCode, message) => {
  res.status(statusCode).json({ status: 'fail', message });
};

// ========== CREATE ==========
const createRental = async (req, res, next) => {
  console.log('\n🚀 [createRental] CONTROLLER ENTERED');
  console.log('📋 req.body (raw):', req.body);
  console.log('📁 req.files:', req.files);

  try {
    if (typeof uploadMultipleToCloudinary !== 'function') {
      console.error('❌ uploadMultipleToCloudinary is missing from config/multerCloudinary.js');
      return sendError(res, 500, 'Server misconfiguration: upload helper missing.');
    }

    const {
      title, description, rentalType, monthlyRent, deposit,
      maintenanceCharges, isAvailable, availableFrom, amenities,
      location, maxGuests, bedrooms, bathrooms
    } = req.body;

    const parsedLocation =
      typeof location === 'string' ? JSON.parse(location) : location;
    const parsedAmenities =
      typeof amenities === 'string' ? JSON.parse(amenities) : amenities;

    const vendorId = req.vendor.vendorId;
    const vendorDoc = await Vendor.findById(vendorId).select('name phone');
    if (!vendorDoc) {
      return sendError(res, 404, 'Vendor not found.');
    }

    if (!req.files || req.files.length === 0) {
      return sendError(res, 400, 'At least one rental image is required.');
    }

    // Helper returns [{ url, publicId, resourceType }, ...]
    const uploaded = await uploadMultipleToCloudinary(req.files);
    const imageUrls = uploaded.map((img) => img.url);

    const newRental = await Rental.create({
      title,
      description,
      rentalType,
      monthlyRent,
      deposit: deposit || 0,
      maintenanceCharges: maintenanceCharges || 0,
      isAvailable: isAvailable === 'true' || isAvailable === true,
      availableFrom,
      amenities: parsedAmenities || [],
      location: parsedLocation,
      vendor: {
        vendorId: vendorDoc._id,
        name: vendorDoc.name,
        contact: vendorDoc.phone,
      },
      images: imageUrls,
      maxGuests: maxGuests ? parseInt(maxGuests, 10) : undefined,
      bedrooms: bedrooms ? parseInt(bedrooms, 10) : undefined,
      bathrooms: bathrooms ? parseInt(bathrooms, 10) : undefined,
    });

    console.log('✅ Rental created with _id:', newRental._id);
    res.status(201).json({ status: 'success', data: newRental });

  } catch (error) {
    console.error('🔥 [createRental] ERROR:', error);
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map(e => e.message).join('; ');
      return sendError(res, 400, `Validation failed: ${msg}`);
    }
    if (error.name === 'CastError') {
      return sendError(res, 400, `Invalid data format for field: ${error.path}`);
    }
    res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

// ========== UPDATE ==========
const updateRental = async (req, res, next) => {
  console.log('\n🔄 [updateRental] CONTROLLER ENTERED for ID:', req.params.id);
  console.log('📋 req.body:', req.body);
  console.log('📁 req.files:', req.files);

  try {
    if (typeof uploadMultipleToCloudinary !== 'function') {
      console.error('❌ uploadMultipleToCloudinary is missing from config/multerCloudinary.js');
      return sendError(res, 500, 'Server misconfiguration: upload helper missing.');
    }

    const { id } = req.params;

    const existing = await Rental.findById(id);
    if (!existing) return sendError(res, 404, 'Rental not found.');
    if (existing.vendor.vendorId.toString() !== req.vendor.vendorId) {
      return sendError(res, 403, 'You are not authorized to update this rental.');
    }

    let updates = { ...req.body };

    if (updates.location) updates.location = JSON.parse(updates.location);
    delete updates.vendor;
    if (updates.amenities) updates.amenities = JSON.parse(updates.amenities);

    if (updates.monthlyRent) updates.monthlyRent = parseFloat(updates.monthlyRent);
    if (updates.deposit) updates.deposit = parseFloat(updates.deposit);
    if (updates.maintenanceCharges) {
      updates.maintenanceCharges = parseFloat(updates.maintenanceCharges);
    }
    if (updates.maxGuests) updates.maxGuests = parseInt(updates.maxGuests, 10);
    if (updates.bedrooms) updates.bedrooms = parseInt(updates.bedrooms, 10);
    if (updates.bathrooms) updates.bathrooms = parseInt(updates.bathrooms, 10);
    if (updates.isAvailable !== undefined) {
      updates.isAvailable =
        updates.isAvailable === 'true' || updates.isAvailable === true;
    }

    // existingImages are already plain URL strings
    let existingImages = [];
    if (updates.existingImages) {
      try {
        existingImages = JSON.parse(updates.existingImages);
        if (!Array.isArray(existingImages)) existingImages = [];
      } catch (e) {
        console.warn('⚠️ Failed to parse existingImages, treating as empty.');
        existingImages = [];
      }
      delete updates.existingImages;
    }

    // newImageUrls: map helper output → URLs
    let newImageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`📤 Uploading ${req.files.length} new images...`);
      const uploaded = await uploadMultipleToCloudinary(req.files);
      newImageUrls = uploaded.map((img) => img.url);
      console.log('✅ New images uploaded:', newImageUrls);
    }

    const finalImages = [...existingImages, ...newImageUrls];
    if (finalImages.length > 0) {
      updates.images = finalImages;
    } else {
      console.log('ℹ️ No images to update – keeping existing images.');
    }

    const updated = await Rental.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    console.log('✅ Rental updated:', updated._id);
    res.status(200).json({ status: 'success', data: updated });

  } catch (error) {
    console.error('🔥 [updateRental] ERROR:', error);
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map(e => e.message).join('; ');
      return sendError(res, 400, `Validation failed: ${msg}`);
    }
    res.status(500).json({
      status: 'fail',
      message: 'Internal server error: ' + error.message,
    });
  }
};

// ========== READ ALL with Search ==========
const getAllRentals = async (req, res, next) => {
  console.log('📊 [getAllRentals] query:', req.query);
  try {
    const filter = {};

    if (req.query.vendorId) {
      filter['vendor.vendorId'] = req.query.vendorId;
    }

    // ELASTICSEARCH-STYLE SEARCH
    if (req.query.q) {
      const searchRegex = new RegExp(req.query.q, 'i');
      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { 'location.city': searchRegex },
        { 'location.locality': searchRegex },
        { 'location.state': searchRegex },
        { 'location.pincode': searchRegex },
        { rentalType: searchRegex },
      ];
    }

    // Location filters
    if (req.query.city) filter['location.city'] = new RegExp(req.query.city, 'i');
    if (req.query.state) filter['location.state'] = new RegExp(req.query.state, 'i');
    if (req.query.locality) filter['location.locality'] = new RegExp(req.query.locality, 'i');
    if (req.query.pincode) filter['location.pincode'] = req.query.pincode;
    if (req.query.rentalType) filter.rentalType = req.query.rentalType;
    if (req.query.isAvailable !== undefined) {
      filter.isAvailable = req.query.isAvailable === 'true';
    }

    // Price range
    if (req.query.minRent || req.query.maxRent) {
      filter.monthlyRent = {};
      if (req.query.minRent) filter.monthlyRent.$gte = Number(req.query.minRent);
      if (req.query.maxRent) filter.monthlyRent.$lte = Number(req.query.maxRent);
    }

    // Geo-location
    if (req.query.lat && req.query.lng) {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      const radius = req.query.radius ? parseFloat(req.query.radius) : 5;
      filter['location.coordinates'] = {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radius * 1000,
        },
      };
    }

    if (req.query.h3Index) {
      filter.h3Index = req.query.h3Index;
    }

    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 10;
    const skip = (page - 1) * limit;

    let query = Rental.find(filter);
    if (req.query.sort) {
      query = query.sort(req.query.sort.split(',').join(' '));
    } else {
      query = query.sort('-createdAt');
    }

    const total = await Rental.countDocuments(filter);
    const rentals = await query.skip(skip).limit(limit);

    console.log(`✅ [getAllRentals] Returning ${rentals.length} rentals (total ${total})`);
    res.status(200).json({
      status: 'success',
      results: rentals.length,
      total,
      page,
      data: rentals,
    });
  } catch (error) {
    console.error('🔥 [getAllRentals] ERROR:', error);
    next(error);
  }
};

// ========== READ ONE ==========
const getRental = async (req, res, next) => {
  console.log(`🔍 [getRental] ID: ${req.params.id}`);
  try {
    const rental = await Rental.findById(req.params.id);
    if (!rental) return sendError(res, 404, 'Rental not found.');
    res.status(200).json({ status: 'success', data: rental });
  } catch (error) {
    if (error.name === 'CastError') {
      return sendError(res, 400, 'Invalid Rental ID format.');
    }
    next(error);
  }
};

// ========== DELETE ==========
const deleteRental = async (req, res, next) => {
  console.log(`🗑️ [deleteRental] ID: ${req.params.id}`);
  try {
    const existing = await Rental.findById(req.params.id);
    if (!existing) return sendError(res, 404, 'Rental not found for deletion.');
    if (existing.vendor.vendorId.toString() !== req.vendor.vendorId) {
      return sendError(res, 403, 'You are not authorized to delete this rental.');
    }

    // Best-effort cleanup of Cloudinary assets
    if (Array.isArray(existing.images) && existing.images.length > 0) {
      await Promise.all(
        existing.images.map((url) =>
          deleteFromCloudinary(url).catch((e) =>
            console.warn('⚠️ Cloudinary delete failed for', url, e.message)
          )
        )
      );
    }

    await Rental.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRental,
  getAllRentals,
  getRental,
  updateRental,
  deleteRental,
};