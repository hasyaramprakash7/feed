// services/logisticsService.js
// --- FINALIZED LOGISTICS SERVICE WITH LIVE RATE FETCH & LIVE BOOKING STRUCTURE ---

require('dotenv').config(); 
const axios = require('axios');

// --- Shiprocket Configuration ---
const SHIPROCKET_API_EMAIL = process.env.SHIPROCKET_API_EMAIL;
const SHIPROCKET_API_PASSWORD = process.env.SHIPROCKET_API_PASSWORD;

// Live API Endpoints
const SHIPROCKET_AUTH_URL = 'https://apiv2.shiprocket.in/v1/external/auth/login';
const SHIPROCKET_RATES_URL = 'https://apiv2.shiprocket.in/v1/external/courier/serviceability/';
const SHIPROCKET_BOOKING_URL = 'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc';
const SHIPROCKET_ASSIGN_AWB_URL = 'https://apiv2.shiprocket.in/v1/external/courier/assign/awb';
const SHIPROCKET_GENERATE_LABEL_URL = 'https://apiv2.shiprocket.in/v1/external/courier/generate/label';


// Simple in-memory token storage (Use Redis/DB in Production!)
let AUTH_TOKEN = null;
let TOKEN_EXPIRY = 0;

// --- Helper Functions for Data Integrity ---

// Ensures name is split safely, providing defaults if necessary
const safeSplitName = (fullName) => {
    const parts = (fullName || 'Customer N/A').trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || firstName; // Use first name if last is missing
    return { firstName, lastName };
};

// Ensures a value is a non-empty string, providing a placeholder if necessary
const safeString = (value, placeholder = 'N/A') => {
    return (value && String(value).trim()) || placeholder;
};

// --- 1. Authentication Function ---
const getAuthToken = async () => {
    if (AUTH_TOKEN && Date.now() < TOKEN_EXPIRY) {
        return AUTH_TOKEN;
    }

    try {
        console.log("Shiprocket: Authenticating to get a new token...");
        const response = await axios.post(SHIPROCKET_AUTH_URL, {
            email: SHIPROCKET_API_EMAIL,
            password: SHIPROCKET_API_PASSWORD
        });

        AUTH_TOKEN = response.data.token;
        // Token is typically valid for 10 days (240 hours)
        TOKEN_EXPIRY = Date.now() + (9 * 24 * 60 * 60 * 1000); 
        console.log("Shiprocket: Token obtained successfully.");
        return AUTH_TOKEN;
    } catch (error) {
        console.error("❌ Shiprocket Authentication Failed:", error.response?.data?.message || error.message);
        throw new Error("Logistics Auth Failed. Check API credentials.");
    }
};

// --- 2. Get Delivery Rates (Serviceability) - LIVE API CALL ---
const getDeliveryRates = async (pickupPin, deliveryPin, weightKg, codValue, lengthCm, widthCm, heightCm) => {
    // --- DEBUG LOG START ---
    console.log(`[LOGISTICS DEBUG] Fetching rates for: P:${pickupPin}, D:${deliveryPin}, W:${weightKg}, COD:${codValue}`);
    // --- DEBUG LOG END ---
    
    const token = await getAuthToken();
    const headers = { 'Authorization': `Bearer ${token}` };

    const params = {
        pickup_postcode: pickupPin,
        delivery_postcode: deliveryPin,
        weight: weightKg.toFixed(2), 
        cod: codValue > 0 ? 1 : 0, 
        length: lengthCm, 
        width: widthCm, 
        height: heightCm, 
    };

    try {
        // *** LIVE SHIPROCKET API CALL ***
        const response = await axios.get(SHIPROCKET_RATES_URL, { headers, params });
        // --- DEBUG LOG START ---
        console.log(`[LOGISTICS DEBUG] Rate check successful. Couriers found: ${response.data.data.available_courier_companies?.length || 0}`);
        // --- DEBUG LOG END ---

        if (response.data && response.data.data && response.data.data.available_courier_companies) {
            const liveRates = response.data.data.available_courier_companies
                .filter(courier => courier.rate > 0) 
                .map(courier => ({
                    partner: courier.courier_name,
                    price: courier.rate,
                    estimated_delivery_days: courier.estimated_delivery_days,
                    courier_id: courier.courier_company_id,
                }));

            return liveRates; 
        } else {
            console.log("Shiprocket Rates API returned no available couriers.");
            return [];
        }

    } catch (error) {
        console.error("❌ Shiprocket Rates API Error:", error.response?.data?.message || error.message);
        throw new Error("Failed to fetch rates from courier aggregator. Check pin codes and connectivity.");
    }
};

