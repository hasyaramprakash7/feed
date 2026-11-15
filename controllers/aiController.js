// my-ecommerce-app/server/controllers/aiController.js

const axios = require('axios');

// NOTE: Use environment variables for the AI Service URL in production
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://10.245.18.2:8001/generate-project';// @desc    Orchestrate AI Project Generation (Proxy to Python service)
// @route   POST /api/ai
// @access  Private (Vendor/User)
const generateProject = async (req, res) => {
    // 1. Authentication & Authorization Check (Crucial for Premium Service)
    // const userId = req.user._id; 
    
    const { userMessage, initialPrompt, sessionId } = req.body; 

    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required.' });
    }

    try {
        // 2. Call the Python AI Microservice with the new required payload
        const response = await axios.post(AI_SERVICE_URL, {
            session_id: sessionId,
            user_message: userMessage,        // The current message being sent
            initial_prompt: initialPrompt,    // The original project idea (sent every time)
        });

        // 3. Forward the response
        res.status(200).json(response.data);

    } catch (error) {
        console.error('AI Service Error:', error.response?.data || error.message);
        
        // Log details from the AI service for debugging
        const details = error.response?.data?.detail || error.message;

        res.status(error.response?.status || 500).json({
            message: 'Failed to process AI request.',
            details: details,
        });
    }
};

module.exports = { generateProject };