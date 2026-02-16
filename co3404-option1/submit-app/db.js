const mysql = require('mysql2');

// Create a connection pool instead of a single connection
// Pools handle reconnection automatically and improve performance
// under concurrent requests by reusing idle connections.
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'database', // Docker DNS service name
    user: process.env.DB_USER || 'jokeuser',
    password: process.env.DB_PASSWORD || 'jokepassword',
    database: process.env.DB_NAME || 'jokedb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Export the promise-based pool so we can use async/await in routes
module.exports = pool.promise();
