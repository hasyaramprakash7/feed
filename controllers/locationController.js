// controllers/locationController.js
const axios = require("axios");

// @desc    Reverse geocode using OpenStreetMap
// @route   GET /api/location/reverse-geocode?lat=...&lon=...
// @access  Public
const reverseGeocode = async (req, res) => {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "Latitude and longitude are required." });
  }

  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: {
        lat,
        lon,
        format: "json",
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'YourAppName/1.0 (your@email.com)',
      },
    });

    res.json({
      success: true,
      address: response.data.address,
    });
  } catch (err) {
    console.error("Reverse geocoding failed:", err.message);
    res.status(500).json({
      success: false,
      error: "Geocoding failed",
      details: err.message,
    });
  }
};


module.exports = { reverseGeocode };
