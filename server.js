require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Database Connection Pool (MySQL)
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test DB Connection
pool.query('SELECT 1')
  .then(() => {
    console.log('MySQL Database connected successfully.');
  })
  .catch((err) => {
    console.error('Database connection error:', err.message);
  });

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "/uploads/"],
      },
    },
  })
);

app.use(express.json());

// Serve static frontend and uploaded files
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.resolve(UPLOAD_DIR)));

// Rate Limiting for citizen creation
const registerRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many registration requests from this IP, please try again after a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

// Multer Upload Handler
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('LIMIT_UNSUPPORTED_TYPE'));
    }
  },
});

const uploadMiddleware = (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Photo size exceeds the 2MB limit.' });
      }
      if (err.message === 'LIMIT_UNSUPPORTED_TYPE') {
        return res.status(400).json({ error: 'Unsupported file type. Only JPEG, PNG, and WebP are allowed.' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

// Field validations
const validateCitizenInput = ({ full_name, mobile, aadhaar, dob, address }) => {
  const errors = {};

  if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 3) {
    errors.full_name = 'Full Name is required and must be at least 3 characters.';
  } else if (!/^[A-Za-z\s]+$/.test(full_name)) {
    errors.full_name = 'Full Name must contain alphabets and spaces only.';
  }

  if (!mobile || !/^\d{10}$/.test(mobile)) {
    errors.mobile = 'Mobile Number must be exactly 10 digits.';
  }

  if (!aadhaar || !/^\d{12}$/.test(aadhaar)) {
    errors.aadhaar = 'Aadhaar Number must be exactly 12 digits.';
  }

  if (!dob) {
    errors.dob = 'Date of Birth is required.';
  } else {
    const dobDate = new Date(dob);
    const today = new Date();
    if (isNaN(dobDate.getTime()) || dobDate >= today) {
      errors.dob = 'Date of Birth must be in the past.';
    } else {
      const ageLimitDate = new Date();
      ageLimitDate.setFullYear(today.getFullYear() - 1);
      if (dobDate > ageLimitDate) {
        errors.dob = 'Citizen must be at least 1 year old.';
      }
    }
  }

  if (!address || typeof address !== 'string' || address.trim().length < 10) {
    errors.address = 'Address is required and must be at least 10 characters.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

/**
 * Endpoint: POST /api/citizens/check
 */
app.post('/api/citizens/check', async (req, res) => {
  const { mobile, aadhaar } = req.body;
  
  if (!mobile || !aadhaar) {
    return res.status(400).json({ error: 'Mobile and Aadhaar values are required for verification.' });
  }

  try {
    const checkQuery = `
      SELECT 
        (SELECT COUNT(*) FROM citizens WHERE mobile = ?) > 0 AS mobile_exists,
        (SELECT COUNT(*) FROM citizens WHERE aadhaar = ?) > 0 AS aadhaar_exists;
    `;
    const [rows] = await pool.query(checkQuery, [mobile, aadhaar]);
    const { mobile_exists, aadhaar_exists } = rows[0];

    return res.json({
      mobile_exists: !!mobile_exists,
      aadhaar_exists: !!aadhaar_exists,
    });
  } catch (err) {
    console.error('Check duplicates database error:', err);
    return res.status(500).json({ error: 'Internal database error during validation check.' });
  }
});

/**
 * Endpoint: POST /api/citizens
 */
app.post('/api/citizens', registerRateLimiter, uploadMiddleware, async (req, res) => {
  const { full_name, mobile, aadhaar, dob, address } = req.body;
  const photoFile = req.file;

  if (!photoFile) {
    return res.status(400).json({ error: 'Please upload a photo to continue.' });
  }

  const validation = validateCitizenInput({ full_name, mobile, aadhaar, dob, address });
  if (!validation.isValid) {
    fs.unlinkSync(photoFile.path);
    return res.status(400).json({ errors: validation.errors });
  }

  try {
    // Check duplicates before inserting
    const checkQuery = `
      SELECT 
        (SELECT COUNT(*) FROM citizens WHERE mobile = ?) > 0 AS mobile_exists,
        (SELECT COUNT(*) FROM citizens WHERE aadhaar = ?) > 0 AS aadhaar_exists;
    `;
    const [checkRows] = await pool.query(checkQuery, [mobile, aadhaar]);
    const { mobile_exists, aadhaar_exists } = checkRows[0];

    if (mobile_exists || aadhaar_exists) {
      fs.unlinkSync(photoFile.path);
      if (mobile_exists && aadhaar_exists) {
        return res.status(409).json({ error: 'BOTH_DUPLICATE' });
      } else if (mobile_exists) {
        return res.status(409).json({ error: 'DUPLICATE_MOBILE' });
      } else {
        return res.status(409).json({ error: 'DUPLICATE_AADHAAR' });
      }
    }

    const photoPath = `/uploads/${photoFile.filename}`;

    // TODO (production): Encrypt Aadhaar values using AES-256 before storing
    const insertQuery = `
      INSERT INTO citizens (full_name, mobile, aadhaar, dob, address, photo_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(insertQuery, [
      full_name.trim(),
      mobile.trim(),
      aadhaar.trim(),
      dob,
      address.trim(),
      photoPath,
    ]);

    const insertId = result.insertId;

    // Fetch the newly created record
    const [rows] = await pool.query(
      `SELECT id, full_name, mobile, aadhaar, dob, address, photo_path, registered_at 
       FROM citizens WHERE id = ?`, 
      [insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    if (photoFile && fs.existsSync(photoFile.path)) {
      fs.unlinkSync(photoFile.path);
    }
    console.error('Insert database error:', err);

    // MySQL Duplicate Entry Code
    if (err.errno === 1062 || err.code === 'ER_DUP_ENTRY') {
      if (err.message && err.message.includes('mobile')) {
        return res.status(409).json({ error: 'DUPLICATE_MOBILE' });
      } else if (err.message && err.message.includes('aadhaar')) {
        return res.status(409).json({ error: 'DUPLICATE_AADHAAR' });
      }
      return res.status(409).json({ error: 'DUPLICATE_ENTRY' });
    }

    return res.status(500).json({ error: 'Internal database error during registration.' });
  }
});

/**
 * Endpoint: GET /api/citizens
 */
app.get('/api/citizens', async (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const searchPattern = `%${search}%`;
    const searchPatternMobile = `%${search}`;

    // Query count
    const countQuery = `
      SELECT COUNT(*) AS count
      FROM   citizens
      WHERE  full_name LIKE ? OR mobile LIKE ?;
    `;
    const [countRows] = await pool.query(countQuery, [searchPattern, searchPatternMobile]);
    const total = countRows[0].count;

    // Query records (explicitly typecast limit & offset in JS params as pool.query handles them)
    const selectQuery = `
      SELECT id, full_name, mobile, aadhaar, dob, address, photo_path, registered_at
      FROM   citizens
      WHERE  full_name LIKE ? OR mobile LIKE ?
      ORDER  BY registered_at DESC
      LIMIT  ? OFFSET ?;
    `;
    const [records] = await pool.query(selectQuery, [searchPattern, searchPatternMobile, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    return res.json({
      records,
      total,
      page,
      totalPages,
    });
  } catch (err) {
    console.error('Fetch citizens database error:', err);
    return res.status(500).json({ error: 'Internal database error while fetching citizens.' });
  }
});

/**
 * Endpoint: GET /api/citizens/:id
 * Fetch a single citizen by ID (returns full unmasked data for View/Edit).
 */
app.get('/api/citizens/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'Invalid citizen ID.' });
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, mobile, aadhaar, dob, address, photo_path, registered_at
       FROM citizens WHERE id = ?`,
      [parseInt(id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Citizen not found.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Fetch single citizen error:', err);
    return res.status(500).json({ error: 'Internal database error.' });
  }
});

/**
 * Endpoint: PUT /api/citizens/:id
 * Update citizen details (text fields only — photo not changed on edit).
 */
app.put('/api/citizens/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, mobile, aadhaar, dob, address } = req.body;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'Invalid citizen ID.' });

  // Server-side field validation
  const validation = validateCitizenInput({ full_name, mobile, aadhaar, dob, address });
  if (!validation.isValid) return res.status(400).json({ errors: validation.errors });

  try {
    // Check for duplicates excluding this citizen's own record
    const checkQuery = `
      SELECT
        (SELECT COUNT(*) FROM citizens WHERE mobile = ? AND id != ?) > 0 AS mobile_exists,
        (SELECT COUNT(*) FROM citizens WHERE aadhaar = ? AND id != ?) > 0 AS aadhaar_exists;
    `;
    const [checkRows] = await pool.query(checkQuery, [mobile, id, aadhaar, id]);
    const { mobile_exists, aadhaar_exists } = checkRows[0];
    if (mobile_exists) return res.status(409).json({ error: 'DUPLICATE_MOBILE' });
    if (aadhaar_exists) return res.status(409).json({ error: 'DUPLICATE_AADHAAR' });

    // TODO (production): Encrypt Aadhaar values using AES-256 before storing
    await pool.query(
      `UPDATE citizens SET full_name=?, mobile=?, aadhaar=?, dob=?, address=? WHERE id=?`,
      [full_name.trim(), mobile.trim(), aadhaar.trim(), dob, address.trim(), parseInt(id)]
    );

    const [rows] = await pool.query(
      `SELECT id, full_name, mobile, aadhaar, dob, address, photo_path, registered_at FROM citizens WHERE id=?`,
      [parseInt(id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Citizen not found after update.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Update citizen error:', err);
    if (err.errno === 1062 || err.code === 'ER_DUP_ENTRY') {
      if (err.message && err.message.includes('mobile')) return res.status(409).json({ error: 'DUPLICATE_MOBILE' });
      if (err.message && err.message.includes('aadhaar')) return res.status(409).json({ error: 'DUPLICATE_AADHAAR' });
      return res.status(409).json({ error: 'DUPLICATE_ENTRY' });
    }
    return res.status(500).json({ error: 'Internal database error during update.' });
  }
});

/**
 * Endpoint: DELETE /api/citizens/:id
 * Delete a citizen record and remove their uploaded photo from disk.
 */
app.delete('/api/citizens/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'Invalid citizen ID.' });
  try {
    // Fetch photo path before deletion so we can clean up the file
    const [rows] = await pool.query(
      `SELECT photo_path FROM citizens WHERE id=?`, [parseInt(id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Citizen not found.' });

    await pool.query(`DELETE FROM citizens WHERE id=?`, [parseInt(id)]);

    // Remove photo file from disk if it exists
    const photoPath = rows[0].photo_path;
    if (photoPath) {
      const filePath = path.join(__dirname, photoPath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    return res.json({ success: true, message: 'Citizen record deleted.' });
  } catch (err) {
    console.error('Delete citizen error:', err);
    return res.status(500).json({ error: 'Internal database error during deletion.' });
  }
});


// Default frontend fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'badshah.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Badshah backend server running on http://localhost:${PORT}`);
});
