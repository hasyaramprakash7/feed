const cloudinary = require('../config/cloudinary'); // your existing Cloudinary config
const streamifier = require('streamifier');

// Upload a single image (multer already parsed the file)
exports.uploadAdImage = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'fail', message: 'No image file provided' });
    }

    // Use streamifier to upload buffer to Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'ads', // optional: store in a separate folder
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }],
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          return res.status(500).json({ status: 'fail', message: 'Image upload failed' });
        }
        // Return the secure URL
        res.status(200).json({ status: 'success', url: result.secure_url });
      }
    );

    // Pipe the buffer to the upload stream
    streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
  } catch (error) {
    console.error('Upload controller error:', error);
    res.status(500).json({ status: 'fail', message: error.message });
  }
};