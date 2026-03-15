const dbType = process.env.DB_TYPE || 'mysql';

if (dbType === 'mongo') {
    module.exports = require('./mongo-adapter');
} else {
    module.exports = require('./mysql-adapter');
}
