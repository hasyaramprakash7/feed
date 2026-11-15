const express = require("express");
const router = express.Router();
const { protectAdmin } = require("../middleware/adminAuth");

const User = require("../models/User");
const Vendor = require("../models/Vendor");
const DeliveryBoy = require("../models/DeliveryBoy");
const Order = require("../models/Order");
const VendorProduct = require("./vendorProductRoutes");

//
// USERS CRUD
//
router.get("/users", protectAdmin, async (req, res) => {
  const users = await User.find();
  res.json(users);
});

router.get("/users/:id", protectAdmin, async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user);
});

router.post("/users", protectAdmin, async (req, res) => {
  const newUser = await User.create(req.body);
  res.status(201).json(newUser);
});

router.put("/users/:id", protectAdmin, async (req, res) => {
  const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedUser);
});

router.delete("/users/:id", protectAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: "User deleted" });
});

//
// VENDORS CRUD
//
router.get("/vendors", protectAdmin, async (req, res) => {
  const vendors = await Vendor.find();
  res.json(vendors);
});

router.get("/vendors/:id", protectAdmin, async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  res.json(vendor);
});

router.post("/vendors", protectAdmin, async (req, res) => {
  const newVendor = await Vendor.create(req.body);
  res.status(201).json(newVendor);
});

router.put("/vendors/:id", protectAdmin, async (req, res) => {
  const updatedVendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedVendor);
});

router.delete("/vendors/:id", protectAdmin, async (req, res) => {
  await Vendor.findByIdAndDelete(req.params.id);
  res.json({ message: "Vendor deleted" });
});

//
// DELIVERY BOYS CRUD
//
router.get("/delivery-boys", protectAdmin, async (req, res) => {
  const boys = await DeliveryBoy.find();
  res.json(boys);
});

router.get("/delivery-boys/:id", protectAdmin, async (req, res) => {
  const boy = await DeliveryBoy.findById(req.params.id);
  res.json(boy);
});

router.post("/delivery-boys", protectAdmin, async (req, res) => {
  const newBoy = await DeliveryBoy.create(req.body);
  res.status(201).json(newBoy);
});

router.put("/delivery-boys/:id", protectAdmin, async (req, res) => {
  const updatedBoy = await DeliveryBoy.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedBoy);
});

router.delete("/delivery-boys/:id", protectAdmin, async (req, res) => {
  await DeliveryBoy.findByIdAndDelete(req.params.id);
  res.json({ message: "Delivery boy deleted" });
});

//
// PRODUCTS CRUD
//
router.get("/products", protectAdmin, async (req, res) => {
  const products = await VendorProduct.find().populate("vendorId");
  res.json(products);
});

router.get("/products/:id", protectAdmin, async (req, res) => {
  const product = await VendorProduct.findById(req.params.id).populate("vendorId");
  res.json(product);
});

router.post("/products", protectAdmin, async (req, res) => {
  const newProduct = await VendorProduct.create(req.body);
  res.status(201).json(newProduct);
});

router.put("/products/:id", protectAdmin, async (req, res) => {
  const updatedProduct = await VendorProduct.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedProduct);
});

router.delete("/products/:id", protectAdmin, async (req, res) => {
  await VendorProduct.findByIdAndDelete(req.params.id);
  res.json({ message: "Product deleted" });
});

//
// ORDERS CRUD
//
router.get("/orders", protectAdmin, async (req, res) => {
  const orders = await Order.find().populate("userId deliveryBoy items.productId");
  res.json(orders);
});

router.get("/orders/:id", protectAdmin, async (req, res) => {
  const order = await Order.findById(req.params.id).populate("userId deliveryBoy items.productId");
  res.json(order);
});

router.post("/orders", protectAdmin, async (req, res) => {
  const newOrder = await Order.create(req.body);
  res.status(201).json(newOrder);
});

router.put("/orders/:id", protectAdmin, async (req, res) => {
  const updatedOrder = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedOrder);
});

router.delete("/orders/:id", protectAdmin, async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ message: "Order deleted" });
});

module.exports = router;
