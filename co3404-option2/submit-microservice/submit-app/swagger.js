const swaggerJsdoc = require('swagger-jsdoc');

// OpenAPI 3.0 specification — updated for microservice architecture
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Joke Submission Microservice API',
            version: '2.0.0',
            description: 'Microservice API for submitting new jokes via RabbitMQ message queue. Jokes are published to a durable queue and asynchronously consumed by the ETL service on VM1.',
        },
        servers: [
            {
                url: `https://${process.env.KONG_IP || 'localhost'}`,
                description: 'Kong API Gateway (HTTPS)',
            },
            {
                url: 'http://localhost:4200',
                description: 'Docker-mapped port (direct/local)',
            },
        ],
    },
    apis: ['./server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
