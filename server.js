const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs'); // Node.js file system module for file operations
const { Client } = require('@googlemaps/google-maps-services-js');
const {
  initDatabase,
  getAllUsers,
  findUserByUsername,
  createUser,
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllTransactions,
  getNextTransactionId,
  createTransaction,
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDatabase();

// Initialize Google Maps client
const mapsClient = new Client({});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Simple cookie parser for reading username cookie without extra dependency
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(function(cookie) {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    const value = parts.join('=');
    list[name] = decodeURIComponent(value);
  });
  return list;
}

// Setup uploads directory and multer
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
// Serve uploaded files from /uploads
app.use('/uploads', express.static(uploadsDir));

// Setup payment-proofs directory
const paymentProofsDir = path.join(__dirname, 'payment-proofs');
if (!fs.existsSync(paymentProofsDir)) {
  fs.mkdirSync(paymentProofsDir);
}
// Serve payment proof files from /payment-proofs
app.use('/payment-proofs', express.static(paymentProofsDir));
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // uses timestamp + original name to reduce collisions
    const safeName = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// Storage configuration for payment proofs
const paymentProofStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, paymentProofsDir);
  },
  filename: function (req, file, cb) {
    const safeName = Date.now() + '-proof-' + file.originalname.replace(/\s+/g, '-');
    cb(null, safeName);
  }
});
const uploadProof = multer({ storage: paymentProofStorage });

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// Route 1: Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route 2: Serve registration page
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Route 3: Get all products
app.get('/products', async (req, res) => {
  try {
    // Determines username from query param, header, or cookie (in that order)
    const fromQuery = req.query && req.query.username;
    const fromHeader = req.headers['x-username'];
    const cookies = parseCookies(req.headers.cookie);
    const fromCookie = cookies.username;
    const username = fromQuery || fromHeader || fromCookie || null;
    
    const products = await getAllProducts(username);
    console.log('[products] GET /products for user=', username, 'source=', fromQuery ? 'query' : (fromHeader ? 'header' : 'cookie'), 'returning=', products.length);
    res.json(products);
  } catch (err) {
    console.error('Error loading products:', err);
    res.json([]);
  }
});

// Route 4: Create new product
app.post('/products', upload.single('image'), async (req, res) => {
  try {
    const { title, description, price, stock } = req.body;
    const image = req.file ? req.file.filename : null;
    // determines owner from query param, header, or cookie (prefer query)
    const owner = (req.query && req.query.username) || req.headers['x-username'] || (parseCookies(req.headers.cookie).username) || null;
    const productId = Date.now();
    
    await createProduct(
      productId,
      title || 'Untitled',
      description || '',
      price || '',
      stock || 0,
      image,
      owner
    );
    
    console.log('[products] POST created product id=', productId, 'by=', owner);
    // redirect back to inventory page so user sees the new product
    res.redirect('/inventory.html');
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).send('Server error');
  }
});

// Route 5: Update existing product
app.post('/products/:id', upload.single('image'), async (req, res) => {
  const id = req.params.id;
  try {
    const product = await getProductById(id);
    if (!product) {
      return res.status(404).send('Product not found');
    }

    const { title, description, price, stock } = req.body;
    let newImage = product.image;
    
    if (req.file) {
      // deletes previous image file if it exists
      if (product.image) {
        const oldPath = path.join(uploadsDir, product.image);
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
      }
      newImage = req.file.filename;
    }

    await updateProduct(
      id,
      title !== undefined ? title : product.title,
      description !== undefined ? description : product.description,
      price !== undefined ? price : product.price,
      stock !== undefined ? stock : product.stock,
      newImage
    );
    
    console.log('[products] POST updated product id=', id);
    return res.redirect('/inventory.html');
  } catch (err) {
    console.error('Failed to update product', err);
    return res.status(500).send('Server error');
  }
});

// Route 6: User registration
app.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    // Check if username already exists
    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      return res.send('Username already exists. Please choose another.');
    }
    // Adds a new user
    await createUser(username, password, email);
    // set username cookie so the user is treated as logged in
    res.cookie('username', username, { httpOnly: true });
    console.log('[auth] Registered user=', username, 'set cookie');
    // Redirect to dashboard and include username in query so client can store it
    res.redirect('/dashboard.html?user=' + encodeURIComponent(username));
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).send('Server error');
  }
});

// Route 7: User login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await findUserByUsername(username);
    if (user && user.password === password) {
      // sets username cookie so routes can identify the user
      res.cookie('username', username, { httpOnly: true });
      console.log('[auth] Login user=', username, 'set cookie');
      // Successful login will redirect the user to dashboard and include username as query
      return res.redirect('/dashboard.html?user=' + encodeURIComponent(username));
    }
    // Failed login = user redirects back to login with an error flag
    return res.redirect('/?error=invalid');
  } catch (err) {
    console.error('Login error', err);
    return res.redirect('/?error=server');
  }
});

