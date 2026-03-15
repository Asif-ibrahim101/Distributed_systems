const express = require('express');
const cors = require('cors');
const amqplib = require('amqplib');

const fs = require('fs');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const app = express();
const PORT = 3200;

const QUEUE_NAME = 'SUBMITTED_JOKES';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';


// Cache file path — stored on a Docker volume so it persists across restarts
const CACHE_FILE = '/data/types-cache.json';

app.use(cors());
app.use(express.json());

// Serve Swagger UI at /docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Serve the frontend UI
app.use(express.static('public'));

// --- RabbitMQ connection management ---

let rabbitChannel = null;

/**
 * Connect to RabbitMQ with retry logic.
 * RabbitMQ may take time to start, so we retry with backoff.
 */
async function connectRabbitMQ(retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await amqplib.connect(RABBITMQ_URL);
            const channel = await connection.createChannel();

            // Assert the queue is durable so messages survive broker restarts
            await channel.assertQueue(QUEUE_NAME, { durable: true });

            console.log('Connected to RabbitMQ');

            // Reconnect if the connection drops
            connection.on('close', () => {
                console.error('RabbitMQ connection closed, reconnecting...');
                rabbitChannel = null;
                setTimeout(() => connectRabbitMQ(retries, delay), delay);
            });

            rabbitChannel = channel;

            // Subscribe to type_update exchange
            const subChannel = await connection.createChannel();
            await subChannel.assertExchange('type_update', 'fanout', { durable: true });
            const q = await subChannel.assertQueue('sub_type_update', { durable: true });
            await subChannel.bindQueue(q.queue, 'type_update', '');

            subChannel.consume(q.queue, (msg) => {
                if (msg) {
                    try {
                        const types = JSON.parse(msg.content.toString());
                        writeCache(types);
                        console.log('Types cache updated via event');
                        subChannel.ack(msg);
                    } catch (err) {
                        console.error('Failed to update types cache:', err);
                        subChannel.nack(msg, false, false);
                    }
                }
            });

            return channel;
        } catch (err) {
            console.log(`RabbitMQ not ready, retrying in ${delay / 1000}s... (${i + 1}/${retries})`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    console.error('Failed to connect to RabbitMQ after retries');
}

// --- Cache helpers ---

/**
 * Write types to a JSON cache file on the Docker volume.
 * This allows /types to return data even when the joke service is unavailable.
 */
function writeCache(types) {
    try {
        // Ensure the /data directory exists (volume mount point)
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(types));
    } catch (err) {
        console.error('Failed to write types cache:', err.message);
    }
}

/**
 * Read types from the cache file.
 * Returns an empty array if the cache doesn't exist or is unreadable.
 */
function readCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Failed to read types cache:', err.message);
    }
    return [];
}

// --- API Endpoints ---

/**
 * @openapi
 * /types:
 *   get:
 *     summary: Get all joke types
 *     description: >
 *       Fetches joke types from the Joke microservice (VM1) via HTTP.
 *       On success, the response is cached to a JSON file on a Docker volume.
 *       If the Joke microservice is unavailable, returns types from cache.
 *     responses:
 *       200:
 *         description: A list of joke types
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["general", "programming", "dad", "knock-knock"]
 *       500:
 *         description: Server error
 */
app.get('/types', (req, res) => {
    try {
        const types = readCache();
        res.json(types);
    } catch (err) {
        console.error('Error reading types cache:', err.message);
        res.status(500).json({ error: 'Failed to fetch joke types' });
    }
});

// Alias for Kong routing — Kong forwards /submit-types → /submit-types on this server
// The frontend uses /submit-types so it works through Kong's reverse proxy
app.get('/submit-types', (req, res) => {
    try {
        const types = readCache();
        res.json(types);
    } catch (err) {
        console.error('Error reading types cache:', err.message);
        res.status(500).json({ error: 'Failed to fetch joke types' });
    }
});

/**
 * @openapi
 * /submit:
 *   post:
 *     summary: Submit a new joke
 *     description: >
 *       Publishes a joke to the RabbitMQ message queue (SUBMITTED_JOKES).
 *       The ETL service on VM1 will consume and insert it into the database.
 *       Messages are persistent and survive broker restarts.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - setup
 *               - punchline
 *               - type
 *             properties:
 *               setup:
 *                 type: string
 *                 example: "Why did the chicken cross the road?"
 *               punchline:
 *                 type: string
 *                 example: "To get to the other side!"
 *               type:
 *                 type: string
 *                 example: "general"
 *               isNewType:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       201:
 *         description: Joke queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required fields
 *       503:
 *         description: RabbitMQ unavailable
 */
app.post('/submit', async (req, res) => {
    try {
        const { setup, punchline, type, isNewType } = req.body;

        // Validate that all required fields are present
        if (!setup || !punchline || !type) {
            return res.status(400).json({
                error: 'Missing required fields. Please provide setup, punchline, and type.',
            });
        }

        // Check that we have a RabbitMQ channel available
        if (!rabbitChannel) {
            return res.status(503).json({
                error: 'Message queue is temporarily unavailable. Please try again shortly.',
            });
        }

        // Publish the joke as a persistent message to the durable queue
        const message = JSON.stringify({ setup, punchline, type, isNewType: !!isNewType });
        rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
            persistent: true, // Message survives broker restart (deliveryMode: 2)
        });

        console.log(`Joke published to queue: "${setup}"`);

        res.status(201).json({
            message: 'Joke submitted successfully! It will appear after processing.',
        });
    } catch (err) {
        console.error('Error publishing joke:', err.message);
        res.status(500).json({ error: 'Failed to submit joke' });
    }
});

/**
 * @openapi
 * /docs:
 *   get:
 *     summary: API Documentation
 *     description: Returns the interactive Swagger UI for this API.
 *     responses:
 *       200:
 *         description: Swagger UI HTML page
 */

// Start the server and connect to RabbitMQ
app.listen(PORT, () => {
    console.log(`Submit app running on port ${PORT}`);
    console.log(`Swagger docs available at http://localhost:${PORT}/docs`);

    // Ensure cache has initial seed values if file is missing completely
    if (readCache().length === 0) {
        writeCache(["general", "programming", "dad", "knock-knock"]);
    }

    // Connect to RabbitMQ in the background (non-blocking)
    connectRabbitMQ();
});
