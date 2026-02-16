const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const db = require('./db');

const app = express();
const PORT = 3200;

app.use(cors());
app.use(express.json());

// Serve Swagger UI at /docs so users can browse and test the API interactively
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Serve the frontend UI from the public directory
app.use(express.static('public'));

/**
 * @openapi
 * /types:
 *   get:
 *     summary: Get all joke types
 *     description: Returns an array of all unique joke type strings from the database.
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
app.get('/types', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT type FROM types ORDER BY type');
        const types = rows.map(row => row.type);
        res.json(types);
    } catch (err) {
        console.error('Error fetching types:', err.message);
        res.status(500).json({ error: 'Failed to fetch joke types' });
    }
});

/**
 * @openapi
 * /submit:
 *   post:
 *     summary: Submit a new joke
 *     description: >
 *       Adds a new joke to the database. If isNewType is true, the type will
 *       be created first (duplicates are safely ignored via INSERT IGNORE).
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
 *         description: Joke submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 jokeId:
 *                   type: integer
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
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

        // If this is a new type, insert it first (INSERT IGNORE prevents duplicates)
        if (isNewType) {
            await db.query('INSERT IGNORE INTO types (type) VALUES (?)', [type]);
        }

        // Look up the type_id for the given type name
        const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
        if (typeRows.length === 0) {
            return res.status(400).json({ error: `Joke type '${type}' does not exist` });
        }

        const typeId = typeRows[0].id;

        // Insert the joke with parameterised query to prevent SQL injection
        const [result] = await db.query(
            'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
            [setup, punchline, typeId]
        );

        res.status(201).json({
            message: 'Joke submitted successfully!',
            jokeId: result.insertId,
        });
    } catch (err) {
        console.error('Error submitting joke:', err.message);
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

app.listen(PORT, () => {
    console.log(`Submit app running on port ${PORT}`);
    console.log(`Swagger docs available at http://localhost:${PORT}/docs`);
});
