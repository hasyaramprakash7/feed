// controllers/Property.controller.js
const Property = require('../models/Property.model.js');
const {
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
} = require('../config/multerCloudinary');

// --- Helper ---
const sendError = (res, statusCode, message) => {
  res.status(statusCode).json({ status: 'fail', message });
};

// ===================================
// C - CREATE (with image upload)
// ===================================
const createProperty = async (req, res, next) => {
  console.log('\n🚀 [createProperty] CONTROLLER ENTERED');
  console.log('📋 req.body (raw):', req.body);
  console.log('📁 req.files:', req.files);

  try {
    if (typeof uploadMultipleToCloudinary !== 'function') {
      console.error('❌ uploadMultipleToCloudinary is missing from config/multerCloudinary.js');
      return sendError(res, 500, 'Server misconfiguration: upload helper missing.');
    }

    let {
      title, propertyType, status, location, minPriceCr, maxPriceCr,
      configuration, areaOptions, projectHighlights, tags, amenities,
      possessionDate, vendor, builder, registrationId, maintenanceCharges,
      websiteUrl, virtualTourUrl, builtYear
    } = req.body;

    // --- Parse JSON fields ---
    console.log('📍 Parsing location...');
    let parsedLocation =
      typeof location === 'string' ? JSON.parse(location) : location;
    if (parsedLocation && parsedLocation.zipCode && !parsedLocation.pincode) {
      parsedLocation.pincode = parsedLocation.zipCode;
    }
    console.log('✅ parsedLocation:', parsedLocation);

    console.log('🔧 Parsing configuration...');
    const parsedConfiguration =
      typeof configuration === 'string' ? JSON.parse(configuration) : configuration;
    console.log('✅ parsedConfiguration:', parsedConfiguration);

    console.log('📐 Parsing areaOptions...');
    const parsedAreaOptions =
      typeof areaOptions === 'string' ? JSON.parse(areaOptions) : areaOptions;
    console.log('✅ parsedAreaOptions:', parsedAreaOptions);

    console.log('👤 Parsing vendor/builder...');
    const rawVendorData = vendor || builder;
    const parsedVendor =
      typeof rawVendorData === 'string' ? JSON.parse(rawVendorData) : rawVendorData;
    console.log('✅ parsedVendor:', parsedVendor);

    // --- Parse arrays (they might be stringified) ---
    const parseArray = (data) => {
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          return Array.isArray(parsed) ? parsed : [data];
        } catch {
          return [data];
        }
      }
      return [];
    };

    const parsedProjectHighlights = parseArray(projectHighlights);
    const parsedTags = parseArray(tags);
    const parsedAmenities = parseArray(amenities);

    console.log('✅ Parsed projectHighlights:', parsedProjectHighlights);
    console.log('✅ Parsed tags:', parsedTags);
    console.log('✅ Parsed amenities:', parsedAmenities);

    // --- Upload images ---
    if (!req.files || req.files.length === 0) {
      console.warn('⚠️ No files received – returning 400');
      return sendError(res, 400, 'At least one property image is required.');
    }

    console.log('☁️ Uploading images to Cloudinary...');
    console.log(`📤 Calling uploadMultipleToCloudinary with ${req.files.length} files`);
    const uploaded = await uploadMultipleToCloudinary(req.files);
    const imageUrls = uploaded.map((img) => img.url);
    console.log('✅ Cloudinary upload successful. URLs:', imageUrls);

    // --- Create document with ALL fields ---
    console.log('📝 Creating property in database...');
    const newProperty = await Property.create({
      title,
      propertyType,
      status,
      location: parsedLocation,
      minPriceCr,
      maxPriceCr,
      configuration: parsedConfiguration,
      areaOptions: parsedAreaOptions,
      projectHighlights: parsedProjectHighlights,
      tags: parsedTags,
      amenities: parsedAmenities,
      possessionDate,
      images: imageUrls,
      vendor: parsedVendor,
      registrationId,
      maintenanceCharges,
      websiteUrl,
      virtualTourUrl,
      builtYear,
    });

    console.log('✅ Property created with _id:', newProperty._id);
    res.status(201).json({ status: 'success', data: newProperty });

  } catch (error) {
    console.error('🔥 [createProperty] ERROR:', error);
    console.error('📋 Full stack:', error.stack);

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

// ====================================================================
// R - READ ALL – ENHANCED WITH FILTERS
// ====================================================================
const getAllProperties = async (req, res, next) => {
  console.log('📊 [getAllProperties] query:', req.query);

  try {
    const filter = {};

    // Vendor filter
    if (req.query['vendor.vendorId']) {
      filter['vendor.vendorId'] = req.query['vendor.vendorId'];
    }

    // --- General search (q) ---
    if (req.query.q && req.query.q.trim() !== '') {
      const searchTerm = req.query.q.trim();
      const searchRegex = new RegExp(searchTerm, 'i');
      filter.$or = [
        { title: searchRegex },
        { 'location.city': searchRegex },
        { 'location.locality': searchRegex },
        { 'location.pincode': searchRegex },
        { 'location.zipCode': searchRegex },
        { 'location.address': searchRegex },
        { registrationId: searchRegex },
      ];
    }

    // --- Exact field filters ---
    if (req.query.city) filter['location.city'] = req.query.city;
    if (req.query.state) filter['location.state'] = req.query.state;
    if (req.query.locality) filter['location.locality'] = req.query.locality;
    if (req.query.pincode) filter['location.pincode'] = req.query.pincode;
    if (req.query.propertyType) filter.propertyType = req.query.propertyType;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.bhk) filter['configuration.bhk'] = req.query.bhk;

    // Price range
    if (req.query.minPrice || req.query.maxPrice) {
      filter.minPriceCr = {};
      if (req.query.minPrice) filter.minPriceCr.$gte = Number(req.query.minPrice);
      if (req.query.maxPrice) filter.minPriceCr.$lte = Number(req.query.maxPrice);
    }

    // Geo location
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

    // Pagination & sorting
    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 10;
    const skip = (page - 1) * limit;

    let query = Property.find(filter);

    if (req.query.sort) {
      const sortBy = req.query.sort.split(',').join(' ');
      query = query.sort(sortBy);
    } else {
      query = query.sort('-createdAt');
    }

    const totalDocuments = await Property.countDocuments(filter);
    const properties = await query.skip(skip).limit(limit);

    console.log(`✅ [getAllProperties] Returning ${properties.length} properties (total ${totalDocuments})`);

    res.status(200).json({
      status: 'success',
      results: properties.length,
      total: totalDocuments,
      page: page,
      data: properties,
    });
  } catch (error) {
    console.error('🔥 [getAllProperties] ERROR:', error);
    next(error);
  }
};

