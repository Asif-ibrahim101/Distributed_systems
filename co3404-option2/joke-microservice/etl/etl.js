const amqplib = require('amqplib');
const db = require('./db'); // Resolves to db/index.js

const QUEUE_NAME = 'MODERATED_JOKES';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@10.0.0.5:5672';

/**
 * Retry logic for connecting to RabbitMQ.
 * RabbitMQ may not be ready when the ETL container starts, especially
 * on first boot or cross-VM networking. We retry up to 10 times with
 * a 5-second delay between attempts.
 */
async function connectWithRetry(url, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await amqplib.connect(url);
            console.log('Connected to RabbitMQ');
            return connection;
        } catch (err) {
            console.log(`RabbitMQ not ready, retrying in ${delay / 1000}s... (${i + 1}/${retries})`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    throw new Error('Failed to connect to RabbitMQ after retries');
}

/**
 * Process a single joke message from the queue.
 * Steps: parse → insert type if new → look up type_id → insert joke → ack
 */
async function processMessage(channel, msg) {
    try {
        const data = JSON.parse(msg.content.toString());
        const { setup, punchline, type, isNewType } = data;

        console.log(`Processing joke: "${setup}"`);

        // If this is a new type, insert it (INSERT IGNORE prevents duplicates)
        if (isNewType) {
            await db.query('INSERT IGNORE INTO types (type) VALUES (?)', [type]);
            console.log(`  Inserted new type: "${type}"`);

            // Publish type update event
            const [allTypesRows] = await db.query('SELECT type FROM types ORDER BY type');
            const allTypes = allTypesRows.map(row => row.type);

            const exchange = 'type_update';
            await channel.assertExchange(exchange, 'fanout', { durable: true });
            channel.publish(exchange, '', Buffer.from(JSON.stringify(allTypes)));
            console.log(`  Published type_update event with ${allTypes.length} types`);
        }

        // Look up the type_id for the given type name
        const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
        if (typeRows.length === 0) {
            console.error(`  Type "${type}" not found in database, skipping joke`);
            // Still acknowledge to remove from queue — the type doesn't exist
            channel.ack(msg);
            return;
        }

        const typeId = typeRows[0].id;

        // Insert the joke with parameterised query to prevent SQL injection
        const [result] = await db.query(
            'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
            [setup, punchline, typeId]
        );

        console.log(`  Joke inserted with ID: ${result.insertId}`);

        // Acknowledge the message so RabbitMQ removes it from the queue
        channel.ack(msg);
        console.log(`  Message acknowledged`);
    } catch (err) {
        console.error('Error processing message:', err.message);
        // Don't ack on error — message stays in queue for retry
        // Use nack to requeue after a delay (prevents tight retry loops)
        channel.nack(msg, false, true);
    }
}

/**
 * Main entry point — connects to RabbitMQ and registers the consumer.
 * Any messages already on the queue (queued while ETL was down) will
 * be delivered immediately upon consumer registration.
 */
async function main() {
    console.log('ETL service starting...');
    console.log(`Connecting to RabbitMQ at: ${RABBITMQ_URL.replace(/\/\/.*@/, '//<credentials>@')}`);

    const connection = await connectWithRetry(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Assert the queue exists and is durable (survives broker restarts)
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    console.log(`Waiting for messages on queue: ${QUEUE_NAME}`);

    // Process one message at a time to avoid overwhelming the database
    channel.prefetch(1);

    // Register the consumer callback — this runs for each incoming message
    channel.consume(QUEUE_NAME, (msg) => {
        if (msg !== null) {
            processMessage(channel, msg);
        }
    });

    // Handle connection closure gracefully
    connection.on('close', () => {
        console.error('RabbitMQ connection closed, exiting...');
        process.exit(1);
    });
}