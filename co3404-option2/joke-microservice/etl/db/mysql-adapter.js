const mysql = require('mysql2');

// Connection pool for the ETL service — same pattern as joke-app
// Connects via Docker DNS name "database" since ETL runs on the same
// Docker network as the MySQL container (joke-network on VM1).
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'database',
    user: process.env.DB_USER || 'jokeuser',
    password: process.env.DB_PASSWORD || 'jokepassword',
    database: process.env.DB_NAME || 'jokedb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool.promise();
