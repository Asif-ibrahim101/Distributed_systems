# CO3404 DISTRIBUTED SYSTEMS — DEEP CODE EXPLANATION

> Every file, every line, explained like you wrote it with AI and now need to defend it to your professor.

---

## TABLE OF CONTENTS

- [PART 1: Option 1 (co3404-option1/)](#part-1-option-1)
- [PART 2: Submit App (Option 1 vs Option 2)](#part-2-submit-app)
- [PART 3: ETL Service](#part-3-etl-service)
- [PART 4: Moderate Microservice](#part-4-moderate-microservice)
- [PART 5: Database Abstraction](#part-5-database-abstraction)
- [PART 6: Kong Gateway](#part-6-kong-gateway)
- [PART 7: Terraform](#part-7-terraform)
- [PART 8: Docker Compose Files (Option 2)](#part-8-docker-compose-files)
- [PART 9: Deployment](#part-9-deployment)
- [PART 10: Summary, Interview Cheat Sheet, Concepts](#part-10-summary)

---

<a id="part-1-option-1"></a>
## ═══════════════════════════════════════
## PART 1: OPTION 1 (co3404-option1/)
## ═══════════════════════════════════════

Option 1 is a **monolithic** approach: two Node.js apps (joke-app, submit-app) sharing a single MySQL database, all running on one machine via Docker Compose.

---

### 1.1 docker-compose.yml

**Level 1:** The orchestration file that defines all three containers (database, joke app, submit app) and how they connect.

**Level 2:** Docker Compose reads this file and creates three services on a private bridge network. The MySQL database starts first, runs health checks, and only once healthy do the two Node.js apps start. Both apps share the same database. The `.env` file is automatically read by Docker Compose to fill in `${VARIABLE}` placeholders.

**Level 3:**

```
Line 1: version: '3.8'
```
Declares the Compose file format version. 3.8 supports features like healthchecks and `depends_on` conditions.
WHY: Without a version, Docker Compose may default to an older syntax that doesn't support `condition: service_healthy`.
INTERVIEW TIP: "Version 3.x is the Docker Swarm-compatible format. We use 3.8 for advanced features like health-check-dependent startup."

```
Lines 4-26: database service
```
- `image: mysql:8.0` — Uses the official MySQL 8.0 image from Docker Hub. No build needed because we're using a pre-built image.
- `container_name: joke-database` — Gives the container a fixed human-readable name instead of a generated one (like `co3404-option1-database-1`).
- `environment:` block — Sets MySQL init variables. `MYSQL_ROOT_PASSWORD` sets the root password. `MYSQL_DATABASE` tells MySQL to create this database on first startup. `MYSQL_USER` and `MYSQL_PASSWORD` create a non-root user.
- `ports: "4002:3306"` — Maps host port 4002 to container port 3306 (MySQL's default). Why 4002? To avoid conflicts with any MySQL running on the host. The first number is the host port, the second is the container port.
- `volumes:` — Two volume mounts:
  - `db-data:/var/lib/mysql` — A **named volume** that persists database files across container restarts. Without this, all data would be lost when the container stops.
  - `./db-init:/docker-entrypoint-initdb.d` — A **bind mount** that maps the local `db-init/` directory into MySQL's special init directory. MySQL runs any `.sql` files in this directory **only on the very first startup** (when no database exists yet).
- `healthcheck:` — Runs `mysqladmin ping` every 10 seconds, with a 5-second timeout, up to 5 retries. This tells Docker when MySQL is actually ready to accept connections (not just that the container started).

WHY: Without the healthcheck, the Node.js apps would start before MySQL is ready, causing connection errors and crashes.
CONNECTS TO: Both `joke` and `submit` services depend on this.
INTERVIEW TIP: "The healthcheck uses `mysqladmin ping` which checks if the MySQL process is running and accepting connections. It's different from the container being 'up' — the process might still be initializing."

```
Lines 28-44: joke service
```
- `build: ./joke-app` — Tells Docker to build an image from the Dockerfile in `./joke-app/` directory.
- `ports: "4000:3000"` — Maps host 4000 to container 3000. The app listens on 3000 internally.
- `environment: DB_HOST: database` — The hostname `database` resolves to the MySQL container's IP via **Docker DNS**. Docker's built-in DNS server on the bridge network automatically resolves service names to container IPs.
- `depends_on: database: condition: service_healthy` — Won't start until the database healthcheck passes.
- `restart: unless-stopped` — Container restarts automatically on crash, but not if manually stopped.

WHY: `depends_on` without `condition` only waits for the container to start, NOT for MySQL to be ready. The `condition: service_healthy` is essential.
INTERVIEW TIP: "Docker DNS is a key concept — each container on a bridge network can resolve other containers by their service name. That's why `DB_HOST: database` works."

```
Lines 47-62: submit service
```
Same pattern as joke, but on port 4200:3200. Both services connect to the same database container.

```
Lines 64-71: volumes and networks
```
- `db-data:` — Declares the named volume. Docker manages the actual storage location on the host.
- `joke-network: driver: bridge` — Creates an isolated bridge network. Only containers on this network can communicate. The default Docker bridge network doesn't provide DNS resolution between containers; a custom bridge network does.

INTERVIEW TIP: "Why a custom bridge network? The default Docker bridge doesn't support DNS service discovery. On a custom bridge, containers can reach each other by service name."

---

### 1.2 .env

**Level 1:** Environment variable definitions that Docker Compose automatically reads.

**Level 2:** Contains database credentials used by both docker-compose.yml (for MySQL init) and the Node.js apps (for connecting). Docker Compose reads `.env` in the same directory automatically — you don't need to specify `env_file` for this.

```
DB_ROOT_PASSWORD=rootpassword    — MySQL root password
DB_NAME=jokedb                   — Database name to create and connect to
DB_USER=jokeuser                 — Non-root user for app connections
DB_PASSWORD=jokepassword         — Password for the non-root user
```

WHY use .env instead of hardcoding?
1. **Security** — Keeps credentials out of version-controlled files (though in this project `.env` IS committed for convenience)
2. **Flexibility** — Change one file to update all services
3. **Docker Compose native** — `.env` is auto-loaded without extra configuration

INTERVIEW TIP: "In production, you'd use Docker secrets or a vault service. The `.env` file is convenient for development but should be `.gitignore`'d in real projects."

---

### 1.3 db-init/init.sql

**Level 1:** SQL seed script that creates the database schema and populates it with initial data.

**Level 2:** MySQL runs this file **only on the first container creation** — when the named volume `db-data` is empty. If you restart the container, this file does NOT run again. To re-run it, you must delete the volume (`docker volume rm co3404-option1_db-data`).

**Level 3:**

```sql
Lines 1-5: CREATE TABLE types
```
- `IF NOT EXISTS` — Prevents errors if the table already exists (defensive programming).
- `INT AUTO_INCREMENT PRIMARY KEY` — Auto-generates unique IDs starting from 1, incrementing by 1.
- `VARCHAR(50) NOT NULL UNIQUE` — Type name: max 50 characters, can't be null, can't be duplicated.

WHY UNIQUE? Prevents duplicate types (e.g., two "dad" entries). This constraint is what makes `INSERT IGNORE` work later — the insert fails silently on duplicate.
CONNECTS TO: joke-app/server.js queries this table; etl.js inserts into it.
INTERVIEW TIP: "UNIQUE creates an index that enforces no duplicates. INSERT IGNORE checks this constraint and silently skips the insert if it would violate it."

```sql
Lines 7-13: CREATE TABLE jokes
```
- `setup TEXT NOT NULL` — TEXT type allows longer strings than VARCHAR (up to 65,535 bytes).
- `type_id INT NOT NULL` — Foreign key column linking each joke to a type.
- `FOREIGN KEY (type_id) REFERENCES types(id)` — **Referential integrity** constraint. You can't insert a joke with a `type_id` that doesn't exist in the `types` table. You also can't delete a type that has jokes referencing it.

WHY a foreign key instead of storing the type name directly?
1. **Normalisation** — Avoids storing "programming" thousands of times (saves space, prevents typos)
2. **Integrity** — The database enforces that every joke has a valid type
3. **Updates** — If you rename a type, you only change it in one place

INTERVIEW TIP: "This is a normalised schema — Third Normal Form (3NF). The types table eliminates the transitive dependency of joke → type name."

```sql
Lines 16-54: INSERT seed data
```
- 4 types: general, programming, dad, knock-knock
- 5 jokes per type = 20 jokes total
- `type_id = 1` corresponds to 'general' because it was inserted first with AUTO_INCREMENT
- Escaped single quotes: `''` (two single quotes = one literal single quote in SQL)

WHY 5 per type? So `ORDER BY RAND() LIMIT 1` actually returns different jokes on different requests. With only 1-2 jokes, randomness is meaningless.

---

### 1.4 joke-app/Dockerfile

**Level 1:** Build instructions for creating the joke app's Docker image.

**Level 2:** Uses multi-step build optimised for Docker layer caching. Copies package.json first, installs dependencies, then copies source code. This way, changing source code doesn't re-install dependencies.

```dockerfile
Line 1: FROM node:18-alpine
```
Base image: Node.js 18 on Alpine Linux. Alpine is a minimal Linux distribution (~5MB vs ~100MB for Debian-based). This makes the image smaller and faster to build/pull.

WHY node:18 specifically? LTS (Long Term Support) version — stable and maintained. Alpine reduces image size dramatically.

```dockerfile
Line 3: WORKDIR /app
```
Sets the working directory inside the container. All subsequent commands run from `/app`. Also creates the directory if it doesn't exist.

```dockerfile
Lines 5-7: COPY package*.json ./ then RUN npm install
```
**This is the layer caching optimisation.** Docker builds images in layers. If a layer hasn't changed, Docker uses the cached version. By copying only package.json first and running `npm install`, this layer is cached until package.json changes. If you only change server.js, npm install doesn't re-run.

WHY `package*.json`? The `*` glob matches both `package.json` and `package-lock.json`.

```dockerfile
Line 9: COPY . .
```
Copies ALL remaining source files. This layer changes whenever any source file changes, but npm install is already done.

```dockerfile
Line 11: EXPOSE 3000
```
**Documentation only** — tells humans and tools that this container listens on port 3000. It does NOT actually publish the port. That's done by `ports:` in docker-compose.yml.

INTERVIEW TIP: "EXPOSE is metadata, not functionality. The actual port mapping happens in docker-compose.yml with `ports: '4000:3000'`."

```dockerfile
Line 13: CMD ["node", "server.js"]
```
The command that runs when the container starts. Uses exec form (JSON array) instead of shell form for better signal handling.

---

### 1.5 joke-app/package.json

**Level 1:** Node.js project manifest listing dependencies and metadata.

```json
"dependencies": {
    "express": "^4.18.2",    — Web framework for HTTP routes
    "mysql2": "^3.6.0",      — MySQL client with Promise support
    "cors": "^2.8.5"         — Cross-Origin Resource Sharing middleware
}
```

WHY `mysql2` instead of `mysql`?
- `mysql2` supports Promises/async-await natively (via `.promise()`)
- `mysql` only supports callbacks, making code harder to read
- `mysql2` is faster and has better prepared statement support

WHY `cors`? When the frontend (served from one origin) makes API calls to a different origin, browsers block the request by default (Same-Origin Policy). CORS headers tell the browser "this cross-origin request is allowed." In this project, CORS is needed when testing locally or when the frontend is served through Kong on a different port/domain.

---

### 1.6 joke-app/db.js

**Level 1:** Database connection module that creates and exports a MySQL connection pool.

**Level 2:** Instead of opening a new database connection for every HTTP request (slow, resource-heavy), this creates a **pool** of reusable connections. When a route handler calls `db.query()`, it borrows a connection from the pool, uses it, then returns it.

```javascript
Lines 1-14: Connection pool creation
```
- `host: process.env.DB_HOST || 'database'` — Reads from environment variable, falls back to Docker service name `database`. Docker DNS resolves this to the MySQL container's IP on the bridge network.
- `waitForConnections: true` — If all 10 connections are busy, new requests WAIT in a queue instead of failing immediately.
- `connectionLimit: 10` — Maximum 10 simultaneous connections. MySQL has its own limit (default 151), so 10 is conservative but sufficient.
- `queueLimit: 0` — No limit on the waiting queue size. `0` means unlimited.

```javascript
Line 17: module.exports = pool.promise();
```
`.promise()` wraps the pool in a Promise-based interface so we can use `async/await` instead of callbacks.

WHY a pool?
1. **Performance** — Creating a TCP connection + MySQL handshake takes ~10-50ms. Reusing connections avoids this overhead.
2. **Reliability** — Pools handle dropped connections automatically (reconnect on next use).
3. **Concurrency** — Multiple requests can run queries simultaneously using different connections.

INTERVIEW TIP: "A connection pool is like a car rental company. Instead of buying a new car for each trip, you borrow one, use it, and return it. The pool manages the lifecycle."

---

### 1.7 joke-app/server.js

**Level 1:** Express.js web server that serves the joke frontend and provides API endpoints.

**Level 2:** Sets up an Express app with CORS, JSON parsing, and static file serving. Has two API routes: GET /types (returns all joke categories) and GET /joke/:type (returns random jokes filtered by type). The server listens on port 3000 inside the container.

```javascript
Lines 1-12: Setup
```
- `app.use(cors())` — Adds `Access-Control-Allow-Origin: *` header to all responses. This tells browsers "any origin can call my API."
- `app.use(express.json())` — Parses incoming JSON request bodies. Without this, `req.body` is `undefined` for POST requests with JSON.
- `app.use(express.static('public'))` — Serves files from the `public/` directory. When you visit `http://localhost:4000/`, Express serves `public/index.html`. When the HTML requests `script.js`, Express serves `public/script.js`.

```javascript
Lines 19-29: GET /types
```
```javascript
const [rows] = await db.query('SELECT type FROM types ORDER BY type');
const types = rows.map(row => row.type);
res.json(types);
```
- `db.query()` returns `[rows, fields]` — we destructure to get just `rows`.
- `rows` is an array of objects: `[{type: 'dad'}, {type: 'general'}, ...]`
- `.map(row => row.type)` transforms it to a flat array: `['dad', 'general', ...]`
- `ORDER BY type` sorts alphabetically.

WHY a flat array instead of objects? The frontend dropdown just needs strings, not objects. Simpler to work with.

CONNECTS TO: joke-app/public/script.js calls `fetch('/types')` to populate the dropdown.

```javascript
Lines 39-82: GET /joke/:type
```
- `:type` is a **path parameter** — Express extracts it from the URL. `/joke/dad` → `req.params.type = 'dad'`.
- `?count=N` is a **query parameter** — accessed via `req.query.count`. `/joke/dad?count=3` → `req.query.count = '3'`.
- `parseInt(req.query.count) || 1` — Parses the string to integer, defaults to 1 if missing/invalid.

```javascript
if (type === 'any') {
    query = `SELECT j.setup, j.punchline, t.type FROM jokes j
             JOIN types t ON j.type_id = t.id ORDER BY RAND() LIMIT ?`;
    params = [count];
}
```
- `JOIN types t ON j.type_id = t.id` — SQL JOIN combines the jokes and types tables, matching each joke to its type name.
- `ORDER BY RAND()` — MySQL generates a random number for each row and sorts by it. This gives random selection.
- `LIMIT ?` — The `?` is a **parameterised query placeholder**. `mysql2` safely substitutes the value, preventing SQL injection.

WHY parameterised queries? If you used string concatenation (`LIMIT ${count}`), an attacker could inject SQL: `count=1; DROP TABLE jokes;--`. The `?` placeholder ensures the value is always treated as data, never as SQL code.

WHY `ORDER BY RAND()`? It's the simplest way to get random rows. For very large tables it's slow (scans entire table), but for 20 jokes it's fine.

```javascript
const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
if (typeRows.length === 0) {
    return res.status(404).json({ error: `Joke type '${type}' not found` });
}
```
First checks if the type exists. If someone requests `/joke/banana`, they get a 404 instead of an empty array (better UX).

INTERVIEW TIP: "Why do we check the type exists before querying jokes? It provides a clear 404 error message. Without it, an invalid type would return an empty array, and the user wouldn't know if the type doesn't exist or just has no jokes yet."

---

### 1.8 joke-app/public/script.js

**Level 1:** Frontend JavaScript that handles joke type dropdown population and joke fetching with a delayed punchline reveal.

**Level 2:** On page load, fetches all joke types and populates the dropdown. When "Get Joke" is clicked, fetches a random joke, shows the setup immediately, then reveals the punchline after 3 seconds using `setTimeout`. The types are re-fetched every time the dropdown is clicked/focused to catch newly added types from the submit app.

```javascript
Lines 12-36: loadTypes()
```
- `fetch('/types')` — Makes an HTTP GET request to the Express server. Since the JS is served from the same origin, no CORS issues.
- Preserves current selection: stores `typeSelect.value` before rebuilding, restores it after if the option still exists. Without this, switching from "dad" to re-populated dropdown would reset to "any".
- Always adds "any" as the first option manually (it's not in the database).
- `type.charAt(0).toUpperCase() + type.slice(1)` — Capitalises first letter for display: "dad" → "Dad".

```javascript
Lines 42-81: getJoke()
```
- `fetch(`/joke/${type}`)` — Template literal builds the URL dynamically.
- Shows setup immediately by setting `jokeSetup.textContent`.
- Uses `setTimeout(() => {...}, 3000)` — After 3000ms (3 seconds), the callback removes the `hidden` class from the punchline paragraph, making it appear.

WHY the 3-second delay? Comedic effect — gives the user time to read the setup and think about the answer before revealing the punchline.

```javascript
Lines 84-91: Event listeners
```
- `typeSelect.addEventListener('focus', loadTypes)` — Re-fetches types whenever user focuses the dropdown. This catches types added by the submit app without requiring a page refresh.
- `loadTypes()` at the end — Initial load on page open.

INTERVIEW TIP: "Why re-fetch types on focus/click instead of just once? Because the submit app running on another port can add new types at any time. Re-fetching keeps the dropdown current without WebSocket complexity."

---

### 1.9 joke-app/public/index.html

**Level 1:** Simple HTML page with a dropdown, button, and joke display area.

- `<select id="type-select">` — Dropdown, populated dynamically by script.js.
- `<div id="joke-display" class="hidden">` — Joke container, hidden initially until a joke is fetched.
- `<p id="joke-punchline" class="joke-punchline hidden">` — Punchline paragraph, hidden until 3-second delay passes.
- `<script src="script.js">` — Loads at the end of body so DOM elements exist when the script runs.

---

### 1.10 joke-app/public/style.css

**Level 1:** Modern CSS with CSS variables, flexbox, and a fadeIn animation.

- CSS custom properties (variables) in `:root` for consistent theming.
- `@keyframes fadeIn` — Animation that fades in and slides up. Applied to `.joke-punchline` when the `hidden` class is removed.
- `.hidden { display: none !important; }` — Utility class toggled by JavaScript. `!important` ensures it overrides any other display rules.
- Responsive: `@media (min-width: 640px)` switches controls from column to row layout.

---

<a id="part-2-submit-app"></a>
## ═══════════════════════════════════════
## PART 2: SUBMIT APP
## ═══════════════════════════════════════

### 2.1 submit-app/server.js — OPTION 1 VERSION

**Level 1:** Express server that lets users submit new jokes directly to MySQL.

**Level 2:** In Option 1, the submit app connects directly to the same MySQL database as the joke app. It validates input, optionally creates new joke types, looks up the type_id, and inserts the joke. It also has Swagger API documentation.

```javascript
Lines 13-14: Swagger setup
```
- `app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))` — Mounts the Swagger UI at `/docs`. Three middleware functions in chain: `serve` serves static Swagger assets, `setup` configures it with our API spec.

```javascript
Lines 97-135: POST /submit
```
```javascript
const { setup, punchline, type, isNewType } = req.body;
```
Destructures the JSON body. `isNewType` is a boolean flag from the frontend checkbox.

```javascript
if (isNewType) {
    await db.query('INSERT IGNORE INTO types (type) VALUES (?)', [type]);
}
```
`INSERT IGNORE` attempts to insert the type. If it already exists (violates UNIQUE constraint), it silently does nothing instead of throwing an error. This is idempotent — safe to call multiple times with the same value.

WHY INSERT IGNORE instead of checking first? It's atomic — no race condition. If two users submit the same new type simultaneously, `INSERT IGNORE` handles it safely. A "check then insert" pattern could fail under concurrency.

```javascript
const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
```
Looks up the `type_id` after the potential insert. Even if `INSERT IGNORE` did nothing (type already existed), this query still finds it.

```javascript
const [result] = await db.query('INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
    [setup, punchline, typeId]);
res.status(201).json({ message: 'Joke submitted successfully!', jokeId: result.insertId });
```
- `result.insertId` — MySQL returns the AUTO_INCREMENT id of the newly inserted row.
- `201` — HTTP Created status code.

CONNECTS TO: submit-app/public/script.js sends POST requests here.
INTERVIEW TIP: "Why 201 instead of 200? HTTP 201 means 'Created' — semantically correct for a POST that creates a new resource."

---

### 2.2 submit-app/server.js — OPTION 2 VERSION

**Level 1:** Microservice version that publishes jokes to RabbitMQ instead of writing directly to the database.

**Level 2:** The key difference from Option 1: this app has NO database connection. Instead, it publishes joke messages to a RabbitMQ queue (`SUBMITTED_JOKES`). It also subscribes to a `type_update` fanout exchange to keep a local file cache of joke types. Types are served from this cache file instead of querying the database.

```javascript
Lines 13-18: Constants
```
- `QUEUE_NAME = 'SUBMITTED_JOKES'` — The queue where submitted jokes go. The moderate service will pull from this queue.
- `CACHE_FILE = '/data/types-cache.json'` — File on a Docker volume. Using a volume mount (`/data`) means the cache persists across container restarts.

```javascript
Lines 37-84: connectRabbitMQ()
```
```javascript
async function connectRabbitMQ(retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await amqplib.connect(RABBITMQ_URL);
            const channel = await connection.createChannel();
            await channel.assertQueue(QUEUE_NAME, { durable: true });
```
- **Retry logic**: RabbitMQ may not be ready when the app starts (especially on fresh deployment). Tries 10 times with 5-second gaps.
- `assertQueue(QUEUE_NAME, { durable: true })` — Creates the queue if it doesn't exist, or verifies it exists with the correct settings. **Durable** means the queue definition survives RabbitMQ restarts (the queue itself persists, but messages only persist if also marked `persistent`).

```javascript
            connection.on('close', () => {
                rabbitChannel = null;
                setTimeout(() => connectRabbitMQ(retries, delay), delay);
            });
```
Auto-reconnection: if the connection drops, retry after `delay` ms.

```javascript
            // Subscribe to type_update exchange
            const subChannel = await connection.createChannel();
            await subChannel.assertExchange('type_update', 'fanout', { durable: true });
            const q = await subChannel.assertQueue('sub_type_update', { durable: true });
            await subChannel.bindQueue(q.queue, 'type_update', '');
```
- Creates a SECOND channel for subscribing (best practice: separate channels for publishing and consuming).
- `assertExchange('type_update', 'fanout', ...)` — Creates/verifies a **fanout exchange**. A fanout exchange broadcasts messages to ALL bound queues (like a radio broadcast — everyone subscribed receives it).
- `assertQueue('sub_type_update', ...)` — Creates a named queue specific to the submit app for receiving type updates.
- `bindQueue(q.queue, 'type_update', '')` — Binds this queue to the fanout exchange. The empty routing key `''` is required but ignored by fanout exchanges.

```javascript
            subChannel.consume(q.queue, (msg) => {
                if (msg) {
                    const types = JSON.parse(msg.content.toString());
                    writeCache(types);
                    subChannel.ack(msg);
                }
            });
```
When a type_update event arrives (published by the ETL when it inserts a new type), this callback writes the updated types list to the cache file.

INTERVIEW TIP: "Why a fanout exchange instead of a direct queue? Because multiple services need the same update — both the submit app and moderate app need to know about new types. A fanout exchange broadcasts to all subscribers without the publisher needing to know who's listening."

```javascript
Lines 92-119: Cache helpers
```
- `writeCache(types)` — Creates `/data` directory if needed, writes JSON array to file.
- `readCache()` — Reads and parses the file, returns `[]` if file doesn't exist.

WHY file-based cache? The submit app can't query the database (it's on a different VM with no direct DB connection). The cache provides type data even when other services are down.

```javascript
Lines 145-153: GET /types
```
Simply reads from cache. No database query. No network call.

```javascript
Lines 177-185: GET /submit-types
```
Kong alias — same function, different path. When the frontend is accessed through Kong at `/submit-app/`, the fetch to `/submit-types` goes through Kong, which routes it here.

```javascript
Lines 234-267: POST /submit
```
```javascript
if (!rabbitChannel) {
    return res.status(503).json({ error: 'Message queue is temporarily unavailable.' });
}
```
503 (Service Unavailable) if RabbitMQ connection isn't established yet.

```javascript
const message = JSON.stringify({ setup, punchline, type, isNewType: !!isNewType });
rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
    persistent: true,
});
```
- `!!isNewType` — Double negation converts any truthy/falsy value to a strict boolean (`undefined` → `false`, `'yes'` → `true`).
- `Buffer.from(message)` — RabbitMQ requires binary data (Buffer), not strings.
- `persistent: true` — Sets `deliveryMode: 2`. The message is written to disk, not just memory. If RabbitMQ restarts, persistent messages in durable queues are recovered.

INTERVIEW TIP: "For messages to truly survive a broker restart, you need BOTH a durable queue AND persistent messages. Durable queue = the queue definition persists. Persistent message = the message content persists."

```javascript
Lines 280-292: Startup
```
```javascript
if (readCache().length === 0) {
    writeCache(["general", "programming", "dad", "knock-knock"]);
}
connectRabbitMQ();
```
Seeds the cache with default types if empty (first boot). Connects to RabbitMQ in the background — the server starts accepting HTTP requests immediately, even before RabbitMQ connects.

---

### 2.3 submit-app/swagger.js

**Level 1:** Configuration for auto-generating OpenAPI documentation from JSDoc comments.

```javascript
const options = {
    definition: {
        openapi: '3.0.0',
        info: { title: 'Joke Submission API', version: '1.0.0', ... },
        servers: [{ url: 'http://localhost:4200' }],
    },
    apis: ['./server.js'],  // Scan this file for @openapi annotations
};
```

- `swagger-jsdoc` scans `server.js` for `@openapi` JSDoc blocks (the big comment blocks above each route).
- These annotations define request/response schemas in OpenAPI format.
- `swagger-ui-express` renders the spec as an interactive HTML page at `/docs`.

INTERVIEW TIP: "Swagger/OpenAPI provides machine-readable API documentation. It generates a 'try it out' interface so you can test endpoints without Postman or curl."

---

### 2.4 submit-app/public/script.js

**Level 1:** Frontend JavaScript for the joke submission form.

```javascript
Lines 42-52: New type toggle
```
When the "Add a new type" checkbox is checked, hides the dropdown and shows a text input. When unchecked, reverses this. The `isNewType` flag is sent to the server so it knows to insert the type.

```javascript
Lines 57-95: Form submission
```
- `e.preventDefault()` — Stops the browser from doing a normal form submit (which would reload the page).
- Client-side validation checks all fields are filled before sending.
- On success: resets form, hides new-type input, reloads types dropdown.
- On error: shows error message (never auto-hides error messages, only success).

```javascript
Lines 100-108: showFeedback()
```
- Sets the text and CSS class (`success` or `error`).
- Success messages auto-hide after 5 seconds via `setTimeout`.
- Error messages stay visible until next action.

---

### 2.5 submit-app/Dockerfile + package.json (Option 2 differences)

**Option 1 package.json dependencies:**
```
express, mysql2, cors, swagger-jsdoc, swagger-ui-express
```

**Option 2 package.json dependencies:**
```
express, amqplib, cors, swagger-jsdoc, swagger-ui-express
```

Key change: `mysql2` is replaced by `amqplib`. The submit app no longer talks to MySQL — it talks to RabbitMQ. This is the core of the microservice decomposition: each service communicates via message queue, not shared database.

---

<a id="part-3-etl-service"></a>
## ═══════════════════════════════════════
## PART 3: ETL SERVICE
## ═══════════════════════════════════════

### 3.1 etl/etl.js — CRITICAL FILE

**Level 1:** Background worker that consumes approved jokes from RabbitMQ and writes them to the database.

**Level 2:** ETL stands for Extract-Transform-Load. This service connects to RabbitMQ, subscribes to the `MODERATED_JOKES` queue using push-based consumption, and processes one message at a time. For each message: parse the JSON → insert the joke type if new → publish a type_update event to the fanout exchange → look up the type_id → insert the joke → acknowledge the message. If processing fails, the message is rejected and requeued.

```javascript
Lines 4-5: Constants
```
```javascript
const QUEUE_NAME = 'MODERATED_JOKES';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@10.0.0.5:5672';
```
This queue receives jokes that have been approved by the moderator. The ETL is the ONLY consumer of this queue.

```javascript
Lines 13-25: connectWithRetry()
```
```javascript
async function connectWithRetry(url, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await amqplib.connect(url);
            return connection;
        } catch (err) {
            await new Promise(res => setTimeout(res, delay));
        }
    }
    throw new Error('Failed to connect to RabbitMQ after retries');
}
```
Simple retry loop. `new Promise(res => setTimeout(res, delay))` is the async/await way to "sleep".

WHY retry? In a distributed system, services start in unpredictable order. RabbitMQ might not be ready when the ETL container starts. The retry loop gives RabbitMQ time to boot.

INTERVIEW TIP: "This is a common pattern in microservices called 'retry with backoff'. A more sophisticated version would use exponential backoff (doubling the delay each time)."

```javascript
Lines 31-81: processMessage() — THE CORE LOGIC
```

**Step 1: Parse the message**
```javascript
const data = JSON.parse(msg.content.toString());
const { setup, punchline, type, isNewType } = data;
```
`msg.content` is a Buffer. `.toString()` converts to string, `JSON.parse()` converts to object.

**Step 2: Insert type if new**
```javascript
if (isNewType) {
    await db.query('INSERT IGNORE INTO types (type) VALUES (?)', [type]);
```
`INSERT IGNORE` — If the type already exists, silently do nothing. If it's new, insert it.

WHY INSERT IGNORE here too? Even though the moderator may have changed the type, this is a safety net. In a distributed system, you can't guarantee the type doesn't already exist.

**Step 3: Publish type_update event**
```javascript
    const [allTypesRows] = await db.query('SELECT type FROM types ORDER BY type');
    const allTypes = allTypesRows.map(row => row.type);
    const exchange = 'type_update';
    await channel.assertExchange(exchange, 'fanout', { durable: true });
    channel.publish(exchange, '', Buffer.from(JSON.stringify(allTypes)));
```
After inserting a new type, queries ALL types from the database and broadcasts the complete list to the `type_update` fanout exchange. All subscribers (submit app, moderate app) receive this and update their caches.

WHY send the full list instead of just the new type? Simpler for subscribers — they replace their entire cache instead of doing incremental updates. No need to handle ordering or deduplication.

CONNECTS TO: submit-app/server.js and moderate-microservice/server.js subscribe to this exchange.

**Step 4: Look up type_id**
```javascript
const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
if (typeRows.length === 0) {
    channel.ack(msg);  // Remove from queue — can't process
    return;
}
const typeId = typeRows[0].id;
```
Gets the numeric ID to use as the foreign key. If type doesn't exist (edge case), acknowledges the message anyway to prevent it from blocking the queue forever.

**Step 5: Insert the joke**
```javascript
const [result] = await db.query(
    'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
    [setup, punchline, typeId]
);
```

**Step 6: Acknowledge**
```javascript
channel.ack(msg);
```
`ack` (acknowledge) tells RabbitMQ "I've successfully processed this message, you can delete it from the queue." Without ack, RabbitMQ keeps the message and will redeliver it when the consumer reconnects.

**Step 7: Error handling**
```javascript
} catch (err) {
    channel.nack(msg, false, true);
}
```
`nack(msg, false, true)`:
- `msg` — the message to reject
- `false` — don't apply to multiple messages (just this one)
- `true` — **requeue** the message. It goes back to the queue and will be retried.

INTERVIEW TIP: "What happens if the ETL crashes mid-processing? Because we only ack AFTER successful insertion, the unacknowledged message stays in the queue. When the ETL restarts, it will receive and process the message again. This is 'at-least-once delivery.'"

```javascript
Lines 88-119: main() — Consumer registration
```
```javascript
await channel.assertQueue(QUEUE_NAME, { durable: true });
channel.prefetch(1);
channel.consume(QUEUE_NAME, (msg) => {
    if (msg !== null) {
        processMessage(channel, msg);
    }
});
```

- `channel.prefetch(1)` — **Critical for backpressure.** Tells RabbitMQ "only send me 1 unacknowledged message at a time." Without this, RabbitMQ would flood the consumer with all queued messages. With prefetch(1), the next message is only delivered after the current one is acknowledged.
- `channel.consume()` — **Push-based** consumption. RabbitMQ pushes messages to the callback function as they arrive. This is different from `channel.get()` used in the moderate service (pull-based).

WHY push-based here? The ETL is a background worker that should process messages continuously as they arrive. Push-based is more efficient — no polling overhead, lower latency.

```javascript
connection.on('close', () => {
    process.exit(1);
});
```
If the RabbitMQ connection closes, exit the process. Docker's `restart: unless-stopped` will restart the container, which will reconnect.

INTERVIEW TIP: "Why does the ETL exit on connection close instead of reconnecting? Because the `channel.consume()` callback is tied to the connection. A new connection needs a new consumer registration. It's simpler to restart the whole process."

---

### 3.2 etl/db/ directory

Same factory pattern as joke-app/db/ (see Part 5). `index.js` reads `DB_TYPE` env var, loads either `mysql-adapter.js` or `mongo-adapter.js`.

---

<a id="part-4-moderate-microservice"></a>
## ═══════════════════════════════════════
## PART 4: MODERATE MICROSERVICE
## ═══════════════════════════════════════

### 4.1 moderate-microservice/server.js — DEEP DIVE

**Level 1:** Authentication-protected moderation interface that sits between the submit and ETL services in the message pipeline.

**Level 2:** Jokes flow: Submit → SUBMITTED_JOKES queue → **Moderate** → MODERATED_JOKES queue → ETL → Database. The moderator can edit, approve, or reject jokes. Uses Auth0 OIDC for authentication. Uses pull-based message consumption (channel.get instead of channel.consume) so each HTTP request pulls exactly one joke.

```javascript
Lines 6, 23-34: OIDC Authentication Setup
```
```javascript
const { auth, requiresAuth } = require('express-openid-connect');

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
```

- `express-openid-connect` is Auth0's Express SDK implementing **OpenID Connect (OIDC)** — an identity layer on top of OAuth 2.0.
- `authRequired: false` — Does NOT require login for all routes. This means the page loads for everyone, but individual routes can check `req.oidc.isAuthenticated()`.
- `auth0Logout: true` — When logging out, also logs out of Auth0 (not just the local session).
- `secret` — Used to encrypt the session cookie. Must be a long random string.
- `baseURL` — Where Auth0 redirects after login. In production, this is the Kong public IP.
- `clientID`, `clientSecret`, `issuerBaseURL` — Auth0 application credentials.

INTERVIEW TIP: "OIDC is an authentication protocol built on OAuth 2.0. OAuth handles authorisation (what can you access?), OIDC adds authentication (who are you?). Auth0 is a managed OIDC provider — we don't implement the protocol ourselves."

```javascript
Lines 36-41: Custom auth middleware
```
```javascript
const checkAuth = (req, res, next) => {
    if (!req.oidc.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    next();
};
```
Returns 401 JSON response instead of redirecting to login page. Used for API endpoints that the frontend calls via fetch (AJAX requests shouldn't redirect to HTML pages).

```javascript
Lines 44-98: RabbitMQ Connection
```
Creates THREE channels:
1. `consumeChannel` — For pulling messages from SUBMITTED_JOKES (using `get()`)
2. `publishChannel` — For publishing approved jokes to MODERATED_JOKES
3. `subChannel` — For subscribing to `type_update` fanout exchange

WHY three channels? RabbitMQ best practice: separate channels for different concerns. A blocked publish channel shouldn't affect consumption, and vice versa.

```javascript
Lines 140-160: GET /moderate — PULL-BASED CONSUMPTION
```
```javascript
const msg = await consumeChannel.get(SUBMIT_QUEUE, { noAck: false });
```

**`channel.get()` vs `channel.consume()`** — This is the most important architectural decision in this service.

- `channel.consume()` (used in ETL) = **push-based**. RabbitMQ pushes messages to a callback. Good for background workers that process continuously.
- `channel.get()` (used here) = **pull-based**. The application explicitly asks for one message. Good for request/response patterns.

WHY pull-based for moderation? The moderator is a human using a web UI. They need to see one joke at a time, decide on it, then get the next one. If we used `consume()`, messages would pile up in memory as they arrive faster than a human can review them.

- `{ noAck: false }` — We will manually acknowledge later (in the POST /moderated endpoint). If we used `noAck: true`, the message would be removed from the queue immediately, and if the moderator closes the browser, the joke would be lost.

```javascript
if (msg) {
    const joke = JSON.parse(msg.content.toString());
    res.json({ available: true, joke, deliveryTag: msg.fields.deliveryTag });
}
```
- `msg.fields.deliveryTag` — A unique integer that identifies this specific message delivery. We send it to the frontend so it can be sent back in the POST request to acknowledge the correct message.

INTERVIEW TIP: "Why channel.get() instead of channel.consume() for moderation? Because moderation is human-paced. With consume(), all queued jokes would be delivered immediately — if the service crashes, those unacknowledged messages would need to be redelivered. With get(), we only pull one at a time, keeping the queue as the source of truth."

```javascript
Lines 162-194: POST /moderated — APPROVE OR REJECT
```
```javascript
app.post('/moderated', checkAuth, async (req, res) => {
```
`checkAuth` middleware runs before the handler — requires OIDC authentication.

```javascript
if (action === 'approve') {
    const message = JSON.stringify({ setup, punchline, type, isNewType: !!isNewType });
    publishChannel.sendToQueue(MODERATED_QUEUE, Buffer.from(message), {
        persistent: true
    });
}
```
On approve: publishes the (potentially edited) joke to the MODERATED_JOKES queue. The ETL service consumes from this queue.

```javascript
if (action === 'reject') {
    console.log(`Joke rejected: "${setup}"`);
    // Message is simply discarded (ack'd below but not forwarded)
}
```
On reject: does nothing with the joke. The original message is still acknowledged below, so it's permanently removed from SUBMITTED_JOKES.

```javascript
if (deliveryTag !== undefined) {
    consumeChannel.ack({ fields: { deliveryTag: parseInt(deliveryTag) } });
}
```
Acknowledges the original message from SUBMITTED_JOKES using the delivery tag sent from the frontend. This constructs a minimal message object with just the `fields.deliveryTag` property, which is all that `ack()` needs.

WHY this workaround? `channel.get()` returns a message object, but by the time the POST request arrives (a separate HTTP request), that object no longer exists in memory. We reconstruct a minimal object with just the delivery tag.

INTERVIEW TIP: "The delivery tag is an integer that uniquely identifies a message within a channel. It's assigned by RabbitMQ when the message is delivered. We pass it through the HTTP request-response cycle to acknowledge the correct message."

---

### 4.2 moderate-microservice/public/script.js

**Level 1:** Frontend with polling, authentication check, and editable joke review form.

```javascript
Lines 17-37: checkAuth()
```
On page load, calls `/auth-status` to check if the user is logged in. If not, redirects to `/login` (which triggers Auth0's login page). If logged in, shows the user's email and a logout link.

```javascript
Lines 56-91: pollForJoke()
```
```javascript
async function pollForJoke() {
    const res = await fetch('/moderate');
    const data = await res.json();
    if (data.available && data.joke) {
        clearInterval(pollingInterval);
        // Populate form fields...
    }
}
```
Polls `GET /moderate` every 1 second (via `setInterval`). When a joke is available:
1. Stops polling (`clearInterval`)
2. Populates the form with the joke data (editable!)
3. Stores the delivery tag in a hidden input
4. Shows the form, hides the spinner

WHY polling instead of WebSockets? Simplicity. WebSockets would be more efficient but add complexity. Polling every second is fine for a moderation use case — low traffic, no real-time requirement.

```javascript
Lines 93-105: startPolling()
```
Called on initial load and after each approve/reject. Hides the form, shows the spinner, starts the 1-second poll interval.

```javascript
Lines 117-144: submitModeration()
```
Sends POST to `/moderated` with the action (approve/reject), potentially edited joke data, and the delivery tag. On success, immediately starts polling for the next joke.

---

### 4.3 moderate-microservice/public/index.html

- `<div class="user-status-bar">` — Shows login status, login/logout links.
- `<div id="waiting-state">` — Spinner shown while polling for jokes.
- `<form id="moderate-form" class="hidden">` — Editable form shown when a joke arrives.
- `<input type="hidden" id="delivery-tag">` — Stores the RabbitMQ delivery tag invisibly.
- `<textarea id="setup">` and `<textarea id="punchline">` — Editable fields so the moderator can fix typos.
- `<select id="type-select">` — Type dropdown, or new type input via toggle.
- Two buttons: "Reject & Next" and "Approve & Submit".

---

<a id="part-5-database-abstraction"></a>
## ═══════════════════════════════════════
## PART 5: DATABASE ABSTRACTION
## ═══════════════════════════════════════

### 5.1 joke-app/db/index.js (Factory Pattern)

**Level 1:** A factory that selects MySQL or MongoDB adapter based on an environment variable.

```javascript
const dbType = process.env.DB_TYPE || 'mysql';

if (dbType === 'mongo') {
    module.exports = require('./mongo-adapter');
} else {
    module.exports = require('./mysql-adapter');
}
```

This is the **Factory Pattern** — the caller (server.js) does `require('./db')` and gets back an object with a `.query()` method. It doesn't know or care whether it's talking to MySQL or MongoDB.

WHY? Docker Compose profiles (`--profile mysql` or `--profile mongo`) control which database container starts. This factory ensures the app code uses the matching adapter.

INTERVIEW TIP: "The factory pattern provides loose coupling — the business logic in server.js doesn't depend on a specific database. We can switch databases by changing one environment variable."

---

### 5.2 joke-app/db/mysql-adapter.js

**Level 1:** Standard MySQL connection pool — same as Option 1's db.js.

Exports `pool.promise()` which provides a `.query()` method. `db.query('SELECT ...', [params])` returns `[rows, fields]`.

Parameterised queries (`?` placeholders) prevent SQL injection by ensuring user input is always treated as data, not SQL code.

---

### 5.3 joke-app/db/mongo-adapter.js — CLEVER ADAPTER

**Level 1:** A MongoDB adapter that emulates the MySQL query interface by parsing SQL strings.

**Level 2:** Instead of rewriting all the server code for MongoDB, this adapter intercepts the MySQL-style query strings (like `SELECT type FROM types ORDER BY type`) and translates them to equivalent MongoDB operations. This means the server.js code doesn't change at all when switching databases.

```javascript
Lines 12-24: getDb() — Lazy connection
```
Uses a singleton pattern — connects on first use, caches the connection. Subsequent calls return the cached connection.

```javascript
Lines 33-35: SELECT type FROM types ORDER BY type
```
```javascript
if (queryString.includes('SELECT type FROM types')) {
    const types = await db.collection('types')
        .find({}, { projection: { type: 1, _id: 0 } })
        .sort({ type: 1 })
        .toArray();
    return [types];
}
```
- `find({})` — No filter, get all documents.
- `projection: { type: 1, _id: 0 }` — Only return the `type` field, exclude `_id`.
- `.sort({ type: 1 })` — Sort ascending by type.
- Returns `[types]` — Wraps in array to match MySQL's `[rows, fields]` pattern.

```javascript
Lines 49-62: ORDER BY RAND() → $sample
```
```javascript
pipeline.push({ $sample: { size: parseInt(count) || 1 } });
```
`$sample` is MongoDB's equivalent of MySQL's `ORDER BY RAND() LIMIT N`. It uses a pseudo-random cursor to efficiently select random documents.

WHY `$sample` is better than `ORDER BY RAND()`? MySQL's `ORDER BY RAND()` scans the entire table and sorts all rows. MongoDB's `$sample` uses reservoir sampling — much faster for large collections.

```javascript
Lines 66-75: INSERT IGNORE → updateOne with upsert
```
```javascript
await db.collection('types').updateOne(
    { type: type },                    // Filter: look for this type
    { $setOnInsert: { type: type } },  // Only set if inserting (not updating)
    { upsert: true }                   // Insert if not found
);
```
- `upsert: true` — If no document matches the filter, insert a new one.
- `$setOnInsert` — Only applies the update when inserting (not when finding an existing document).
- Together, these emulate `INSERT IGNORE` — insert if not exists, do nothing if it does.

INTERVIEW TIP: "How does the MongoDB adapter handle INSERT IGNORE? It uses `updateOne` with `upsert: true` and `$setOnInsert`. The upsert creates a new document if none matches the filter. $setOnInsert ensures we don't modify existing documents."

```javascript
Lines 78-88: INSERT INTO jokes → insertOne
```
```javascript
const joke = {
    setup: params[0],
    punchline: params[1],
    type: params[2]  // In Mongo, type is stored as a string directly, not a foreign key
};
const result = await db.collection('jokes').insertOne(joke);
return [{ insertId: result.insertedId.toString() }];
```
MongoDB stores the type name directly in the joke document (denormalised), unlike MySQL which uses a foreign key. This is fine for MongoDB because document databases are designed for denormalised data.

---

<a id="part-6-kong-gateway"></a>
## ═══════════════════════════════════════
## PART 6: KONG GATEWAY
## ═══════════════════════════════════════

### 6.1 kong-gateway/kong.yaml

**Level 1:** Declarative configuration file that defines all Kong API Gateway routes, services, and plugins.

**Level 2:** Kong acts as a reverse proxy — all client requests go to Kong first, and Kong forwards them to the correct backend service (joke app on VM1, submit/moderate on VM2). This config defines which URL paths map to which backend services, and optionally applies rate limiting.

```yaml
Line 1: _format_version: "3.0"
```
Kong declarative config format version. Required for DB-less mode (no database).

```yaml
Lines 8-25: joke-service (Rate-Limited API)
```
```yaml
- name: joke-service
  url: http://10.0.0.4:4000
  routes:
    - name: joke-route
      paths:
        - /joke
      strip_path: false
  plugins:
    - name: rate-limiting
      config:
        minute: 5
        policy: local
        fault_tolerant: true
        hide_client_headers: false
```
- `url: http://10.0.0.4:4000` — Kong forwards requests to VM1's joke app. Uses the private Azure VNet IP.
- `paths: [/joke]` — Any request starting with `/joke` (like `/joke/dad`, `/joke/any?count=3`) is routed here.
- `strip_path: false` — The path is forwarded AS-IS. `/joke/dad` → `http://10.0.0.4:4000/joke/dad`. If `strip_path: true`, it would become `http://10.0.0.4:4000/dad` (stripping the `/joke` prefix).
- **Rate limiting plugin**: Max 5 requests per minute per client. `policy: local` means each Kong instance tracks limits independently (no shared database needed). `fault_tolerant: true` means if the rate-limiting counter fails, requests are allowed through (fail-open). `hide_client_headers: false` means rate limit headers (`X-RateLimit-*`) are sent to clients.

WHY rate-limit only the joke API? The API endpoint `/joke/:type` is the one that external consumers would hit. The UI pages and type endpoints are less likely to be abused.

```yaml
Lines 27-44: joke-app-ui-service (No Rate Limiting)
```
```yaml
- name: joke-app-ui-service
  url: http://10.0.0.4:4000
  routes:
    - name: joke-app-ui
      paths: [/joke-app]
      strip_path: true
    - name: joke-types-route
      paths: [/joke-types]
      strip_path: false
```
Same backend (port 4000), but different routes. Two routes on this service:

1. `/joke-app` with `strip_path: true` — When you visit `https://kong-ip/joke-app/`, Kong strips `/joke-app` and forwards to `http://10.0.0.4:4000/` — serving the joke app's `index.html`. The `<base href="/joke-app/">` tag in the HTML ensures CSS/JS paths resolve correctly.

2. `/joke-types` with `strip_path: false` — Forwarded as-is. The joke app has a `GET /joke-types` route specifically for this Kong path.

WHY separate joke-service and joke-app-ui-service? Rate limiting! We only want to rate-limit the `/joke` API, not the UI or the types endpoint. If types were rate-limited, the dropdown would stop populating after 5 clicks.

INTERVIEW TIP: "Why are there two Kong services pointing to the same backend? So we can apply rate limiting selectively. The API gets rate-limited; the UI and types endpoint don't."

```yaml
Lines 46-78: submit-service
```
Routes for submit functionality:
- `/submit` — POST endpoint (strip_path: false)
- `/submit-types` — Types for submit dropdown (strip_path: false)
- `/docs` — Swagger documentation (strip_path: false)
- `/submit-app` — UI pages (strip_path: true, so `/submit-app/style.css` → `/style.css`)

```yaml
Lines 80-139: moderate-service
```
Routes for moderation:
- `/moderate` — GET to pull a joke from queue
- `/moderated` — POST to approve/reject
- `/moderate-types` — Types for moderation dropdown
- `/auth-status`, `/login`, `/logout`, `/callback` — Auth0 OIDC routes. These MUST be proxied through Kong because Auth0 redirects back to the `BASE_URL`, which is the Kong public IP.
- `/` — Default route, serves the moderation UI homepage

WHY so many routes for moderate? Auth0 OIDC requires specific callback URLs. `/login` triggers the Auth0 redirect, `/callback` receives the response, `/logout` ends the session. All must go through the same origin (Kong's public IP).

---

### 6.2 kong-gateway/docker-compose.yml

```yaml
KONG_DATABASE: "off"
```
**DB-less mode** — Kong reads its config from the YAML file instead of a PostgreSQL database. Simpler, but changes require a container restart.

```yaml
KONG_DECLARATIVE_CONFIG: /etc/kong/kong.yaml
```
Path inside the container where the config file is mounted.

```yaml
KONG_PROXY_LISTEN: "0.0.0.0:8000, 0.0.0.0:8443 ssl"
```
Listens on 8000 (HTTP) and 8443 (HTTPS with SSL).

```yaml
KONG_SSL_CERT: /etc/kong/certs/cert.pem
KONG_SSL_CERT_KEY: /etc/kong/certs/key.pem
```
SSL certificate paths. These are development certificates generated with `mkcert`.

```yaml
ports:
  - "80:8000"      # HTTP
  - "443:8443"     # HTTPS
  - "8445:8444"    # Admin API
```
Maps standard HTTP/HTTPS ports to Kong's internal ports.

```yaml
volumes:
  - ./kong.yaml:/etc/kong/kong.yaml:ro
  - ./certs:/etc/kong/certs:ro
```
Bind mounts — `:ro` means read-only. Kong can't modify these files.

---

### 6.3 kong-gateway/certs/

`cert.pem` and `key.pem` are SSL/TLS certificate files generated with **mkcert** (a tool for creating locally-trusted certificates).

- `cert.pem` — The public certificate. Sent to browsers during the TLS handshake.
- `key.pem` — The private key. Used by Kong to encrypt/decrypt traffic. Must be kept secret.

WHY not in the image? Certificates change more often than application code and should be managed separately. Mounting them as volumes makes replacement easy without rebuilding the image.

---

<a id="part-7-terraform"></a>
## ═══════════════════════════════════════
## PART 7: TERRAFORM
## ═══════════════════════════════════════

### 7.1 kong-gateway/terraform/main.tf — DEEP DIVE

**Level 1:** Infrastructure-as-Code (IaC) file that creates Azure VMs, networking, and deploys the application.

**Level 2:** Terraform reads this file, communicates with Azure's API, and creates/manages cloud resources. This file defines THREE virtual machines (Kong VM, Joke VM, Submit VM), each with its own public IP, network interface, security group, and provisioners that install Docker and deploy the app code.

```hcl
Lines 1-12: Provider configuration
```
```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}
provider "azurerm" {
  features {}
}
```
- `terraform` block — Declares which provider plugins Terraform needs. `azurerm` is the Azure Resource Manager provider.
- `~> 3.0` — Version constraint: any 3.x version (3.0, 3.1, 3.117, etc.) but NOT 4.0.
- `provider "azurerm"` — Configures the Azure provider. `features {}` is required but empty (uses defaults). Authentication uses Azure CLI credentials (`az login`).

```hcl
Lines 14-26: Data sources
```
```hcl
data "azurerm_resource_group" "existing" {
  name = var.resource_group_name
}
data "azurerm_subnet" "existing" {
  name                 = var.subnet_name
  virtual_network_name = var.vnet_name
  resource_group_name  = var.resource_group_name
}
```
**Data sources** reference EXISTING resources that were created outside of Terraform (e.g., manually in the Azure portal). They don't create anything — they just look up information (like the subnet ID) that other resources need.

WHY data sources? The resource group and VNet were created as part of Option 2 setup. Terraform doesn't manage them, but needs their IDs to place new resources in the same network.

```hcl
Lines 30-37: Public IP
```
```hcl
resource "azurerm_public_ip" "kong_ip" {
  name                = "${var.vm_name}-ip"
  allocation_method   = "Static"
  sku                 = "Standard"
}
```
`Static` — The IP doesn't change on VM reboot. Important because Kong's public IP needs to be stable (DNS records, Auth0 callback URLs point to it). `Standard` SKU is required for Static allocation.

```hcl
Lines 40-96: Network Security Group (Firewall)
```
Defines inbound rules:
- Priority 1000: Allow SSH (port 22) — for remote management
- Priority 1001: Allow HTTP (port 80) — Kong proxy
- Priority 1002: Allow HTTPS (port 443) — Kong proxy
- Priority 1003: Allow Kong Admin (port 8445) — Admin API

Lower priority numbers = higher precedence. Azure evaluates rules from lowest to highest priority number.

```hcl
Lines 98-117: Network Interface (NIC)
```
```hcl
resource "azurerm_network_interface" "kong_nic" {
  ip_configuration {
    subnet_id                     = data.azurerm_subnet.existing.id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.private_ip
    public_ip_address_id          = azurerm_public_ip.kong_ip.id
  }
}
```
Attaches the VM to the subnet with a static private IP (10.0.0.6 for Kong). Associates the public IP so it's reachable from the internet.

```hcl
Lines 120-200: Kong VM with Provisioners
```

```hcl
resource "azurerm_linux_virtual_machine" "kong_vm" {
  admin_ssh_key {
    public_key = file("~/.ssh/id_rsa.pub")
  }
  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
  }
```
Creates an Ubuntu 22.04 LTS VM with SSH key authentication (no password).

**Provisioners** — Run commands during resource creation:

```hcl
  connection {
    type        = "ssh"
    user        = self.admin_username
    private_key = file("~/.ssh/id_rsa")
    host        = azurerm_public_ip.kong_ip.ip_address
  }
```
**Connection block** — Tells provisioners HOW to connect to the VM. Uses SSH with the private key.

```hcl
  provisioner "remote-exec" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y docker-ce ...",
      "sudo usermod -aG docker ${self.admin_username}",
    ]
  }
```
**Remote-exec provisioner** — Runs shell commands ON THE VM over SSH. This installs Docker. `self.admin_username` references the current resource's attributes.

```hcl
  provisioner "file" {
    source      = "../docker-compose.yml"
    destination = "/home/${self.admin_username}/kong-gateway/docker-compose.yml"
  }
```
**File provisioner** — Copies files FROM your local machine TO the VM over SSH. Copies the Kong config files.

```hcl
  provisioner "remote-exec" {
    inline = [
      "cd /home/${self.admin_username}/kong-gateway",
      "sudo docker-compose up -d"
    ]
  }
```
Starts Kong via Docker Compose on the VM.

**Joke VM provisioners include a `local-exec`:**
```hcl
  provisioner "local-exec" {
    command = "rsync -avz --exclude 'node_modules' ... ${self.admin_username}@${azurerm_public_ip.joke_ip.ip_address}:/home/.../"
  }
```
**Local-exec provisioner** — Runs commands ON YOUR LOCAL MACHINE (not the VM). Uses `rsync` to efficiently copy the microservice code to the VM, excluding `node_modules` (which would be rebuilt by Docker anyway).

WHY rsync instead of file provisioner? File provisioner copies one file/directory at a time. rsync handles entire directory trees efficiently with exclude patterns.

**Submit VM provisioners:**
```hcl
  provisioner "remote-exec" {
    inline = [
      "sed -i 's/RABBITMQ_IP=.*/RABBITMQ_IP=10.0.0.5/' .env",
      "cd /home/.../rabbitmq && sudo docker-compose up -d",
      "sleep 15",
      "cd /home/.../submit-microservice && sudo docker-compose up --build -d",
      "cd /home/.../moderate-microservice && sudo docker-compose up --build -d"
    ]
  }
```
- `sed -i` — Modifies .env files in-place to use Azure private IPs instead of localhost.
- Starts RabbitMQ first, waits 15 seconds for it to initialise, then starts submit and moderate services.

INTERVIEW TIP: "What's the difference between Terraform provisioners? remote-exec runs on the created resource (the VM), local-exec runs on your machine, and file copies files from local to remote."

---

### 7.2 kong-gateway/terraform/variables.tf

```hcl
variable "resource_group_name" { default = "co3404-rg" }
variable "location" { default = "norwayeast" }
variable "vm_size" { default = "Standard_B1s" }
variable "admin_username" { default = "azureuser" }
variable "private_ip" { default = "10.0.0.6" }
```

- `Standard_B1s` — Azure burstable VM: 1 vCPU, 1GB RAM. Cheapest option for dev/testing.
- `norwayeast` — Azure region. Closest to the university (UK).
- Variables can be overridden in `terraform.tfvars` or via command line.

---

<a id="part-8-docker-compose-files"></a>
## ═══════════════════════════════════════
## PART 8: DOCKER COMPOSE FILES (Option 2)
## ═══════════════════════════════════════

### 8.1 joke-microservice/docker-compose.yml

```yaml
services:
  database:
    profiles: [ "mysql" ]
  mongodb:
    profiles: [ "mongo" ]
```

**Docker Compose Profiles** — Services with profiles are NOT started by default. You must specify the profile:
- `docker-compose --profile mysql up` → Starts database + joke + etl (MySQL mode)
- `docker-compose --profile mongo up` → Starts mongodb + joke + etl (MongoDB mode)
- Without `--profile` → Only starts joke + etl (no database — connects to external one)

The `joke` and `etl` services have no profile, so they always start. The `DB_TYPE` env var tells the app which adapter to use.

WHY profiles? Lets you switch between MySQL and MongoDB without editing the file. Same deployment command, different profile flag.

Note: `joke` and `etl` have no `depends_on` in the Option 2 version — because the database might be external (on another machine) rather than a sibling container.

### 8.2 submit-microservice/docker-compose.yml

```yaml
services:
  submit:
    volumes:
      - types-cache:/data
```
Mounts a named volume at `/data` inside the container. The types cache file (`/data/types-cache.json`) persists here across container restarts.

### 8.3 moderate-microservice/docker-compose.yml

```yaml
environment:
  AUTH_SECRET: ${AUTH_SECRET}
  AUTH_CLIENT_ID: ${AUTH_CLIENT_ID}
  AUTH_CLIENT_SECRET: ${AUTH_CLIENT_SECRET}
  AUTH_ISSUER_URL: ${AUTH_ISSUER_URL}
  BASE_URL: ${BASE_URL}
```
Passes Auth0 credentials from .env into the container.

### 8.4 rabbitmq/docker-compose.yml

```yaml
image: rabbitmq:3-management
ports:
  - "5672:5672"     # AMQP protocol port (for applications)
  - "15672:15672"   # Management UI (web dashboard)
```

WHY `rabbitmq:3-management` instead of `rabbitmq:3`? The `-management` tag includes the management plugin — a web UI at port 15672 where you can monitor queues, message rates, connections, and manually inspect messages.

```yaml
volumes:
  - rmq-data:/var/lib/rabbitmq
```
Persists queue data across restarts. Without this, all queued messages would be lost on container restart.

---

<a id="part-9-deployment"></a>
## ═══════════════════════════════════════
## PART 9: DEPLOYMENT (deploy.sh)
## ═══════════════════════════════════════

**Level 1:** Shell script for redeploying updated code to Azure VMs.

**Level 2:** Unlike Terraform (which creates infrastructure from scratch), deploy.sh is for UPDATING already-running VMs. It copies new code via SCP and restarts containers.

```bash
Line 2: set -e
```
Exit immediately if any command fails. Without this, the script would continue even if SCP fails, potentially deploying incomplete code.

```bash
Lines 4-7: SSH config and VM addresses
```
```bash
SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.100.185.233"
VM2="azureuser@20.100.186.237"
VM3="azureuser@20.100.186.201"
```
- `-o StrictHostKeyChecking=no` — Don't prompt "are you sure you want to connect?" on first SSH.
- Public IPs of the three Azure VMs.

```bash
Lines 9-11: Deploy to VM1 (Joke)
```
```bash
scp $SSH_OPTS -r joke-microservice $VM1:~/
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo up --build -d"
```
- `scp -r` — Recursively copies the entire joke-microservice directory to the VM.
- `--build` — Rebuilds Docker images with new code.
- `-d` — Detached mode (containers run in background).

```bash
Lines 13-19: Deploy to VM2 (Submit + Moderate + RabbitMQ)
```
Copies all three directories, then starts them in order: RabbitMQ first, then submit and moderate.

```bash
Lines 21-23: Deploy to VM3 (Kong)
```
```bash
scp $SSH_OPTS kong-gateway/kong.yaml $VM3:~/
ssh $SSH_OPTS $VM3 "sudo docker restart kong-gateway || sudo docker restart kong"
```
Only copies the kong.yaml config (no rebuild needed — Kong uses the official image). Restarts the container to pick up config changes. The `||` tries the alternative container name if the first fails.

HOW is deploy.sh different from Terraform?
- **Terraform** = Initial setup. Creates VMs, installs Docker, deploys code. Run ONCE.
- **deploy.sh** = Redeployment. Updates code on existing VMs. Run MANY times during development.

---

<a id="part-10-summary"></a>
## ═══════════════════════════════════════
## PART 10: SUMMARY
## ═══════════════════════════════════════

### 1. FILE CONNECTION MAP

```
                                    ┌─────────────────────────┐
                                    │     Kong Gateway (VM3)   │
                                    │     Reverse Proxy + TLS  │
                                    └─────────┬───────────────┘
                                              │
                    ┌─────────────────────────┼───────────────────────┐
                    │                         │                       │
            ┌───────▼──────┐         ┌────────▼───────┐      ┌───────▼────────┐
            │  Joke App    │         │  Submit App    │      │ Moderate App   │
            │  (VM1:4000)  │         │  (VM2:4200)    │      │ (VM2:4100)     │
            └───────┬──────┘         └────────┬───────┘      └───┬────────┬───┘
                    │                         │                  │        │
            ┌───────▼──────┐                  │                  │        │
            │  Database    │         ┌────────▼──────────────────▼────┐   │
            │  MySQL/Mongo │◄────────┤         RabbitMQ (VM2:5672)   │   │
            │  (VM1)       │         │                               │   │
            └───────┬──────┘         └──────┬────────────────────────┘   │
                    │                       │                            │
            ┌───────▼──────┐               │                            │
            │  ETL Service │◄──────────────┘                   ┌────────▼───────┐
            │  (VM1:4001)  │                                   │    Auth0       │
            └──────────────┘                                   │    (Cloud)     │
                                                               └────────────────┘
```

**Message Flow:**
```
User submits joke
  → submit-app/server.js publishes to RabbitMQ queue: SUBMITTED_JOKES
    → moderate/server.js pulls from SUBMITTED_JOKES (channel.get)
      → Moderator approves
        → moderate/server.js publishes to RabbitMQ queue: MODERATED_JOKES
          → etl/etl.js consumes from MODERATED_JOKES (channel.consume)
            → etl/etl.js writes to database (via db adapter)
              → etl/etl.js publishes type_update to fanout exchange (if new type)
                → submit-app/server.js receives type_update → updates cache file
                → moderate/server.js receives type_update → updates cache file
                  → joke-app/server.js reads from database (via db adapter)
                    → User sees joke in joke app
```

---

### 2. INTERVIEW CHEAT SHEET — 20 Most Likely Questions

**Q1: "Why did you use channel.get() instead of channel.consume() for moderation?"**
A: "channel.get() is pull-based — the server explicitly requests one message per HTTP request. This matches the moderation workflow: a human reviews one joke at a time. channel.consume() would push all messages at once, overwhelming the moderator and risking message loss if the server crashes with unacknowledged messages in memory."

**Q2: "What happens if the ETL crashes mid-processing?"**
A: "Because we only call channel.ack() AFTER successfully inserting into the database, the unacknowledged message stays in the queue. When the ETL restarts, RabbitMQ redelivers it. This is 'at-least-once delivery.' The INSERT IGNORE on types makes the type insertion idempotent, so reprocessing is safe."

**Q3: "Why is the fanout exchange better than a regular queue for type updates?"**
A: "A fanout exchange broadcasts to ALL bound queues. Both the submit app and moderate app need type updates. With a regular queue, only one consumer would receive each message. The fanout ensures all subscribers get every update independently."

**Q4: "How does the database adapter pattern work?"**
A: "The db/index.js file checks the DB_TYPE environment variable and exports either the MySQL or MongoDB adapter. Both adapters expose the same .query() interface. The MongoDB adapter parses SQL strings and translates them to equivalent Mongo operations. Server code calls db.query() without knowing which database it's using."

**Q5: "What does INSERT IGNORE do?"**
A: "INSERT IGNORE attempts an INSERT, but if it would violate a constraint (like UNIQUE), it silently does nothing instead of throwing an error. We use it for types — if the type already exists, we don't want an error, we just want to move on."

**Q6: "Why do you need both a durable queue AND persistent messages?"**
A: "Durable queue = the queue definition (name, settings) survives broker restart. Persistent message = the message content is written to disk. You need both — a durable queue with non-persistent messages would lose messages on restart. A persistent message on a non-durable queue is pointless because the queue itself disappears."

**Q7: "How does Docker DNS work?"**
A: "On a custom bridge network, Docker runs an embedded DNS server at 127.0.0.11. Containers can resolve other containers by their service name (from docker-compose.yml). So `DB_HOST: database` resolves to the MySQL container's IP. This only works on custom networks, not the default bridge."

**Q8: "What is prefetch(1) and why is it important?"**
A: "prefetch(1) tells RabbitMQ 'only send me one unacknowledged message at a time.' Without it, RabbitMQ would push all queued messages immediately, potentially overwhelming the consumer. With prefetch(1), the consumer processes messages one at a time — the next message is only sent after the current one is acknowledged."

**Q9: "Why use a connection pool instead of a single connection?"**
A: "A pool maintains multiple reusable connections. Creating a new connection per request is slow (~10-50ms for TCP + MySQL handshake). Pools also handle reconnection on dropped connections and support concurrent queries. Our pool has 10 connections, meaning 10 simultaneous queries can run."

**Q10: "What does strip_path do in Kong?"**
A: "strip_path: true removes the matched path prefix before forwarding. So /submit-app/style.css becomes /style.css when forwarded to the backend. strip_path: false forwards the full path as-is. We use true for UI routes (so static files resolve correctly) and false for API routes (so /joke/dad stays /joke/dad)."

**Q11: "How does Auth0/OIDC authentication work in your app?"**
A: "The express-openid-connect middleware handles the OAuth 2.0 / OIDC flow. When a user visits /login, they're redirected to Auth0's hosted login page. After successful login, Auth0 redirects back to /callback with an authorisation code. The middleware exchanges this for tokens and creates a session cookie. Subsequent requests include this cookie, and req.oidc.isAuthenticated() checks its validity."

**Q12: "Why does the moderate app use three RabbitMQ channels?"**
A: "One for consuming (pulling messages from SUBMITTED_JOKES), one for publishing (sending approved jokes to MODERATED_JOKES), and one for subscribing to the type_update fanout exchange. Separating channels is a RabbitMQ best practice — a slow publish shouldn't block consumption, and a subscriber error shouldn't affect the main workflow."

**Q13: "What's the difference between Terraform and deploy.sh?"**
A: "Terraform is for initial infrastructure provisioning — creating VMs, networking, security groups, and the first deployment. deploy.sh is for subsequent code updates — copying new code and restarting containers. Terraform runs once; deploy.sh runs many times during development."

**Q14: "Why is your app split across multiple VMs instead of one?"**
A: "To demonstrate distributed systems concepts: independent scaling, fault isolation, and service decomposition. VM1 handles data (database + joke API + ETL). VM2 handles user interaction and message brokering (submit + moderate + RabbitMQ). VM3 handles routing (Kong). If one VM goes down, the others continue operating."

**Q15: "How does the type cache file work across services?"**
A: "When the ETL inserts a new type, it publishes the complete types list to a fanout exchange. The submit and moderate services subscribe to this exchange. When they receive an update, they write the types array to a JSON file on a Docker volume (/data/types-cache.json). Their /types endpoints read from this file instead of querying the database."

**Q16: "What is a delivery tag and why do you pass it through the HTTP request?"**
A: "A delivery tag is an integer that RabbitMQ assigns when it delivers a message to a consumer. It uniquely identifies that delivery on that channel. We pass it from GET /moderate → frontend → POST /moderated so we can acknowledge the correct message. Without it, we wouldn't know which message the moderator approved or rejected."

**Q17: "Why use Docker Compose profiles for MySQL/MongoDB?"**
A: "Profiles let you define multiple database options in the same compose file. `--profile mysql` starts MySQL; `--profile mongo` starts MongoDB. The DB_TYPE environment variable tells the app which adapter to use. This demonstrates database portability without separate config files."

**Q18: "What does KONG_DATABASE: off mean?"**
A: "DB-less mode. Kong normally uses PostgreSQL to store its configuration. With KONG_DATABASE: off, Kong reads all its configuration from the declarative YAML file (kong.yaml). Simpler setup, but requires a container restart to apply changes."

**Q19: "What are Terraform provisioners and when do they run?"**
A: "Provisioners run commands during resource creation. remote-exec runs commands on the created VM via SSH. local-exec runs commands on your local machine. file copies files from local to remote. They only run when the resource is first created (terraform apply), not on subsequent applies unless the resource is recreated."

**Q20: "What happens to messages in the queue if all consumers are down?"**
A: "Messages stay in the queue because it's durable and messages are persistent. When a consumer reconnects, it receives all queued messages. This is one of the key benefits of message queues — temporal decoupling. The producer and consumer don't need to be running at the same time."

---

### 3. CONCEPTS YOU MUST UNDERSTAND

| Concept | One-Line Explanation |
|---------|---------------------|
| **Connection Pool** | A set of reusable database connections that avoids the overhead of creating new connections per request |
| **Fanout Exchange** | A RabbitMQ exchange that broadcasts every message to ALL queues bound to it (like a radio broadcast) |
| **Direct Queue** | A standard point-to-point queue where each message is consumed by exactly one consumer |
| **Durable Queue** | A queue whose definition (name, settings) survives RabbitMQ broker restarts |
| **Persistent Message** | A message written to disk (deliveryMode: 2) so it survives broker restarts; requires a durable queue |
| **Ack (Acknowledge)** | Tells RabbitMQ "I've processed this message, delete it from the queue" |
| **Nack (Negative Acknowledge)** | Tells RabbitMQ "I failed to process this message"; can optionally requeue it |
| **Prefetch** | Limits how many unacknowledged messages RabbitMQ sends to a consumer at once (backpressure control) |
| **Path Parameter** | A variable in the URL path: `/joke/:type` → `req.params.type` (e.g., `/joke/dad`) |
| **Query Parameter** | A key-value pair after `?` in the URL: `?count=3` → `req.query.count` |
| **Middleware** | A function that runs between receiving a request and sending a response (e.g., `cors()`, `auth()`, `express.json()`) |
| **OIDC (OpenID Connect)** | An identity/authentication protocol built on OAuth 2.0; adds a standardised way to verify WHO the user is |
| **OAuth 2.0** | An authorisation framework that lets third-party apps access resources on behalf of a user |
| **CORS** | Cross-Origin Resource Sharing — HTTP headers that tell browsers which origins can make API requests |
| **Provisioner (Terraform)** | A block that runs commands during resource creation: `remote-exec` (on VM), `local-exec` (on your machine), `file` (copy files) |
| **Data Source (Terraform)** | Reads information about existing resources (created outside Terraform) without managing them |
| **Bridge Network (Docker)** | An isolated network that enables container-to-container communication with automatic DNS resolution |
| **Named Volume (Docker)** | Docker-managed persistent storage that survives container restarts and removal |
| **Bind Mount (Docker)** | Maps a specific host directory into a container; the host controls the content |
| **Healthcheck (Docker)** | A command that Docker runs periodically to determine if a container is healthy; used with `depends_on: condition: service_healthy` |
| **INSERT IGNORE (SQL)** | Attempts an INSERT but silently skips it if it would violate a constraint (like UNIQUE) |
| **Foreign Key** | A column that references the primary key of another table, enforcing referential integrity |
| **AUTO_INCREMENT** | MySQL feature that automatically generates unique incrementing IDs for new rows |
| **$sample (MongoDB)** | Aggregation stage that randomly selects N documents; equivalent to MySQL's `ORDER BY RAND() LIMIT N` |
| **Upsert (MongoDB)** | `updateOne` with `upsert: true` — updates if found, inserts if not; used with `$setOnInsert` for INSERT IGNORE behavior |
| **Idempotent** | An operation that produces the same result no matter how many times you execute it (e.g., INSERT IGNORE) |
| **ETL** | Extract-Transform-Load — a pattern for moving data from one system to another with optional processing |
| **API Gateway** | A reverse proxy that sits in front of backend services, providing routing, rate limiting, SSL termination, etc. |
| **Rate Limiting** | Restricting how many requests a client can make in a time window (e.g., 5 per minute) |
| **Declarative Configuration** | Describing WHAT you want (desired state) rather than HOW to achieve it; Kong YAML and Terraform HCL use this approach |
| **strip_path (Kong)** | When true, Kong removes the matched path prefix before forwarding to the backend service |
