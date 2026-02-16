const swaggerJsdoc = require('swagger-jsdoc');

// OpenAPI 3.0 specification configuration
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Joke Submission API',
            version: '1.0.0',
            description: 'API for submitting new jokes to the joke database',
        },
        servers: [
            {
                url: 'http://localhost:4200',
                description: 'Docker-mapped port',
            },
        ],
    },
    // Look for JSDoc annotations in server.js for endpoint documentation
    apis: ['./server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
