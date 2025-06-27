const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/aws');

const deleteFromS3 = async (fileUrl) => {
  try {
    const bucket = process.env.AWS_BUCKET_NAME;
    const key = decodeURIComponent(fileUrl.split('.amazonaws.com/')[1]);

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    });

    await s3Client.send(command);
    console.log(`Deleted from S3: ${key}`);
  } catch (error) {
    console.error('S3 deletion error:', error.message);
  }
};

module.exports = deleteFromS3;
