// const DeliveryBoy = require('../models/DeliveryBoy');
// const Order = require('../models/Order'); // Assuming you have this model
// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');

// // Generate JWT
// const generateToken = (id) => {
//     return jwt.sign({ id, role: 'deliveryBoy' }, process.env.JWT_SECRET || 'your_jwt_secret', {
//         expiresIn: '7d',
//     });
// };

// // --- Public Controllers ---

// exports.registerDeliveryBoy = async (req, res) => {
//     try {
//         const { name, email, phone, password, vehicleType, vehicleNumber, licenseNumber } = req.body;

//         const exists = await DeliveryBoy.findOne({ $or: [{ email }, { phone }] });
//         if (exists) return res.status(400).json({ message: 'Email or phone already registered.' });

//         const deliveryBoy = await DeliveryBoy.create({
//             name, email, phone, password, vehicleType, vehicleNumber, licenseNumber
//         });

//         res.status(201).json({ message: 'Registration successful. Awaiting admin approval.' });
//     } catch (err) {
//         res.status(500).json({ message: 'Server error', error: err.message });
//     }
// };

// exports.authDeliveryBoy = async (req, res) => {
//     try {
//         const { email, password } = req.body;

//         const deliveryBoy = await DeliveryBoy.findOne({ email }).select('+password');
//         if (!deliveryBoy) return res.status(400).json({ message: 'Invalid credentials' });

//         const isMatch = await bcrypt.compare(password, deliveryBoy.password);
//         if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

//         const token = generateToken(deliveryBoy._id);

//         res.json({
//             token,
//             deliveryBoy: {
//                 id: deliveryBoy._id,
//                 name: deliveryBoy.name,
//                 email: deliveryBoy.email,
//                 phone: deliveryBoy.phone,
//                 isVerified: deliveryBoy.isVerified,
//                 isAdminApproved: deliveryBoy.isAdminApproved,
//                 status: deliveryBoy.status,
//             },
//         });
//     } catch (err) {
//         res.status(500).json({ message: 'Server error', error: err.message });
//     }
// };

// // --- Private (Delivery Boy) Controllers ---

// exports.getDeliveryBoyProfile = async (req, res) => {
//     res.json(req.deliveryBoy);
// };

// exports.updateDeliveryBoyProfile = async (req, res) => {
//     const fieldsToUpdate = req.body;

//     try {
//         const updated = await DeliveryBoy.findByIdAndUpdate(req.deliveryBoy._id, fieldsToUpdate, { new: true });
//         res.json(updated);
//     } catch (err) {
//         res.status(500).json({ message: 'Update failed', error: err.message });
//     }
// };

// exports.updateDeliveryBoyLocation = async (req, res) => {
//     const { latitude, longitude } = req.body;
//     try {
//         const updated = await DeliveryBoy.findByIdAndUpdate(
//             req.deliveryBoy._id,
//             {
//                 'currentLocation.latitude': latitude,
//                 'currentLocation.longitude': longitude,
//                 'currentLocation.timestamp': new Date(),
//             },
//             { new: true }
//         );
//         res.json({ message: 'Location updated', data: updated });
//     } catch (err) {
//         res.status(500).json({ message: 'Failed to update location', error: err.message });
//     }
// };

// exports.updateDeliveryBoyAvailability = async (req, res) => {
//     const { status } = req.body;
//     if (!['available', 'on_delivery', 'offline', 'unavailable'].includes(status)) {
//         return res.status(400).json({ message: 'Invalid status' });
//     }

//     try {
//         const updated = await DeliveryBoy.findByIdAndUpdate(
//             req.deliveryBoy._id,
//             { status, lastOnline: new Date() },
//             { new: true }
//         );
//         res.json({ message: 'Status updated', status: updated.status });
//     } catch (err) {
//         res.status(500).json({ message: 'Failed to update status', error: err.message });
//     }
// };

// exports.getMyAssignedOrders = async (req, res) => {
//     try {
//         const orders = await Order.find({ assignedTo: req.deliveryBoy._id });
//         res.json(orders);
//     } catch (err) {
//         res.status(500).json({ message: 'Failed to fetch orders', error: err.message });
//     }
// };

// exports.updateAssignedOrderStatus = async (req, res) => {
//     const { orderId } = req.params;
//     const { status } = req.body;

//     try {
//         const order = await Order.findById(orderId);
//         if (!order || order.assignedTo.toString() !== req.deliveryBoy._id.toString()) {
//             return res.status(403).json({ message: 'Not authorized to update this order' });
//         }

//         order.status = status;
//         await order.save();

//         res.json({ message: 'Order status updated', order });
//     } catch (err) {
//         res.status(500).json({ message: 'Error updating order', error: err.message });
//     }
// };

// // --- Vendor Controllers ---

// exports.getAvailableDeliveryBoys = async (req, res) => {
//     try {
//         const availableBoys = await DeliveryBoy.find({
//             status: 'available',
//             isVerified: true,
//             isAdminApproved: true,
//         });
//         res.json(availableBoys);
//     } catch (err) {
//         res.status(500).json({ message: 'Error fetching available delivery boys' });
//     }
// };

// // --- Admin Controllers ---

// exports.getAllDeliveryBoysAdmin = async (req, res) => {
//     try {
//         const deliveryBoys = await DeliveryBoy.find().sort({ createdAt: -1 });
//         res.json(deliveryBoys);
//     } catch (err) {
//         res.status(500).json({ message: 'Error fetching all delivery boys', error: err.message });
//     }
// };

// exports.getDeliveryBoyByIdAdmin = async (req, res) => {
//     try {
//         const deliveryBoy = await DeliveryBoy.findById(req.params.id);
//         if (!deliveryBoy) return res.status(404).json({ message: 'Delivery boy not found' });
//         res.json(deliveryBoy);
//     } catch (err) {
//         res.status(500).json({ message: 'Error fetching delivery boy', error: err.message });
//     }
// };

// exports.updateDeliveryBoyByAdmin = async (req, res) => {
//     try {
//         const deliveryBoy = await DeliveryBoy.findByIdAndUpdate(req.params.id, req.body, { new: true });
//         if (!deliveryBoy) return res.status(404).json({ message: 'Delivery boy not found' });
//         res.json({ message: 'Delivery boy updated', data: deliveryBoy });
//     } catch (err) {
//         res.status(500).json({ message: 'Error updating delivery boy', error: err.message });
//     }
// };

// exports.deleteDeliveryBoyAdmin = async (req, res) => {
//     try {
//         await DeliveryBoy.findByIdAndDelete(req.params.id);
//         res.json({ message: 'Delivery boy deleted' });
//     } catch (err) {
//         res.status(500).json({ message: 'Error deleting delivery boy', error: err.message });
//     }
// };
