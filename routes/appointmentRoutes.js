const express = require('express');
const router = express.Router();
const Appointment = require('../models/Appointment'); // Adjust the path as needed

// Route to create a new appointment
router.post('/', async (req, res) => {
  try {
    const { vendorId, userId, insuranceProductId } = req.body;
    const newAppointment = new Appointment({ vendorId, userId, insuranceProductId });
    await newAppointment.save();
    res.status(201).json(newAppointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Route to get all appointments for a specific vendor
router.get('/vendor/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const appointments = await Appointment.find({ vendorId })
      .populate('userId') // Populates the user document
      .populate('insuranceProductId'); // Populates the insurance product document

    if (appointments.length === 0) {
      return res.status(404).json({ message: 'No appointments found for this vendor.' });
    }
    res.status(200).json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// New route to get all appointments for a specific user
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        // The key here is to use .find() with the user ID to get only that user's appointments.
        // .populate() is used to replace the IDs with actual document data.
        const appointments = await Appointment.find({ userId: userId })
            .populate('vendorId', 'name') // Populate vendor's name
            .populate('insuranceProductId', 'name mainImage description'); // Populate product details
        
        res.status(200).json(appointments);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching appointments', error });
    }
});

module.exports = router;