// --- 3. Book Shipment - LIVE INTEGRATION (Order Creation -> AWB Assign -> Label Generation) ---
const bookShipment = async (order, partner, vendorDetails, totalWeightKg, dimensions) => {
    const token = await getAuthToken();
    const headers = { 
        'Authorization': `Bearer ${token}`, 
        'Content-Type': 'application/json' 
    };
    const orderIdString = order._id.toString(); 
    const VENDOR_ADDRESS = vendorDetails.address || {};

    // Helper variables based on Order address
    const CUSTOMER_ADDRESS = order.address;
    const { firstName: customerFirstName, lastName: customerLastName } = safeSplitName(CUSTOMER_ADDRESS.fullName);
    const vendorEmail = safeString(vendorDetails.email, 'vendor@example.com');
    const customerEmail = safeString(order.userId.email, 'customer@example.com'); // Using populated email
    
    // Perform validation on critical fields before payload construction
    const pickupPin = safeString(VENDOR_ADDRESS.zipCode || VENDOR_ADDRESS.pincode, '110001');
    const customerPin = safeString(CUSTOMER_ADDRESS.zipCode, '110001');
    const pickupPhone = safeString(vendorDetails.phone || VENDOR_ADDRESS.phone, '9999999999').replace('+91', '').slice(-10); // Use vendorDetails.phone
    const customerPhone = safeString(CUSTOMER_ADDRESS.phone, '9999999999').replace('+91', '').slice(-10);
    
    // --- SYNCHRONIZATION FIX: Generate a new unique SR Order ID based on MongoDB ID and timestamp ---
    // This is crucial to bypass the 500 error due to conflict/reuse of the base MongoDB ID.
    const uniqueSuffix = Date.now().toString().slice(-6);
    const srOrderId = `${orderIdString.slice(-8)}-${uniqueSuffix}`;
    // --- END FIX ---


    // --- STEP 1: CREATE ORDER (GET SHIPROCKET ORDER ID) ---
    const createOrderPayload = {
        order_id: srOrderId, // <<< USING THE NEW UNIQUE ID HERE
        order_date: new Date(order.createdAt).toISOString().split('T')[0],
        
        // =======================================================
        // PRICING & TOP-LEVEL DIMENSIONS (All formatted .toFixed(2))
        // =======================================================
        sub_total: order.total.toFixed(2), 
        total_amount: order.total.toFixed(2), 
        length: dimensions.length.toFixed(2), 
        breadth: dimensions.width.toFixed(2), 
        height: dimensions.height.toFixed(2), 
        shipping_is_billing: true, 
        
        // =======================================================
        // VENDOR PICKUP DETAILS (Origin) - Using safe strings
        // NOTE: If VENDOR_ADDRESS.street is "Street Address Missing", this will fail.
        // The responsibility is now on the caller (controller) to validate or the DB to contain data.
        // =======================================================
        pickup_name: safeString(vendorDetails.shopName || VENDOR_ADDRESS.fullName, "Vendor Pickup"), 
        pickup_address: safeString(VENDOR_ADDRESS.street || VENDOR_ADDRESS.street2, "Street Address Missing"),
        pickup_address_2: safeString(VENDOR_ADDRESS.landmark, ""),
        pickup_city: safeString(VENDOR_ADDRESS.city, "City Missing"),
        pickup_state: safeString(VENDOR_ADDRESS.state, "State Missing"),
        pickup_pincode: pickupPin, 
        pickup_country: safeString(VENDOR_ADDRESS.country, "India"),
        pickup_phone: pickupPhone,
        pickup_email: vendorEmail,


        // =======================================================
        // BILLING DETAILS (Mandatory) - Using safe strings
        // =======================================================
        billing_customer_name: customerFirstName,
        billing_last_name: customerLastName, 
        billing_address: safeString(CUSTOMER_ADDRESS.street, "Street Address Missing"),
        billing_address_2: safeString(CUSTOMER_ADDRESS.street2 || CUSTOMER_ADDRESS.landmark, ""),
        billing_city: safeString(CUSTOMER_ADDRESS.city, "City Missing"),
        billing_state: safeString(CUSTOMER_ADDRESS.state, "State Missing"),
        billing_pincode: customerPin, 
        billing_country: safeString(CUSTOMER_ADDRESS.country, "India"),
        billing_email: customerEmail, 
        billing_phone: customerPhone, 


        // =======================================================
        // SHIPPING DETAILS (Destination) - Using safe strings
        // =======================================================
        shipping_customer_name: customerFirstName,
        shipping_last_name: customerLastName,
        shipping_address: safeString(CUSTOMER_ADDRESS.street, "Street Address Missing"),
        shipping_address_2: safeString(CUSTOMER_ADDRESS.street2 || CUSTOMER_ADDRESS.landmark, ""),
        shipping_city: safeString(CUSTOMER_ADDRESS.city, "City Missing"),
        shipping_state: safeString(CUSTOMER_ADDRESS.state, "State Missing"),
        shipping_pincode: customerPin, 
        shipping_country: safeString(CUSTOMER_ADDRESS.country, "India"),
        shipping_email: customerEmail, 
        shipping_phone: customerPhone,


        // PACKAGE & ITEMS
        payment_method: order.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
        order_items: order.items.map(item => ({
            name: safeString(item.name, 'Product N/A'),
            sku: safeString(item.productId.toString(), 'SKU001'), 
            units: item.quantity,
            selling_price: item.price.toFixed(2), 
            tax: 0, 
            hsn: 4420, // Dummy HSN
        })),
        weight: totalWeightKg ? totalWeightKg.toFixed(2) : "0.50",
        dimensions: {
            length: dimensions.length.toFixed(2),
            width: dimensions.width.toFixed(2),
            height: dimensions.height.toFixed(2),
        },
        courier_id: partner.courier_id
    };
    
    console.log(`Shiprocket: Attempting to create order ${srOrderId}.`); 
    // --- DEBUG LOG START: Log the ENTIRE payload for 500 error diagnosis ---
    console.log("--------------------------------------------------");
    console.log(`[LOGISTICS DEBUG] Payload for SR ID ${srOrderId}:`);
    // console.log(JSON.stringify(createOrderPayload, null, 2)); // Uncomment for deep debugging
    console.log("--------------------------------------------------");
    // --- DEBUG LOG END ---


    let shiprocketOrderId;
    let awbCode;
    let labelUrl;
    let finalCost;

    try {
        const createResponse = await axios.post(SHIPROCKET_BOOKING_URL, createOrderPayload, { headers });
        const data = createResponse.data;

        if (data.status_code === 100) {
            shiprocketOrderId = data.order_id; // Shiprocket's own ID
            console.log(`✅ Shiprocket Order created. MongoDB ID: ${orderIdString.slice(-8)}, SR Ref ID: ${srOrderId}`);
        } else {
            console.error("Shiprocket Create Order Failed:", data);
            const errorMsg = data.message || JSON.stringify(data.errors, null, 2);
            throw new Error(`Order creation failed: ${errorMsg}`);
        }

    } catch (error) {
        console.error("🚨🚨🚨 SHIPROCKET CRITICAL FAILURE (500) 🚨🚨🚨");
        console.error(`Error details: ${error.response?.data?.message || error.message}`);
        console.error(`Conflicting SR Order ID attempted: ${srOrderId}`); 
        throw new Error(`Failed to create order with Shiprocket: ${error.response?.data?.message || error.message}`);
    }


    // --- STEP 2: ASSIGN AWB & COURIER (SHIP THE ORDER) ---
    const awbPayload = {
        shipment_id: shiprocketOrderId, // Use Shiprocket's ID
        courier_id: partner.courier_id, // Selected Courier ID
    };

    try {
        const awbResponse = await axios.post(SHIPROCKET_ASSIGN_AWB_URL, awbPayload, { headers });
        const awbData = awbResponse.data;

        if (awbData.status_code === 200 && awbData.response?.awb_code) {
            awbCode = awbData.response.awb_code;
            finalCost = awbData.response.rate;
            console.log(`✅ AWB Assigned. AWB: ${awbCode}, Rate: ${finalCost}`);
        } else {
            console.error("Shiprocket AWB Assignment Failed:", awbData);
            throw new Error(`AWB assignment failed: ${awbData.message || JSON.stringify(awbData)}`);
        }
    } catch (error) {
        console.error("❌ Shiprocket AWB API Error:", error.response?.data || error.message);
        throw new Error(`Failed to assign AWB: ${error.response?.data?.message || error.message}`);
    }


    // --- STEP 3: GENERATE SHIPPING LABEL ---
    const labelPayload = {
        shipment_id: [shiprocketOrderId] // Expects an array of Shiprocket IDs
    };

    try {
        const labelResponse = await axios.post(SHIPROCKET_GENERATE_LABEL_URL, labelPayload, { headers });
        const labelData = labelResponse.data;

        if (labelData.status_code === 200 && labelData.label_url) {
            labelUrl = labelData.label_url;
            console.log(`✅ Label Generated: ${labelUrl}`);
        } else {
            console.error("Shiprocket Label Generation Failed:", labelData);
            // Non-critical failure, can proceed with order update but warn the vendor
        }
    } catch (error) {
        console.error("❌ Shiprocket Label API Error:", error.response?.data || error.message);
        // Continue if label generation fails, as the AWB is already assigned
    }

    // --- RETURN FINAL LOGISTICS DATA ---
    return {
        trackingId: awbCode,
        labelUrl: labelUrl || "Label generation failed.", // Return URL or the error message
        finalCost: finalCost || partner.price,
    };
};

// --- EXPORT THE FUNCTIONS ---
module.exports = {
    getAuthToken, // Added for potential external use/testing
    getDeliveryRates,
    bookShipment
};