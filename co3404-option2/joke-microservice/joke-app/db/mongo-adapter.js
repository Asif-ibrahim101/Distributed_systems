const { MongoClient } = require('mongodb');

// Get configuration from environment variables
const dbHost = process.env.DB_HOST || 'mongodb';
const dbName = process.env.DB_NAME || 'jokedb';
const uri = `mongodb://${dbHost}:27017`;

const client = new MongoClient(uri);

let dbConnection = null;

async function getDb() {
    if (dbConnection) return dbConnection;

    try {
        await client.connect();
        dbConnection = client.db(dbName);
        console.log('Connected to MongoDB');
        return dbConnection;
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        throw err;
    }
}

// Emulate simple query method for cross-compatibility with MySQL adapter in our specific use-cases
const adapter = {
    // Simple abstraction over MySQL's db.query() that maps to Mongo operations
    query: async function (queryString, params = []) {
        const db = await getDb();

        // Simulate: 'SELECT type FROM types ORDER BY type'
        if (queryString.includes('SELECT type FROM types')) {
            const types = await db.collection('types').distinct('type');
            types.sort();
            return [types.map(t => ({ type: t }))];
        }

        // Simulate: 'SELECT id FROM types WHERE type = ?'
        if (queryString.includes('SELECT id FROM types')) {
            // In Mongo we don't strictly need IDs for foreign keys in this simple app, 
            // but let's emulate it by checking existence. We'll return the 'type' string as the faux ID to satisfy the structure.
            const typeDoc = await db.collection('types').findOne({ type: params[0] });
            if (typeDoc) {
                return [[{ id: typeDoc.type }]];
            }
            return [[]]; // Emulate empty result set
        }

        // Simulate: 'SELECT j.setup, j.punchline, t.type ... ORDER BY RAND() LIMIT ?'
        if (queryString.includes('SELECT j.setup') && queryString.includes('ORDER BY RAND()')) {
            const isAny = !queryString.includes('WHERE t.type');
            const count = isAny ? params[0] : params[1];

            const pipeline = [];
            if (!isAny) {
                pipeline.push({ $match: { type: params[0] } });
            }
            pipeline.push({ $sample: { size: parseInt(count) || 1 } });
            pipeline.push({ $project: { _id: 0, setup: 1, punchline: 1, type: 1 } });

            const jokes = await db.collection('jokes').aggregate(pipeline).toArray();
            return [jokes];
        }

        // Simulate: 'INSERT IGNORE INTO types (type) VALUES (?)'
        if (queryString.includes('INSERT IGNORE INTO types')) {
            const type = params[0];
            // Mongo 'ignore' equivalent is update with upsert (or check then insert)
            await db.collection('types').updateOne(
                { type: type },
                { $setOnInsert: { type: type } },
                { upsert: true }
            );
            return [true];
        }

        // Simulate: 'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)'
        if (queryString.includes('INSERT INTO jokes')) {
            // params: [setup, punchline, typeId]
            // typeId is the type string in our Mongo emulation
            const joke = {
                setup: params[0],
                punchline: params[1],
                type: params[2]
            };
            const result = await db.collection('jokes').insertOne(joke);
            return [{ insertId: result.insertedId.toString() }];
        }

        throw new Error(`Unimplemented query in MongoDB emulation: ${queryString}`);
    }
};

module.exports = adapter;