// ===================================
// R - READ ONE
// ===================================
const getProperty = async (req, res, next) => {
  console.log(`🔍 [getProperty] ID: ${req.params.id}`);
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return sendError(res, 404, 'Property not found with that ID.');
    }
    res.status(200).json({ status: 'success', data: property });
  } catch (error) {
    if (error.name === 'CastError') {
      return sendError(res, 400, 'Invalid Property ID format.');
    }
    next(error);
  }
};

// ===================================
// U - UPDATE (with image upload)
// ===================================
const updateProperty = async (req, res, next) => {
  console.log('\n🔄 [updateProperty] CONTROLLER ENTERED for ID:', req.params.id);
  console.log('📋 req.body:', req.body);
  console.log('📁 req.files:', req.files);

  try {
    if (typeof uploadMultipleToCloudinary !== 'function') {
      console.error('❌ uploadMultipleToCloudinary is missing from config/multerCloudinary.js');
      return sendError(res, 500, 'Server misconfiguration: upload helper missing.');
    }

    const { id } = req.params;
    let updates = { ...req.body };

    // --- Parse JSON fields ---
    if (updates.location) {
      updates.location = JSON.parse(updates.location);
      if (updates.location.zipCode && !updates.location.pincode) {
        updates.location.pincode = updates.location.zipCode;
      }
    }
    if (updates.configuration) {
      updates.configuration = JSON.parse(updates.configuration);
    }
    if (updates.areaOptions) {
      updates.areaOptions = JSON.parse(updates.areaOptions);
    }

    // Parse arrays if they come as strings
    const parseArrayField = (field) => {
      if (!field) return undefined;
      if (Array.isArray(field)) return field;
      if (typeof field === 'string') {
        try {
          const parsed = JSON.parse(field);
          return Array.isArray(parsed) ? parsed : [field];
        } catch {
          return [field];
        }
      }
      return field;
    };

    if (updates.projectHighlights) {
      updates.projectHighlights = parseArrayField(updates.projectHighlights);
    }
    if (updates.tags) {
      updates.tags = parseArrayField(updates.tags);
    }
    if (updates.amenities) {
      updates.amenities = parseArrayField(updates.amenities);
    }

    // Handle builder → vendor
    if (updates.builder) {
      updates.vendor = JSON.parse(updates.builder);
      delete updates.builder;
    }
    if (updates.vendor && typeof updates.vendor === 'string') {
      updates.vendor = JSON.parse(updates.vendor);
    }

    // --- Parse numeric fields ---
    if (updates.minPriceCr) updates.minPriceCr = parseFloat(updates.minPriceCr);
    if (updates.maxPriceCr) updates.maxPriceCr = parseFloat(updates.maxPriceCr);
    if (updates.maintenanceCharges) {
      updates.maintenanceCharges = parseFloat(updates.maintenanceCharges);
    }
    if (updates.builtYear) updates.builtYear = parseInt(updates.builtYear);

    // --- Existing images preserved, new images appended ---
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

    let newImageUrls = [];
    if (req.files && req.files.length > 0) {
      const uploaded = await uploadMultipleToCloudinary(req.files);
      newImageUrls = uploaded.map((img) => img.url);
    }

    if (newImageUrls.length > 0 || existingImages.length > 0) {
      updates.images = [...existingImages, ...newImageUrls];
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (!updatedProperty) {
      return sendError(res, 404, 'Property not found for update.');
    }
    res.status(200).json({ status: 'success', data: updatedProperty });

  } catch (error) {
    console.error('🔥 [updateProperty] ERROR:', error);
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

// ===================================
// D - DELETE
// ===================================
const deleteProperty = async (req, res, next) => {
  console.log(`🗑️ [deleteProperty] ID: ${req.params.id}`);
  try {
    const deletedProperty = await Property.findByIdAndDelete(req.params.id);
    if (!deletedProperty) {
      return sendError(res, 404, 'Property not found for deletion.');
    }

    // Best-effort cleanup of Cloudinary assets
    if (Array.isArray(deletedProperty.images) && deletedProperty.images.length > 0) {
      await Promise.all(
        deletedProperty.images.map((url) =>
          deleteFromCloudinary(url).catch((e) =>
            console.warn('⚠️ Cloudinary delete failed for', url, e.message)
          )
        )
      );
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProperty,
  getAllProperties,
  getProperty,
  updateProperty,
  deleteProperty,
};