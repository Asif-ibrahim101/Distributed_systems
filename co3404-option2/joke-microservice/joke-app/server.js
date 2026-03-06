const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Serve the frontend UI from the public directory
app.use(express.static('public'));

/**
 * GET /types
 * Returns all unique joke types from the database.
 * The frontend calls this every time the dropdown is focused/clicked.
 */
app.get('/types', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT type FROM types ORDER BY type');
        // Return a flat array of type strings for easy dropdown population
        const types = rows.map(row => row.type);
        res.json(types);
    } catch (err) {
        console.error('Error fetching types:', err.message);
        res.status(500).json({ error: 'Failed to fetch joke types' });
    }
});

// Alias for Kong routing — Kong forwards /joke-types → /joke-types on this server
// The frontend uses /joke-types so it works through Kong's reverse proxy
app.get('/joke-types', async (req, res) => {
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
 * GET /joke/:type?count=N
 * Returns random jokes filtered by type.
 * - :type can be a specific type (e.g. "dad") or "any" for all types
 * - ?count is optional; defaults to 1 if not provided
 * - Uses ORDER BY RAND() LIMIT for random selection
 * - Returns fewer jokes if fewer exist than requested
 */
app.get('/joke/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const count = parseInt(req.query.count) || 1;

        let query;
        let params;

        if (type === 'any') {
            // "any" returns random jokes from ALL types
            query = `
        SELECT j.setup, j.punchline, t.type
        FROM jokes j
        JOIN types t ON j.type_id = t.id
        ORDER BY RAND()
        LIMIT ?
      `;
            params = [count];
        } else {
            // Check if the requested type actually exists
            const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
            if (typeRows.length === 0) {
                return res.status(404).json({ error: `Joke type '${type}' not found` });
            }

            // Fetch random jokes of the specified type
            query = `
        SELECT j.setup, j.punchline, t.type
        FROM jokes j
        JOIN types t ON j.type_id = t.id
        WHERE t.type = ?
        ORDER BY RAND()
        LIMIT ?
      `;
            params = [type, count];
        }

        const [jokes] = await db.query(query, params);
        res.json(jokes);
    } catch (err) {
        console.error('Error fetching jokes:', err.message);
        res.status(500).json({ error: 'Failed to fetch jokes' });
    }
});

app.listen(PORT, () => {
    console.log(`Joke app running on port ${PORT}`);
});
