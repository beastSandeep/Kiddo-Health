const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Middleware - increased limit to handle large base64 JSON imports
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Helper to read data
const readData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    return { prescriptions: [] };
  }
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
};

// Helper to write data
const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// --- Routes ---

app.get('/api/prescriptions', (req, res) => {
  const data = readData();
  res.json(data.prescriptions);
});

app.post('/api/prescriptions', (req, res) => {
  const data = readData();
  const newPrescription = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString() };
  data.prescriptions.push(newPrescription);
  writeData(data);
  res.status(201).json(newPrescription);
});

app.put('/api/prescriptions/:id', (req, res) => {
  const data = readData();
  const index = data.prescriptions.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).send('Prescription not found');
  
  data.prescriptions[index] = { ...data.prescriptions[index], ...req.body, updatedAt: new Date().toISOString() };
  writeData(data);
  res.json(data.prescriptions[index]);
});

app.delete('/api/prescriptions/:id', (req, res) => {
  const data = readData();
  const initialLength = data.prescriptions.length;
  data.prescriptions = data.prescriptions.filter(p => p.id !== req.params.id);
  if (data.prescriptions.length === initialLength) return res.status(404).send('Prescription not found');
  
  writeData(data);
  res.status(204).send();
});

app.post('/api/upload', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).send('No files uploaded.');
  const filePaths = req.files.map(file => `/uploads/${file.filename}`);
  res.json({ filePaths });
});

// --- Data Export & Import ---

app.get('/api/export', (req, res) => {
  const embed = req.query.embed === 'true';
  let data = readData();
  
  if (embed) {
    data.prescriptions = data.prescriptions.map(p => {
      let newAttachments = {};
      if (p.attachments) {
        Object.keys(p.attachments).forEach(type => {
          newAttachments[type] = p.attachments[type].map(filePath => {
            if (filePath.startsWith('/uploads/')) {
              const fullPath = path.join(__dirname, filePath);
              if (fs.existsSync(fullPath)) {
                const ext = path.extname(fullPath).substring(1);
                const base64 = fs.readFileSync(fullPath, 'base64');
                return `data:image/${ext};base64,${base64}`;
              }
            }
            return filePath;
          });
        });
      }
      return { ...p, attachments: newAttachments };
    });
  }
  res.json(data);
});

app.post('/api/import', (req, res) => {
  let incomingData = req.body;
  if (!incomingData || !Array.isArray(incomingData.prescriptions)) {
    return res.status(400).send('Invalid JSON format');
  }

  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

  incomingData.prescriptions = incomingData.prescriptions.map(p => {
    if (p.attachments) {
      Object.keys(p.attachments).forEach(type => {
        if (Array.isArray(p.attachments[type])) {
          p.attachments[type] = p.attachments[type].map(fileData => {
            if (typeof fileData === 'string' && fileData.startsWith('data:image')) {
              const matches = fileData.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
              if (matches && matches.length === 3) {
                const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                const base64Data = matches[2];
                const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.' + ext;
                const fullPath = path.join(UPLOADS_DIR, filename);
                fs.writeFileSync(fullPath, base64Data, 'base64');
                return `/uploads/${filename}`;
              }
            }
            return fileData;
          });
        }
      });
    }
    return p;
  });

  const currentData = readData();
  const existingIds = new Set(currentData.prescriptions.map(p => p.id));
  
  incomingData.prescriptions.forEach(p => {
    if (!existingIds.has(p.id)) {
      currentData.prescriptions.push(p);
    } else {
      const idx = currentData.prescriptions.findIndex(e => e.id === p.id);
      currentData.prescriptions[idx] = p; // update existing
    }
  });

  writeData(currentData);
  res.json({ message: 'Import successful, data merged.' });
});

// --- Server Startup ---
const os = require('os');
const qrcode = require('qrcode-terminal');

app.listen(PORT, () => {
  const networkInterfaces = os.networkInterfaces();
  console.log(`\x1b[36m%s\x1b[0m`, `-------------------------------------------------`);
  console.log(`\x1b[32m%s\x1b[0m`, `KiddoHealth Server is running!`);
  console.log(`Local:   http://localhost:${PORT}`);
  
  let networkUrl = '';
  Object.keys(networkInterfaces).forEach((interfaceName) => {
    networkInterfaces[interfaceName].forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkUrl = `http://${iface.address}:${PORT}`;
        console.log(`Network: ${networkUrl}`);
      }
    });
  });

  if (networkUrl) {
    console.log(`\nScan the QR code below to open on your phone:`);
    qrcode.generate(networkUrl, { small: true });
  }
  console.log(`\x1b[36m%s\x1b[0m`, `-------------------------------------------------`);
});
