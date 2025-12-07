const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Initialize SQLite database
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Initialize database tables
function initDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);

    // Products table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        price TEXT,
        stock INTEGER DEFAULT 0,
        image TEXT,
        owner TEXT
      )
    `);

    // Transactions table
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY,
        owner TEXT,
        items TEXT NOT NULL,
        total REAL,
        itemCount INTEGER,
        paymentMethod TEXT,
        proofUploaded INTEGER DEFAULT 0,
        proofFilename TEXT,
        location TEXT,
        timestamp TEXT,
        date TEXT
      )
    `);

    console.log('Database initialized successfully');
  });
}

// User operations
function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM users', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function findUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function createUser(username, password, email) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [username, password, email],
      function(err) {
        if (err) reject(err);
        else resolve({ username, password, email });
      }
    );
  });
}

// Product operations
function getAllProducts(owner = null) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM products';
    let params = [];
    
    if (owner) {
      query += ' WHERE owner = ?';
      params.push(owner);
    }
    
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getProductById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function createProduct(id, title, description, price, stock, image, owner) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO products (id, title, description, price, stock, image, owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, title, description, price, stock, image, owner],
      function(err) {
        if (err) reject(err);
        else resolve({ id, title, description, price, stock, image, owner });
      }
    );
  });
}

function updateProduct(id, title, description, price, stock, image) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE products SET title = ?, description = ?, price = ?, stock = ?, image = ? WHERE id = ?',
      [title, description, price, stock, image, id],
      function(err) {
        if (err) reject(err);
        else resolve({ id, title, description, price, stock, image });
      }
    );
  });
}

function deleteProduct(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM products WHERE id = ?', [id], function(err) {
      if (err) reject(err);
      else resolve({ id });
    });
  });
}

// Transaction operations
function getAllTransactions(owner = null) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM transactions';
    let params = [];
    
    if (owner) {
      query += ' WHERE owner = ?';
      params.push(owner);
    }
    
    query += ' ORDER BY id DESC';
    
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else {
        // Parse JSON fields
        const transactions = rows.map(row => ({
          ...row,
          items: JSON.parse(row.items),
          location: row.location ? JSON.parse(row.location) : null,
          proofUploaded: Boolean(row.proofUploaded)
        }));
        resolve(transactions);
      }
    });
  });
}

function getNextTransactionId() {
  return new Promise((resolve, reject) => {
    db.get('SELECT MAX(id) as maxId FROM transactions', [], (err, row) => {
      if (err) reject(err);
      else resolve((row.maxId || 0) + 1);
    });
  });
}

function createTransaction(transactionData) {
  return new Promise((resolve, reject) => {
    const {
      id,
      owner,
      items,
      total,
      itemCount,
      paymentMethod,
      proofUploaded,
      proofFilename,
      location,
      timestamp,
      date
    } = transactionData;

    db.run(
      `INSERT INTO transactions 
       (id, owner, items, total, itemCount, paymentMethod, proofUploaded, proofFilename, location, timestamp, date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        owner,
        JSON.stringify(items),
        total,
        itemCount,
        paymentMethod,
        proofUploaded ? 1 : 0,
        proofFilename,
        location ? JSON.stringify(location) : null,
        timestamp,
        date
      ],
      function(err) {
        if (err) reject(err);
        else resolve({ id, ...transactionData });
      }
    );
  });
}

module.exports = {
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
  createTransaction
};
