const express = require("express");
const router = express.Router();
const { reverseGeocode } = require("../controllers/locationController");

router.get("/reverse-geocode", reverseGeocode);

module.exports = router;
