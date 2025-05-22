require('dotenv').config();
const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const XLSX = require('xlsx');
const cors = require('cors');
const app = express();
const port = 3000;

// Allow requests from same origin (optional CORS setup)
app.use(cors());
app.use(express.static('public'));

// Multer config (store uploaded video in memory)
const upload = multer({ storage: multer.memoryStorage() });

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  region: 'ap-south-1',
});

const s3 = new AWS.S3();
const BUCKET_NAME = 'webcam-video-poc-bucket';
const LOG_FILE_KEY = 'session_log.xlsx';

// Upload video to S3
function uploadToS3(Key, Body, ContentType) {
  return s3.upload({ Bucket: BUCKET_NAME, Key, Body, ContentType }).promise();
}

// Append session status to Excel log file in S3
async function appendLogToS3(sessionId, status, watchedPercent = null) {
  let rows = [];
  let workbook;

  try {
    const data = await s3.getObject({ Bucket: BUCKET_NAME, Key: LOG_FILE_KEY }).promise();
    workbook = XLSX.read(data.Body, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      // File doesn't exist — create a new workbook
      rows = [['Session ID', 'Status', 'Watched %']];
      workbook = XLSX.utils.book_new();
    } else {
      console.error('Error reading Excel file:', err);
      throw err;
    }
  }

  
  rows.push([sessionId, status, watchedPercent !== null ? `${watchedPercent}%` : 'N/A']);

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, newSheet, 'Log');

  const buffer = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' });

  await s3.putObject({
    Bucket: BUCKET_NAME,
    Key: LOG_FILE_KEY,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }).promise();

  console.log(`✅ Log saved for ${sessionId} (${status}) | Watched: ${watchedPercent ?? 'N/A'}%`);
}


// Handle video upload and log session
app.post('/upload', upload.single('video'), async (req, res) => {
  const { sessionId, status, watchedPercent } = req.body;
  console.log(`Incoming sessionId=${sessionId}, status=${status}, watchedPercent=${watchedPercent}`);
  const videoBuffer = req.file?.buffer;
  const videoMime = req.file?.mimetype || 'video/webm';

  if (!videoBuffer || !sessionId) {
    return res.status(400).send('Missing video or sessionId');
  }

  try {
    const videoKey = `${sessionId}.webm`;
    await uploadToS3(videoKey, videoBuffer, videoMime);
    await appendLogToS3(sessionId, status, watchedPercent);
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Upload or logging failed:', err);
    res.status(500).send('Server error');
  }
});


app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
