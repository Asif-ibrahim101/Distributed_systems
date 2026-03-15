const express = require('express');
const cors = require('cors');
const amqplib = require('amqplib');
const fs = require('fs');
const path = require('path');
const { auth, requiresAuth } = require('express-openid-connect');

const app = express();
const PORT = 3100;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@10.0.0.8:5672';
const SUBMIT_QUEUE = 'SUBMITTED_JOKES';
const MODERATED_QUEUE = 'MODERATED_JOKES';
const EXCHANGE_NAME = 'type_update';
const MOD_TYPE_QUEUE = 'mod_type_update';
const CACHE_FILE = '/data/types-cache.json';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- OIDC Authentication (Auth0) ---
const authConfig = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH_SECRET,
    baseURL: process.env.BASE_URL || `http://localhost:${PORT}`,
    clientID: process.env.AUTH_CLIENT_ID,
    clientSecret: process.env.AUTH_CLIENT_SECRET,
    issuerBaseURL: process.env.AUTH_ISSUER_URL,
};

app.use(auth(authConfig));

// Custom requiresAuth middleware decorator to handle the mock case
const checkAuth = (req, res, next) => {
    if (!req.oidc.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    next();
};


// --- RabbitMQ Connection Management ---
let rabbitConnection = null;
let consumeChannel = null;
let publishChannel = null;

async function connectRabbitMQ(retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            rabbitConnection = await amqplib.connect(RABBITMQ_URL);

            // Channel for consuming from submit queue (using get)
            consumeChannel = await rabbitConnection.createChannel();
            await consumeChannel.assertQueue(SUBMIT_QUEUE, { durable: true });

            // Channel for publishing to moderated queue
            publishChannel = await rabbitConnection.createChannel();
            await publishChannel.assertQueue(MODERATED_QUEUE, { durable: true });

            // Setup subscriber for type_update exchange
            const subChannel = await rabbitConnection.createChannel();
            await subChannel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
            const q = await subChannel.assertQueue(MOD_TYPE_QUEUE, { durable: true });
            await subChannel.bindQueue(q.queue, EXCHANGE_NAME, '');

            subChannel.consume(q.queue, (msg) => {
                if (msg) {
                    try {
                        const types = JSON.parse(msg.content.toString());
                        writeCache(types);
                        console.log('Types cache updated via event');
                        subChannel.ack(msg);
                    } catch (err) {
                        console.error('Failed to parse type_update message:', err);
                        subChannel.nack(msg, false, false); // discard invalid message
                    }
                }
            });

            console.log('Moderate service connected to RabbitMQ');

            rabbitConnection.on('close', () => {
                console.error('RabbitMQ connection closed, reconnecting...');
                consumeChannel = null;
                publishChannel = null;
                setTimeout(() => connectRabbitMQ(retries, delay), delay);
            });

            return;
        } catch (err) {
            console.log(`RabbitMQ not ready, retrying in ${delay / 1000}s... (${i + 1}/${retries})`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    console.error('Failed to connect to RabbitMQ in Moderate App');
}

// --- Cache Helpers ---
function writeCache(types) {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(types));
    } catch (err) {
        console.error('Failed to write types cache:', err.message);
    }
}

function readCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Failed to read types cache:', err.message);
    }
    return [];
}

// --- API Endpoints ---

// Get auth status for frontend to show login state
app.get('/auth-status', (req, res) => {
    res.json({
        isAuthenticated: req.oidc.isAuthenticated(),
        user: req.oidc.isAuthenticated() ? req.oidc.user : null
    });
});

app.get('/types', (req, res) => {
    res.json(readCache());
});

app.get('/moderate-types', (req, res) => {
    res.json(readCache());
});

app.get('/moderate', async (req, res) => {
    if (!consumeChannel) {
        return res.status(503).json({ available: false, error: 'Queue unavailable' });
    }

    try {
        // Pull exactly one message from the SUBMITTED_JOKES queue
        const msg = await consumeChannel.get(SUBMIT_QUEUE, { noAck: false });

        if (msg) {
            const joke = JSON.parse(msg.content.toString());
            // Attach delivery tag to ack it later on POST /moderated
            res.json({ available: true, joke, deliveryTag: msg.fields.deliveryTag });
        } else {
            res.json({ available: false, message: 'No jokes to moderate' });
        }
    } catch (err) {
        console.error("Error getting joke from queue:", err);
        res.status(500).json({ available: false, error: 'Failed to fetch joke' });
    }
});

app.post('/moderated', checkAuth, async (req, res) => {
    if (!publishChannel || !consumeChannel) {
        return res.status(503).json({ error: 'Queue unavailable' });
    }

    try {
        const { setup, punchline, type, isNewType, action, deliveryTag } = req.body;

        if (action === 'approve') {
            const message = JSON.stringify({ setup, punchline, type, isNewType: !!isNewType });
            publishChannel.sendToQueue(MODERATED_QUEUE, Buffer.from(message), {
                persistent: true
            });
            console.log(`Joke approved and published to moderated queue: "${setup}"`);
        } else if (action === 'reject') {
            console.log(`Joke rejected: "${setup}"`);
            // Message is simply discarded (ack'd below but not forwarded)
        }

        // Acknowledge the original message from the SUBMITTED_JOKES queue
        if (deliveryTag !== undefined) {
            // We can't directly ack by deliveryTag across requests easily with amqplib get.
            // Workaround for stateless HTTP: since we used channel.get(), the message is unacknowledged.
            // We must ack all messages up to this tag, OR we can construct a dummy message object.
            consumeChannel.ack({ fields: { deliveryTag: parseInt(deliveryTag) } });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error handling moderated joke:', err);
        res.status(500).json({ error: 'Failed to process joke' });
    }
});

app.listen(PORT, () => {
    console.log(`Moderate app running on port ${PORT}`);
    connectRabbitMQ();
});