// Route 8: User logout
app.get('/logout', (req, res) => {
  // clears username cookie
  res.clearCookie('username');
  res.redirect('/');
});

// Route 9: Check current user
app.get('/whoami', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const username = cookies.username || null;
  console.log('[whoami] request cookies=', req.headers.cookie, 'username=', username);
  res.json({ username });
});

// Route 10: Delete product
app.delete('/products/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const product = await getProductById(id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // determines requester username from query param, header, or cookie
    const ownerCandidate = (req.query && req.query.username) || req.headers['x-username'] || (parseCookies(req.headers.cookie).username) || null;
    // if the product has an owner, only that owner may delete it
    if (product.owner && String(product.owner) !== String(ownerCandidate)) {
      console.log('[products] DELETE forbidden id=', id, 'owner=', product.owner, 'requester=', ownerCandidate);
      return res.status(403).json({ error: 'Forbidden' });
    }

    // deletes image from disk if present
    if (product.image) {
      const imgPath = path.join(uploadsDir, product.image);
      try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (e) { /* ignore */ }
    }

    await deleteProduct(id);
    console.log('[products] DELETE id=', id, 'by=', ownerCandidate);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete product', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route 11: Get all transactions
app.get('/transactions', async (req, res) => {
  try {
    const fromQuery = req.query && req.query.username;
    const fromHeader = req.headers['x-username'];
    const cookies = parseCookies(req.headers.cookie);
    const fromCookie = cookies.username;
    const username = fromQuery || fromHeader || fromCookie || null;
    
    const transactions = await getAllTransactions(username);
    console.log('[transactions] GET /transactions for user=', username, 'returning=', transactions.length);
    res.json(transactions);
  } catch (err) {
    console.error('Failed to load transactions', err);
    res.json([]);
  }
});

// Route 12: Upload payment proof
app.post('/upload-payment-proof', uploadProof.single('proof'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    console.log('[payment-proof] Uploaded:', req.file.filename);
    return res.json({ 
      ok: true, 
      filename: req.file.filename,
      path: '/payment-proofs/' + req.file.filename
    });
  } catch (err) {
    console.error('Failed to upload payment proof', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route 13: Create new transaction
app.post('/transactions', async (req, res) => {
  try {
    const { items, paymentMethod, proofUploaded, timestamp } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'No items in transaction' });
    }
    
    const owner = (req.query && req.query.username) || req.headers['x-username'] || (parseCookies(req.headers.cookie).username) || null;
    
    // Calculates total
    const total = items.reduce((sum, item) => sum + (Number(item.qty || 1) * Number(item.price || 0)), 0);
    const itemCount = items.reduce((sum, item) => sum + Number(item.qty || 1), 0);
    
    // Generates sequential sale ID
    const nextId = await getNextTransactionId();
    
    const transactionData = {
      id: nextId,
      owner,
      items,
      total,
      itemCount,
      paymentMethod: paymentMethod || 'CASH',
      proofUploaded: !!proofUploaded,
      proofFilename: req.body.proofFilename || null,
      location: req.body.location || null,
      timestamp: timestamp || new Date().toISOString(),
      date: new Date().toLocaleString('en-US', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    };
    
    const newTransaction = await createTransaction(transactionData);
    console.log('[transactions] POST new transaction id=', newTransaction.id, 'by=', owner, 'total=', total);
    return res.json({ ok: true, transaction: newTransaction });
  } catch (err) {
    console.error('Failed to save transaction', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route 14: Get elevation data
app.get('/api/elevation', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }
    
    const response = await mapsClient.elevation({
      params: {
        locations: [{ lat, lng }],
        key: process.env.MAPS_API_KEY,
      },
      timeout: 1000, // milliseconds
    });
    
    res.json({
      elevation: response.data.results[0].elevation,
      location: response.data.results[0].location
    });
  } catch (error) {
    console.error('Google Maps API error:', error.response?.data?.error_message || error.message);
    res.status(500).json({ 
      error: error.response?.data?.error_message || 'Failed to get elevation data' 
    });
  }
});

// Route 15: Reverse geocode coordinates
app.get('/api/geocode', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }
    
    const response = await mapsClient.reverseGeocode({
      params: {
        latlng: { lat, lng },
        key: process.env.MAPS_API_KEY,
      },
      timeout: 2000, // milliseconds
    });
    
    if (response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      res.json({
        formatted_address: result.formatted_address,
        coordinates: { lat, lng }
      });
    } else {
      res.json({
        formatted_address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        coordinates: { lat, lng }
      });
    }
  } catch (error) {
    console.error('Google Maps geocoding error:', error.response?.data?.error_message || error.message);
    res.status(500).json({ 
      error: error.response?.data?.error_message || 'Failed to get location data' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
