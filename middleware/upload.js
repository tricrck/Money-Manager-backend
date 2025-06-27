const multer = require('multer');
const multerS3 = require('multer-s3');
const s3Client = require('../config/aws'); // S3Client instance

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_BUCKET_NAME,
    // acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const fileName = `uploads/${Date.now()}_${file.originalname}`;
      cb(null, fileName);
    }
  })
});

module.exports = upload;