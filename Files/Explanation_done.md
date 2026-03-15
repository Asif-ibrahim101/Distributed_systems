# CO3404 DISTRIBUTED SYSTEMS — COMPLETE FILE-BY-FILE CODE EXPLANATION

This document explains **every file** in the project. It covers Option 1 (monolithic) and Option 2 (microservice architecture with Options 2, 3, and 4).

---

# PHASE 1: OPTION 1 — MONOLITHIC ARCHITECTURE (Single VM)

Option 1 runs everything on **one VM**: two web apps (joke-app, submit-app) and one MySQL database, all connected via a single Docker Compose network.

---

### 📄 `co3404-option1/docker-compose.yml`
**Purpose:** Defines all three services (database, joke-app, submit-app) and how they connect.

**What it does:** Orchestrates three Docker containers on a single VM. The database starts first (with a health check), and both apps wait for it before starting. All three containers share a private bridge network called `joke-network` so they can talk to each other using Docker DNS names (e.g., `database` instead of `localhost`).

**Code walkthrough:**

```yaml
services:
  database:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    ports:
      - "4002:3306"
    volumes:
      - db-data:/var/lib/mysql
      - ./db-init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
```
- **`image: mysql:8.0`** — Uses the official MySQL 8.0 Docker image (no Dockerfile needed since we're not customizing the image).
- **`environment`** — Sets up MySQL credentials. `${DB_ROOT_PASSWORD}` reads from the `.env` file. MySQL auto-creates the database and user on first boot.
- **`ports: "4002:3306"`** — Maps container's internal MySQL port (3306) to the host's port 4002. This lets you connect from outside Docker (e.g., MySQL Workbench).
- **`volumes: db-data:/var/lib/mysql`** — Named volume for **persistent storage**. Without this, all data would be lost when the container is removed. The volume persists even if the container is deleted and recreated.
- **`volumes: ./db-init:/docker-entrypoint-initdb.d`** — Mounts the local `db-init/` folder. MySQL runs any `.sql` files in this directory **only on first startup** (when the data directory is empty).
- **`healthcheck`** — Docker pings MySQL every 10 seconds. Other services use `condition: service_healthy` to wait until MySQL is actually ready, not just started. This prevents the "Connection refused" errors that happen when the app starts before MySQL is accepting connections.

```yaml
  joke:
    build: ./joke-app
    ports:
      - "4000:3000"
    environment:
      DB_HOST: database
    depends_on:
      database:
        condition: service_healthy
```
- **`build: ./joke-app`** — Docker builds the image using `joke-app/Dockerfile`.
- **`DB_HOST: database`** — The hostname `database` is the Docker DNS name for the MySQL container. Docker's internal DNS resolves this to the container's IP on the `joke-network`.
- **`depends_on: condition: service_healthy`** — Waits for the database health check to pass before starting. This is the correct way to handle startup ordering (vs plain `depends_on` which only waits for the container to start, not for MySQL to be ready).
- **`restart: unless-stopped`** — Auto-restarts on crash. Only stops if you explicitly run `docker stop`.

```yaml
networks:
  joke-network:
    driver: bridge
```
- **Bridge network** — A private virtual network. Containers on this network can reach each other by service name, but are isolated from external traffic (except for explicitly mapped ports).

**Connects to:** `.env` (reads credentials), `joke-app/Dockerfile`, `submit-app/Dockerfile`, `db-init/init.sql`

**Key terms to know:** Docker Compose, bridge network, named volume, health check, Docker DNS, service dependency, port mapping

---

### 📄 `co3404-option1/.env`
**Purpose:** Stores database credentials that docker-compose.yml reads via `${VARIABLE}` syntax.

**What it does:** Defines four environment variables used by the database and both apps. Docker Compose automatically loads this file.

```
DB_ROOT_PASSWORD=rootpassword
DB_NAME=jokedb
DB_USER=jokeuser
DB_PASSWORD=jokepassword
```

- These values are referenced in `docker-compose.yml` using `${DB_NAME}` syntax.
- In production, you'd use stronger passwords and possibly a secrets manager.
- The `.env` file is **not** baked into Docker images — it's read at `docker-compose up` time and injected as environment variables.

**Key terms to know:** Environment variables, Docker Compose `.env` file, secret management

---

### 📄 `co3404-option1/db-init/init.sql`
**Purpose:** Creates the database schema (tables) and seeds initial joke data.

**What it does:** Runs once on first MySQL startup. Creates two tables with a foreign key relationship and inserts 20 jokes across 4 categories.

**Code walkthrough:**

```sql
CREATE TABLE IF NOT EXISTS types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS jokes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setup TEXT NOT NULL,
  punchline TEXT NOT NULL,
  type_id INT NOT NULL,
  FOREIGN KEY (type_id) REFERENCES types(id)
);
```
- **`types` table** — Stores joke categories (general, programming, dad, knock-knock). `UNIQUE` prevents duplicate types.
- **`jokes` table** — Each joke has a setup, punchline, and a `type_id` that references the `types` table.
- **Foreign key** — `type_id` REFERENCES `types(id)` enforces **referential integrity**: you can't insert a joke with a type that doesn't exist. This is a relational database concept.
- **`AUTO_INCREMENT`** — MySQL automatically assigns incrementing IDs.

```sql
INSERT INTO types (type) VALUES ('general'), ('programming'), ('dad'), ('knock-knock');

INSERT INTO jokes (setup, punchline, type_id) VALUES
  ('What do you call a fake noodle?', 'An impasta.', 1),
  ...
```
- Seeds 4 types and 5 jokes per type (20 total). The `type_id` values (1-4) correspond to the auto-incremented IDs from the `types` insert.

**Key terms to know:** SQL schema, foreign key, referential integrity, AUTO_INCREMENT, seed data, `docker-entrypoint-initdb.d`

---

### 📄 `co3404-option1/joke-app/Dockerfile`
**Purpose:** Instructions for Docker to build the joke-app container image.

**What it does:** Creates a lightweight Node.js container, installs dependencies, copies code, and sets the startup command.

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```
- **`FROM node:18-alpine`** — Base image. Alpine Linux is ~5MB vs ~900MB for full Ubuntu. Smaller = faster builds and deploys.
- **`WORKDIR /app`** — Sets the working directory inside the container. All subsequent commands run here.
- **`COPY package*.json` then `RUN npm install`** — This is a **Docker layer caching optimization**. By copying package files first, Docker only re-runs `npm install` when dependencies change. If you only change `server.js`, Docker reuses the cached `node_modules` layer.
- **`COPY . .`** — Copies everything else (server.js, public/, etc.) into the container.
- **`EXPOSE 3000`** — Documentation that this container listens on port 3000. Doesn't actually open the port — that's done by `ports:` in docker-compose.yml.
- **`CMD ["node", "server.js"]`** — The command that runs when the container starts.

**Key terms to know:** Dockerfile, Docker layer caching, Alpine Linux, EXPOSE vs ports mapping, multi-stage builds

---

### 📄 `co3404-option1/joke-app/package.json`
**Purpose:** Declares Node.js dependencies and project metadata.

```json
"dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.6.0",
    "cors": "^2.8.5"
}
```
- **express** — Web framework for creating HTTP endpoints (GET, POST routes).
- **mysql2** — MySQL driver for Node.js. The `2` version supports Promises/async-await natively.
- **cors** — Middleware that adds `Access-Control-Allow-Origin` headers. Needed because the frontend and API may be on different ports/domains.

**Key terms to know:** npm, package.json, semantic versioning (`^4.18.2` means "any 4.x.x >= 4.18.2"), CORS

---

### 📄 `co3404-option1/joke-app/db.js`
**Purpose:** Creates a reusable MySQL connection pool that `server.js` imports.

**What it does:** Instead of creating a new database connection for every request (slow and wasteful), it creates a **pool** of 10 connections that are reused.

```javascript
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'database',
  user: process.env.DB_USER || 'jokeuser',
  password: process.env.DB_PASSWORD || 'jokepassword',
  database: process.env.DB_NAME || 'jokedb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool.promise();
```
- **`host: process.env.DB_HOST || 'database'`** — Reads from environment variable first, falls back to `'database'` (the Docker DNS name). This makes it work both in Docker and locally.
- **`connectionLimit: 10`** — Max 10 simultaneous connections. Prevents overwhelming MySQL.
- **`waitForConnections: true`** — If all 10 connections are in use, new requests wait instead of failing.
- **`queueLimit: 0`** — No limit on how many requests can wait.
- **`pool.promise()`** — Returns a promise-based wrapper so we can use `async/await` syntax instead of callbacks.

**Connects to:** `server.js` (imports this module), MySQL container (connects to it)

**Key terms to know:** Connection pool, async/await, environment variables, module.exports

---

### 📄 `co3404-option1/joke-app/server.js`
**Purpose:** The main Express server — serves the frontend and API endpoints for fetching jokes.

**What it does:** Creates two API endpoints (`GET /types` and `GET /joke/:type`), serves static frontend files, and listens on port 3000.

**Code walkthrough:**

```javascript
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
```
- **`app.use(cors())`** — Allows requests from any origin. Without this, browsers would block API calls from a different domain/port.
- **`app.use(express.json())`** — Parses JSON request bodies (needed for POST requests).
- **`app.use(express.static('public'))`** — Serves HTML/CSS/JS files from the `public/` directory. When you visit `http://localhost:4000`, Express serves `public/index.html`.

```javascript
app.get('/types', async (req, res) => {
    const [rows] = await db.query('SELECT type FROM types ORDER BY type');
    const types = rows.map(row => row.type);
    res.json(types);
});
```
- **`async/await`** — The database query is asynchronous (doesn't block other requests while waiting).
- **`const [rows]`** — mysql2 returns `[rows, fields]`. We destructure to get just the rows.
- **`.map(row => row.type)`** — Transforms `[{type: "dad"}, {type: "general"}]` into `["dad", "general"]` — a flat array for the frontend dropdown.

```javascript
app.get('/joke/:type', async (req, res) => {
    const { type } = req.params;
    const count = parseInt(req.query.count) || 1;

    if (type === 'any') {
        query = `SELECT j.setup, j.punchline, t.type FROM jokes j
                 JOIN types t ON j.type_id = t.id ORDER BY RAND() LIMIT ?`;
        params = [count];
    } else {
        // Validate type exists first
        const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
        if (typeRows.length === 0) {
            return res.status(404).json({ error: `Joke type '${type}' not found` });
        }
        query = `... WHERE t.type = ? ORDER BY RAND() LIMIT ?`;
        params = [type, count];
    }
    const [jokes] = await db.query(query, params);
    res.json(jokes);
});
```
- **`:type`** — Express route parameter. `/joke/dad` sets `req.params.type` to `"dad"`.
- **`?count=N`** — Query string parameter. `/joke/dad?count=3` returns 3 random dad jokes.
- **`ORDER BY RAND() LIMIT ?`** — MySQL randomly sorts all matching rows, then takes the first N. Simple but not efficient for huge datasets (shuffles entire result set).
- **`JOIN types t ON j.type_id = t.id`** — SQL JOIN links jokes to their type names.
- **Parameterized queries (`?` placeholders)** — Prevents SQL injection. The values are escaped by mysql2 before being sent to the database.

**Connects to:** `db.js` (database pool), `public/` (frontend files)

**Key terms to know:** REST API, Express routing, route parameters, query strings, SQL JOIN, ORDER BY RAND(), SQL injection prevention, parameterized queries

---

### 📄 `co3404-option1/joke-app/public/index.html`
**Purpose:** Frontend HTML for the joke display page.

**What it does:** Provides a dropdown to select joke types, a button to fetch a joke, and a display area for the setup/punchline.

- Simple structure: dropdown (`<select>`), button, and two `<p>` elements for setup/punchline.
- The `hidden` class is toggled by JavaScript to show/hide elements.
- Links to `style.css` and `script.js`.

**Key terms to know:** Semantic HTML, DOM elements, CSS class toggling

---

### 📄 `co3404-option1/joke-app/public/script.js`
**Purpose:** Frontend JavaScript — handles API calls and DOM updates for the joke display page.

**Code walkthrough:**

```javascript
async function loadTypes() {
    const res = await fetch('/types');
    const types = await res.json();
    typeSelect.innerHTML = '<option value="any">Any</option>';
    types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        typeSelect.appendChild(option);
    });
}
```
- **`fetch('/types')`** — Makes an HTTP GET request to the same server (relative URL). Works because Express serves both the frontend and API.
- **`.charAt(0).toUpperCase() + type.slice(1)`** — Capitalizes the first letter for display (e.g., "dad" → "Dad").
- Called on page load AND whenever the dropdown is focused/clicked — ensures the dropdown stays current if new types are added.

```javascript
async function getJoke() {
    const res = await fetch(`/joke/${type}`);
    const jokes = await res.json();
    jokeSetup.textContent = joke.setup;
    setTimeout(() => {
        jokePunchline.textContent = joke.punchline;
        jokePunchline.classList.remove('hidden');
    }, 3000);
}
```
- **Template literal** — `` `/joke/${type}` `` inserts the selected type into the URL.
- **`setTimeout(..., 3000)`** — Delays punchline reveal by 3 seconds for comedic effect.
- **`classList.remove('hidden')`** — Shows the hidden punchline element.

**Key terms to know:** Fetch API, DOM manipulation, async/await, template literals, setTimeout

---

### 📄 `co3404-option1/joke-app/public/style.css`
**Purpose:** Styles the joke display page with a clean, modern card layout.

- Uses **CSS custom properties** (`:root { --primary-color: #2563EB; }`) for consistent theming.
- Card-based layout with shadow and rounded corners.
- **`@keyframes fadeIn`** — Animates the punchline sliding in.
- **`.hidden { display: none !important; }`** — Used by JavaScript to show/hide elements.
- Responsive: uses flexbox and `@media (min-width: 640px)` to adjust layout on larger screens.

---

### 📄 `co3404-option1/submit-app/Dockerfile`
**Purpose:** Identical to joke-app's Dockerfile except it exposes port 3200.

Same Docker layer caching pattern: copy `package.json` first, `npm install`, then copy source.

---

### 📄 `co3404-option1/submit-app/package.json`
**Purpose:** Dependencies for the submit app.

```json
"dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.6.0",
    "cors": "^2.8.5",
    "swagger-jsdoc": "^6.2.8",
    "swagger-ui-express": "^5.0.0"
}
```
- **swagger-jsdoc** — Generates OpenAPI spec from JSDoc comments in server.js.
- **swagger-ui-express** — Serves an interactive API documentation page at `/docs`.

**Key terms to know:** Swagger/OpenAPI, API documentation

---

### 📄 `co3404-option1/submit-app/db.js`
**Purpose:** MySQL connection pool for the submit app — identical to joke-app's `db.js`.

Same pool configuration. Both apps connect to the same `database` container using Docker DNS.

---

### 📄 `co3404-option1/submit-app/swagger.js`
**Purpose:** Configures Swagger/OpenAPI documentation generation.

```javascript
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Joke Submission API',
            version: '1.0.0',
            description: 'API for submitting new jokes to the joke database',
        },
        servers: [{ url: 'http://localhost:4200', description: 'Docker-mapped port' }],
    },
    apis: ['./server.js'],  // Look for @openapi annotations here
};
```
- **`apis: ['./server.js']`** — swagger-jsdoc scans `server.js` for `@openapi` JSDoc comments and generates the API spec from them.
- The generated spec is used by swagger-ui-express to render the interactive docs at `/docs`.

**Key terms to know:** OpenAPI 3.0 specification, JSDoc annotations, Swagger UI

---

### 📄 `co3404-option1/submit-app/server.js`
**Purpose:** Express server for submitting new jokes directly to MySQL.

**Code walkthrough:**

```javascript
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```
- Mounts Swagger UI at `/docs` — you can browse and test the API interactively in a browser.

```javascript
app.post('/submit', async (req, res) => {
    const { setup, punchline, type, isNewType } = req.body;

    if (!setup || !punchline || !type) {
        return res.status(400).json({ error: 'Missing required fields...' });
    }

    if (isNewType) {
        await db.query('INSERT IGNORE INTO types (type) VALUES (?)', [type]);
    }

    const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
    const typeId = typeRows[0].id;

    const [result] = await db.query(
        'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
        [setup, punchline, typeId]
    );

    res.status(201).json({ message: 'Joke submitted successfully!', jokeId: result.insertId });
});
```
- **`req.body` destructuring** — Extracts fields from the JSON request body.
- **Validation** — Returns 400 if any required field is missing. Client-side validation exists too, but server-side is essential (never trust the client).
- **`INSERT IGNORE`** — Inserts a new type if `isNewType` is true. The `IGNORE` keyword means "don't error if the type already exists" (because of the UNIQUE constraint on `types.type`).
- **Two-step insert** — First looks up the `type_id`, then inserts the joke. This is needed because the jokes table uses a foreign key reference.
- **`result.insertId`** — MySQL returns the auto-generated ID of the newly inserted row.

**Connects to:** `db.js` (MySQL pool), `swagger.js` (API docs), `public/` (frontend)

**Key terms to know:** POST request, request body parsing, INSERT IGNORE, input validation, HTTP status codes (400, 201, 500)

---

### 📄 `co3404-option1/submit-app/public/index.html`
**Purpose:** Frontend form for submitting jokes.

Contains: two textareas (setup, punchline), a type dropdown, a checkbox to toggle "add new type" mode, and a submit button. The `hidden` class is used to show/hide the new type input field.

---

### 📄 `co3404-option1/submit-app/public/script.js`
**Purpose:** Frontend JavaScript for the submission form — handles validation, API calls, and feedback.

**Code walkthrough:**

```javascript
newTypeToggle.addEventListener('change', () => {
    if (newTypeToggle.checked) {
        typeSelect.classList.add('hidden');
        newTypeInput.classList.remove('hidden');
    } else {
        typeSelect.classList.remove('hidden');
        newTypeInput.classList.add('hidden');
    }
});
```
- Toggles between the dropdown and a text input when the user checks "Add a new type instead".

```javascript
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = isNewType ? newTypeInput.value.trim() : typeSelect.value;

    const res = await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup, punchline, type, isNewType }),
    });

    if (res.ok) {
        showFeedback(data.message, 'success');
        form.reset();
        loadTypes();  // Refresh dropdown to include new type
    }
});
```
- **`e.preventDefault()`** — Prevents the default form submission (which would reload the page).
- **`JSON.stringify()`** — Converts the JavaScript object to a JSON string for the request body.
- **After success**: resets the form, refreshes the type dropdown (to include any newly created type).

**Key terms to know:** Form submission, preventDefault, JSON.stringify, fetch POST

---

### 📄 `co3404-option1/submit-app/public/style.css`
**Purpose:** Styles for the submission form — matches the joke-app's design language.

Same CSS variable system as joke-app. Adds `.feedback.success` (green) and `.feedback.error` (red) styles for submission status messages.

---

# PHASE 2: OPTION 2 — JOKE MICROSERVICE (VM1)

Option 2 splits the monolith into microservices. The joke-microservice runs on VM1 with the database, joke-app, and a new ETL service.

---

### 📄 `co3404-option2/joke-microservice/docker-compose.yml`
**Purpose:** Defines VM1's services: MySQL OR MongoDB database, joke-app, and ETL consumer.

**What it does:** Uses Docker Compose **profiles** to support either MySQL or MongoDB as the database backend. The `joke` and `etl` services connect to whichever database is active.

**Code walkthrough:**

```yaml
  database:
    image: mysql:8.0
    profiles: [ "mysql" ]
    ...

  mongodb:
    image: mongo:7.0
    profiles: [ "mongo" ]
    ...
```
- **Profiles** — `profiles: ["mysql"]` means this service only starts when you run `docker compose --profile mysql up`. This lets you switch databases without changing the compose file.
- **`docker compose --profile mongo up`** starts MongoDB instead of MySQL.

```yaml
  etl:
    build: ./etl
    environment:
      RABBITMQ_URL: amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_IP}:5672
      DB_TYPE: ${DB_TYPE}
```
- **`RABBITMQ_URL`** — The ETL connects to RabbitMQ on a **different VM** (VM5) using its private IP. This is the cross-VM communication.
- **`DB_TYPE`** — Tells the app whether to use MySQL or MongoDB (used by the `db/index.js` adapter pattern).
- No `depends_on` for RabbitMQ here because RabbitMQ runs on a different VM. The ETL handles this with retry logic instead.

**Connects to:** `.env`, `joke-app/Dockerfile`, `etl/Dockerfile`, `db-init/init.sql`

**Key terms to know:** Docker Compose profiles, AMQP URL format, cross-VM communication, environment variable interpolation

---

### 📄 `co3404-option2/joke-microservice/.env`
**Purpose:** Configuration for VM1 services.

```
DB_TYPE=mysql
DB_HOST=database
DB_ROOT_PASSWORD=rootpassword
DB_NAME=jokedb
DB_USER=jokeuser
DB_PASSWORD=jokepassword
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_IP=host.docker.internal
```
- **`DB_TYPE=mysql`** — Controls which database adapter is loaded. Change to `mongo` for MongoDB.
- **`RABBITMQ_IP=host.docker.internal`** — For local testing, this resolves to the host machine. In production, replace with the actual VM5 private IP (e.g., `10.0.0.8`).

---

### 📄 `co3404-option2/joke-microservice/db-init/init.sql`
**Purpose:** Same as Option 1 — creates MySQL schema and seeds 20 jokes.

Identical to `co3404-option1/db-init/init.sql`. Only runs when using the `mysql` profile.

---

### 📄 `co3404-option2/joke-microservice/joke-app/db/index.js`
**Purpose:** Database adapter factory — picks MySQL or MongoDB based on environment variable.

```javascript
const dbType = process.env.DB_TYPE || 'mysql';

if (dbType === 'mongo') {
    module.exports = require('./mongo-adapter');
} else {
    module.exports = require('./mysql-adapter');
}
```
- **Adapter Pattern** — This is a software design pattern. The rest of the code calls `db.query(...)` without knowing whether it's talking to MySQL or MongoDB. The adapter translates the call to the correct database API.
- **Why:** Option 4 requires demonstrating a second database. This pattern lets you switch with just an environment variable change.

**Key terms to know:** Adapter pattern, dependency injection (via env var), database abstraction

---

### 📄 `co3404-option2/joke-microservice/joke-app/db/mysql-adapter.js`
**Purpose:** MySQL connection pool — identical to Option 1's `db.js`.

Same `mysql.createPool()` with promise wrapper. Exported so `server.js` can call `db.query(...)`.

---

### 📄 `co3404-option2/joke-microservice/joke-app/db/mongo-adapter.js`
**Purpose:** MongoDB adapter that emulates mysql2's `db.query()` interface.

**What it does:** Translates SQL query strings into MongoDB operations. This is a compatibility layer so the server.js code doesn't need to change when switching databases.

**Code walkthrough:**

```javascript
const adapter = {
    query: async function (queryString, params = []) {
        const db = await getDb();

        // Simulate: 'SELECT type FROM types ORDER BY type'
        if (queryString.includes('SELECT type FROM types')) {
            const types = await db.collection('types')
                .find({}, { projection: { type: 1, _id: 0 } })
                .sort({ type: 1 }).toArray();
            return [types];
        }

        // Simulate: random jokes query
        if (queryString.includes('SELECT j.setup') && queryString.includes('ORDER BY RAND()')) {
            const pipeline = [];
            if (!isAny) pipeline.push({ $match: { type: params[0] } });
            pipeline.push({ $sample: { size: parseInt(count) || 1 } });
            pipeline.push({ $project: { _id: 0, setup: 1, punchline: 1, type: 1 } });
            const jokes = await db.collection('jokes').aggregate(pipeline).toArray();
            return [jokes];
        }
        ...
    }
};
```
- **String matching on SQL** — Detects which query is being made by checking for SQL keywords. Not elegant, but practical for a small app with a fixed set of queries.
- **`$sample`** — MongoDB's equivalent of `ORDER BY RAND() LIMIT N`. More efficient than MySQL's approach for large collections.
- **`$project`** — Selects which fields to include (like SQL's SELECT column list).
- **`$match`** — Filters documents (like SQL's WHERE clause).
- **`updateOne` with `upsert: true`** — The MongoDB equivalent of `INSERT IGNORE`. If the type exists, do nothing; if not, insert it.
- **Return format `[results]`** — Wraps results in an array to match mysql2's `[rows, fields]` destructuring pattern.

**Key terms to know:** MongoDB aggregation pipeline, $sample, $match, $project, upsert, adapter pattern

---

### 📄 `co3404-option2/joke-microservice/joke-app/server.js`
**Purpose:** Same as Option 1's joke-app server, with an added route alias for Kong.

**What changed from Option 1:**
```javascript
const db = require('./db'); // Now resolves to db/index.js (adapter pattern)

// NEW: Alias for Kong routing
app.get('/joke-types', async (req, res) => { ... });
```
- **`require('./db')`** — Now resolves to `db/index.js` which picks the right adapter.
- **`/joke-types` route** — A duplicate of `/types`. Kong uses path-based routing, and this alias lets Kong route `/joke-types` directly without needing to strip/rewrite paths. The frontend calls `/joke-types` when accessed through Kong.

---

### 📄 `co3404-option2/joke-microservice/joke-app/public/script.js`
**Purpose:** Same as Option 1, except `loadTypes()` now calls `/joke-types` instead of `/types`.

```javascript
const res = await fetch('/joke-types');
```
- This change makes the frontend work through Kong's reverse proxy, which routes `/joke-types` to this server.

---

### 📄 `co3404-option2/joke-microservice/joke-app/public/style.css`
**Purpose:** Upgraded "premium" dark theme with glassmorphism effects.

Different from Option 1's clean/light theme — uses dark gradient background, blur effects (`backdrop-filter: blur(12px)`), floating animated orbs, and gradient text.

---

### 📄 `co3404-option2/joke-microservice/etl/Dockerfile`
**Purpose:** Docker image for the ETL (Extract-Transform-Load) service.

Same pattern as other Dockerfiles. Exposes port 3001 and runs `etl.js`.

---

### 📄 `co3404-option2/joke-microservice/etl/package.json`
**Purpose:** ETL service dependencies.

```json
"dependencies": {
    "amqplib": "^0.10.3",
    "mongodb": "^7.1.0",
    "mysql2": "^3.6.0"
}
```
- **amqplib** — AMQP 0-9-1 client for Node.js. Used to connect to RabbitMQ and consume messages.
- Both database drivers are included to support the adapter pattern.

---

### 📄 `co3404-option2/joke-microservice/etl/db/index.js`, `mysql-adapter.js`, `mongo-adapter.js`
**Purpose:** Same adapter pattern as joke-app's `db/` directory.

Identical code — provides `db.query()` that works with either MySQL or MongoDB depending on `DB_TYPE`.

---

### 📄 `co3404-option2/joke-microservice/etl/etl.js`
**Purpose:** RabbitMQ consumer — reads jokes from the queue and writes them to the database.

**What it does:** This is the "glue" between the Submit microservice (VM2) and the database (VM1). It runs continuously, waiting for messages on the `MODERATED_JOKES` queue. When a joke arrives, it inserts it into the database.

**Code walkthrough:**

```javascript
const QUEUE_NAME = 'MODERATED_JOKES';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@10.0.0.5:5672';
```
- Consumes from `MODERATED_JOKES` (jokes that have been approved by the moderator).

```javascript
async function connectWithRetry(url, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await amqplib.connect(url);
            console.log('Connected to RabbitMQ');
            return connection;
        } catch (err) {
            console.log(`RabbitMQ not ready, retrying in ${delay / 1000}s...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    throw new Error('Failed to connect to RabbitMQ after retries');
}
```
- **Retry pattern** — RabbitMQ might not be ready when the ETL starts (especially on first boot). Instead of crashing, it retries up to 10 times with 5-second delays. This is essential for distributed systems where services start independently.

```javascript
async function processMessage(channel, msg) {
    const data = JSON.parse(msg.content.toString());
    const { setup, punchline, type, isNewType } = data;

    if (isNewType) {
        await db.query('INSERT IGNORE INTO types (type) VALUES (?)', [type]);

        // Publish type update event
        const [allTypesRows] = await db.query('SELECT type FROM types ORDER BY type');
        const allTypes = allTypesRows.map(row => row.type);
        const exchange = 'type_update';
        await channel.assertExchange(exchange, 'fanout', { durable: true });
        channel.publish(exchange, '', Buffer.from(JSON.stringify(allTypes)));
    }

    const [typeRows] = await db.query('SELECT id FROM types WHERE type = ?', [type]);
    const typeId = typeRows[0].id;
    await db.query('INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
        [setup, punchline, typeId]);

    channel.ack(msg);  // Remove from queue
}
```
- **Message acknowledgement (`channel.ack`)** — Tells RabbitMQ "I processed this successfully, delete it from the queue." If the ETL crashes before ack, the message stays in the queue and is redelivered — this is **at-least-once delivery**.
- **`channel.nack(msg, false, true)`** (in catch block) — Negative acknowledgement with requeue. Tells RabbitMQ "processing failed, put the message back."
- **Type update event** — When a new type is created, the ETL publishes to a `type_update` fanout exchange. This notifies the Submit and Moderate services to update their type caches. This is **event-driven architecture**.
- **`assertExchange('type_update', 'fanout')`** — A fanout exchange broadcasts messages to ALL bound queues. Unlike a direct exchange, it doesn't use routing keys.

```javascript
async function main() {
    const connection = await connectWithRetry(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    channel.prefetch(1);
    channel.consume(QUEUE_NAME, (msg) => {
        if (msg !== null) processMessage(channel, msg);
    });
}
```
- **`assertQueue(QUEUE_NAME, { durable: true })`** — Creates the queue if it doesn't exist, or verifies it exists. `durable: true` means the queue definition survives broker restarts.
- **`prefetch(1)`** — Tells RabbitMQ "only give me 1 unacknowledged message at a time." This prevents the ETL from being overwhelmed and ensures messages are processed sequentially.
- **`channel.consume()`** — Registers a callback that runs for each incoming message. This is a **push-based** consumer (RabbitMQ pushes messages to the callback).

**Connects to:** RabbitMQ (consumes from MODERATED_JOKES queue, publishes to type_update exchange), Database (writes jokes)

**Key terms to know:** ETL (Extract-Transform-Load), message queue consumer, message acknowledgement, at-least-once delivery, prefetch, durable queue, fanout exchange, event-driven architecture, retry pattern

---

### 📄 `co3404-option2/joke-microservice/mongo-init/init.js`
**Purpose:** MongoDB seed script — equivalent of `init.sql` for when using MongoDB profile.

```javascript
db = db.getSiblingDB('jokedb');

db.types.insertMany([
    { type: 'general' }, { type: 'programming' }, { type: 'dad' }, { type: 'knock-knock' }
]);

db.jokes.insertMany([
    { setup: '...', punchline: '...', type: 'general' },
    ...
]);
```
- **`getSiblingDB('jokedb')`** — Switches to the `jokedb` database.
- **No foreign keys** — MongoDB stores the type name directly in each joke document instead of using a type_id reference. This is the document-oriented approach (denormalized vs normalized).
- Mounted at `/docker-entrypoint-initdb.d` in the MongoDB container, same pattern as MySQL's init.sql.

**Key terms to know:** MongoDB, document-oriented database, denormalization, insertMany

---

# PHASE 3: OPTION 2 — SUBMIT MICROSERVICE (VM2)

The submit-microservice runs on VM2. It publishes jokes to RabbitMQ instead of writing directly to the database.

---

### 📄 `co3404-option2/submit-microservice/docker-compose.yml`
**Purpose:** Defines VM2's services: just the submit-app (RabbitMQ runs separately on VM5).

```yaml
services:
  submit:
    build: ./submit-app
    ports:
      - "4200:3200"
    environment:
      RABBITMQ_URL: amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_IP}:5672
      JOKE_SERVICE_URL: http://${VM1_PRIVATE_IP}:4000
    volumes:
      - types-cache:/data
```
- **`RABBITMQ_URL`** — Connects to RabbitMQ on VM5 using its private IP.
- **`JOKE_SERVICE_URL`** — (Defined but the actual fetching is done via the type_update event now, see server.js)
- **`types-cache:/data`** — Docker volume mounted at `/data` inside the container. The app writes `types-cache.json` here so type data persists across container restarts.

---

### 📄 `co3404-option2/submit-microservice/.env`
**Purpose:** Configuration for VM2.

```
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
VM1_PRIVATE_IP=localhost
RABBITMQ_IP=host.docker.internal
```
- `host.docker.internal` is for local testing. In production, replace with real Azure private IPs.

---

### 📄 `co3404-option2/submit-microservice/submit-app/server.js`
**Purpose:** Express server that publishes jokes to RabbitMQ (no database connection).

**This is the biggest change from Option 1.** The submit app no longer touches the database. It's now a **producer** that publishes messages to a queue.

**Code walkthrough:**

```javascript
const QUEUE_NAME = 'SUBMITTED_JOKES';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const CACHE_FILE = '/data/types-cache.json';
```
- **`SUBMITTED_JOKES`** — The queue where new joke submissions go. The moderate service pulls from this queue.

```javascript
async function connectRabbitMQ(retries = 10, delay = 5000) {
    ...
    const connection = await amqplib.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    rabbitChannel = channel;

    // Subscribe to type_update exchange
    const subChannel = await connection.createChannel();
    await subChannel.assertExchange('type_update', 'fanout', { durable: true });
    const q = await subChannel.assertQueue('sub_type_update', { durable: true });
    await subChannel.bindQueue(q.queue, 'type_update', '');

    subChannel.consume(q.queue, (msg) => {
        const types = JSON.parse(msg.content.toString());
        writeCache(types);
        subChannel.ack(msg);
    });
    ...
}
```
- Creates TWO channels: one for publishing jokes, one for subscribing to type updates.
- **Type update subscription** — Listens on the `type_update` fanout exchange. When the ETL creates a new joke type, it publishes an event. The submit app receives it and updates its local cache file. This means the submit app's type dropdown always stays current without polling the joke service.
- **`assertQueue('sub_type_update')`** — Creates a named, durable queue for this subscriber. Using a named queue (vs anonymous) means messages are preserved if the submit app restarts.
- **`bindQueue`** — Connects the subscriber's queue to the fanout exchange.

```javascript
function writeCache(types) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(types));
}

function readCache() {
    if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    return [];
}
```
- **File-based cache** — Types are stored as a JSON file on a Docker volume (`/data/types-cache.json`). This provides fault tolerance: if the joke service is down, the submit app can still show types from cache.

```javascript
app.get('/types', (req, res) => {
    const types = readCache();
    res.json(types);
});
```
- **Event-driven types** — Instead of fetching types from the joke service on every request, it reads from the local cache file which is kept up-to-date by the RabbitMQ type_update event.

```javascript
app.post('/submit', async (req, res) => {
    if (!rabbitChannel) {
        return res.status(503).json({ error: 'Message queue is temporarily unavailable.' });
    }

    const message = JSON.stringify({ setup, punchline, type, isNewType: !!isNewType });
    rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
        persistent: true,
    });

    res.status(201).json({ message: 'Joke submitted successfully! It will appear after processing.' });
});
```
- **`sendToQueue`** — Publishes the joke as a message to the `SUBMITTED_JOKES` queue.
- **`persistent: true`** — Message is written to disk, not just held in memory. Survives RabbitMQ restart.
- **`Buffer.from(message)`** — RabbitMQ messages are binary buffers.
- **503 status** — Returns "Service Unavailable" if RabbitMQ isn't connected yet.
- **Immediate response** — Returns success immediately. The joke hasn't been inserted into the database yet — it's sitting in the queue waiting for the moderator to approve it.

```javascript
// On startup: seed cache with default types if empty
if (readCache().length === 0) {
    writeCache(["general", "programming", "dad", "knock-knock"]);
}
```
- Ensures the cache has initial values on first boot before any type_update events arrive.

**Connects to:** RabbitMQ (publishes to SUBMITTED_JOKES, subscribes to type_update), local cache file

**Key terms to know:** Message queue producer, persistent messages, fanout exchange subscription, file-based caching, event-driven updates, 503 Service Unavailable

---

### 📄 `co3404-option2/submit-microservice/submit-app/swagger.js`
**Purpose:** Updated Swagger config reflecting the queue-based architecture.

Version bumped to 2.0.0. Description mentions RabbitMQ and asynchronous processing.

---

### 📄 `co3404-option2/submit-microservice/submit-app/public/script.js`
**Purpose:** Frontend JS for the submit form.

**Key difference from Option 1:**
```javascript
const res = await fetch('/submit-types');
```
- Calls `/submit-types` instead of `/types` — this alias routes correctly through Kong.

---

### 📄 `co3404-option2/submit-microservice/submit-app/public/style.css`
**Purpose:** Premium dark theme matching the joke-app's upgraded design.

Same glassmorphism/gradient design language as Option 2's joke-app.

---

# PHASE 4: OPTION 3 — KONG API GATEWAY (VM3)

Kong acts as a reverse proxy / API gateway on VM3. All user traffic goes through Kong, which routes requests to the correct backend microservice.

---

### 📄 `co3404-option2/kong-gateway/docker-compose.yml`
**Purpose:** Runs Kong API Gateway in DB-less (declarative) mode.

```yaml
services:
  kong:
    image: kong/kong-gateway:3.4
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /etc/kong/kong.yaml
      KONG_PROXY_LISTEN: "0.0.0.0:8000, 0.0.0.0:8443 ssl"
      KONG_ADMIN_LISTEN: "0.0.0.0:8444 ssl"
      KONG_SSL_CERT: /etc/kong/certs/cert.pem
      KONG_SSL_CERT_KEY: /etc/kong/certs/key.pem
    ports:
      - "80:8000"      # HTTP proxy
      - "443:8443"     # HTTPS proxy
      - "8445:8444"    # Admin API (HTTPS)
    volumes:
      - ./kong.yaml:/etc/kong/kong.yaml:ro
      - ./certs:/etc/kong/certs:ro
```
- **`KONG_DATABASE: "off"`** — DB-less mode. Kong reads its entire configuration from a YAML file instead of a database. Simpler to deploy and manage.
- **`KONG_DECLARATIVE_CONFIG`** — Points to the YAML file with all routing rules.
- **Port 80 → 8000** — Users access the gateway on standard HTTP port 80. Kong's internal proxy listens on 8000.
- **Port 443 → 8443** — HTTPS with SSL/TLS. Uses the self-signed certificates from `certs/`.
- **`:ro`** — Read-only volume mount. Kong only reads these files.

**Key terms to know:** API Gateway, reverse proxy, DB-less mode, declarative configuration, SSL/TLS, port mapping

---

### 📄 `co3404-option2/kong-gateway/kong.yaml`
**Purpose:** Declarative routing rules — tells Kong how to forward requests to backend services. All routes explicitly support both HTTPS and HTTP protocols.

**Code walkthrough:**

```yaml
_format_version: "3.0"

# TLS is configured via KONG_SSL_CERT and KONG_SSL_CERT_KEY environment
# variables in docker-compose.yml, using mkcert-generated certificates
# stored in ./certs/cert.pem and ./certs/key.pem

services:
  - name: joke-service
    url: http://10.0.0.4:4000
    routes:
      - name: joke-route
        paths:
          - /joke
        strip_path: false
        protocols:
          - https
          - http
      - name: joke-types-route
        paths:
          - /joke-types
        strip_path: false
        protocols:
          - https
          - http
    plugins:
      - name: rate-limiting
        config:
          minute: 5
          policy: local
          fault_tolerant: true
          hide_client_headers: false
```
- **`url: http://10.0.0.4:4000`** — VM1's private IP. Kong forwards matching requests to this URL. Note: the backend connection is HTTP (TLS terminates at Kong).
- **`paths: [/joke]`** — Any request starting with `/joke` is routed to the joke service.
- **`strip_path: false`** — The path is preserved when forwarding. `/joke/dad` is sent as `/joke/dad` to the backend (not stripped to `/dad`).
- **`protocols: [https, http]`** — Explicitly declares that this route accepts both HTTPS (port 443) and HTTP (port 80) traffic. This is the TLS configuration at the route level — Kong handles TLS termination using the mkcert certificates configured in `docker-compose.yml`.
- **Rate limiting plugin** — Limits to 5 requests per minute per client. `policy: local` means the counter is stored in Kong's memory (not a shared database). `fault_tolerant: true` means Kong still proxies requests if the rate limiter fails.

```yaml
  - name: submit-service
    url: http://10.0.0.5:4200
    routes:
      - name: submit-route
        paths: [/submit]
        protocols: [https, http]
      - name: submit-types-route
        paths: [/submit-types]
        protocols: [https, http]
      - name: docs-route
        paths: [/docs]
        protocols: [https, http]
```
- Routes submit-related paths to VM2. All routes support HTTPS and HTTP.

```yaml
  - name: moderate-service
    url: http://10.0.0.5:4100
    routes:
      - name: moderate-route
        paths: [/moderate]
        protocols: [https, http]
      - name: auth-status-route
        paths: [/auth-status]
        protocols: [https, http]
      - name: login-route
        paths: [/login]
        protocols: [https, http]
      - name: default-route
        paths: [/]
        protocols: [https, http]
```
- Routes moderation-related paths to VM2 (moderate service).
- **`/` default route** — The moderate service serves the default landing page.
- Auth routes (`/login`, `/logout`, `/callback`) are also routed to the moderate service for OIDC authentication flow.
- All routes support HTTPS for secure authentication flows.

**TLS Architecture:**
```
Client --HTTPS (443)--> Kong (TLS terminates here) --HTTP--> Backend services
```
Kong performs **TLS termination**: it decrypts incoming HTTPS traffic using the mkcert certificates, then forwards plain HTTP to the backend microservices on the private network. This is standard practice — internal traffic on a private VNet doesn't need encryption.

**Connects to:** VM1 joke-app (10.0.0.4:4000), VM2 submit-app (10.0.0.5:4200), VM2 moderate-app (10.0.0.5:4100)

**Key terms to know:** Kong declarative config, service/route/plugin model, path-based routing, rate limiting, strip_path, reverse proxy, TLS termination, HTTPS protocols

---

### 📄 `co3404-option2/kong-gateway/certs/cert.pem` and `key.pem`
**Purpose:** TLS certificates generated with **mkcert** for HTTPS on Kong.

- **cert.pem** — The public certificate. Sent to clients during the TLS handshake. Generated by mkcert (a tool that creates locally-trusted development certificates).
- **key.pem** — The private key. Used by Kong to decrypt incoming HTTPS traffic. Never committed to version control in production.
- **mkcert** — Unlike plain self-signed certificates, mkcert installs a local Certificate Authority (CA) on your machine. Certificates it generates are trusted by your local browser without security warnings.
- **Certificate validity** — Valid from 2026-03-06 to 2028-06-06 (2+ years).
- **SANs (Subject Alternative Names)** — The certificate is valid for `localhost` and the Kong VM's public IP (`20.100.190.184`).
- **How they're loaded** — Kong reads these files via the `KONG_SSL_CERT` and `KONG_SSL_CERT_KEY` environment variables in `docker-compose.yml`. The certs directory is mounted as a read-only volume (`./certs:/etc/kong/certs:ro`).

**Key terms to know:** SSL/TLS, mkcert, Certificate Authority (CA), public/private key pair, HTTPS, Subject Alternative Names (SANs), TLS termination

---

### 📄 `co3404-option2/kong-gateway/terraform/main.tf`
**Purpose:** Infrastructure as Code — creates ALL VMs on Azure using Terraform with fully automated CI/CD provisioning.

**What it does:** Creates four Azure VMs (Joke on VM1, Submit on VM2, Kong on VM3, RabbitMQ on VM5) with networking, security groups, and auto-deployment of Docker + code. Each VM has three-step provisioners: (1) install Docker, (2) copy microservice files, (3) start containers. Running `terraform apply` performs the entire deployment with zero manual steps.

**Code walkthrough:**

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
- **Terraform provider** — Tells Terraform to use the Azure Resource Manager (azurerm) plugin.
- **`~> 3.0`** — Allows any 3.x version.

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
- **Data sources** — Reference infrastructure that already exists (created when setting up VMs 1 and 2). Terraform reads their details but doesn't modify them.

```hcl
resource "azurerm_public_ip" "kong_ip" {
  name                = "${var.vm_name}-ip"
  allocation_method   = "Static"
  sku                 = "Standard"
}
```
- **Static public IP** — Unlike Dynamic, a Static IP doesn't change when the VM reboots. Essential for DNS records and firewall rules.

```hcl
resource "azurerm_network_security_group" "kong_nsg" {
  security_rule {
    name                   = "AllowSSH"
    priority               = 1000
    direction              = "Inbound"
    access                 = "Allow"
    protocol               = "Tcp"
    destination_port_range = "22"
  }
  security_rule {
    name                   = "AllowHTTP"
    priority               = 1001
    destination_port_range = "80"
  }
  security_rule {
    name                   = "AllowHTTPS"
    priority               = 1002
    destination_port_range = "443"
  }
}
```
- **Network Security Group (NSG)** — Azure's firewall. Each rule allows specific inbound traffic. Lower priority numbers take precedence.
- Opens SSH (22), HTTP (80), HTTPS (443), and Kong Admin (8445).

```hcl
resource "azurerm_network_interface" "kong_nic" {
  ip_configuration {
    private_ip_address_allocation = "Static"
    private_ip_address            = var.private_ip  # 10.0.0.6
    public_ip_address_id          = azurerm_public_ip.kong_ip.id
  }
}
```
- **Static private IP** — Ensures Kong is always at `10.0.0.6` on the VNet. The other services reference this IP in their configs.

```hcl
resource "azurerm_linux_virtual_machine" "kong_vm" {
  size                = var.vm_size
  admin_username      = var.admin_username
  admin_ssh_key {
    public_key = file("~/.ssh/id_rsa.pub")
  }
  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
  }
}
```
- **Ubuntu 22.04 LTS** — Long-term support version.
- **SSH key auth** — Reads your public key from `~/.ssh/id_rsa.pub`. No password login.

**Kong VM provisioners (VM3):**

Kong VM has a public IP, so Terraform connects directly. Three-step provisioning:
1. `remote-exec`: Install Docker Engine + Docker Compose
2. `file`: Copy `docker-compose.yml`, `kong.yaml`, and `certs/` directory
3. `remote-exec`: Run `docker-compose up -d` to start the Kong container

**Joke VM provisioners (VM1: 10.0.0.4):**

Full VM resource (public IP, NSG allowing SSH + port 4000, NIC with static private IP, Ubuntu 22.04). Three-step provisioning:
1. `remote-exec`: Install Docker
2. `file`: Copy entire `joke-microservice/` directory
3. `remote-exec`: Run `docker-compose --profile mongo up --build -d`

**Submit VM provisioners (VM2: 10.0.0.5):**

Full VM resource (public IP, NSG allowing SSH + ports 4200 + 4100, NIC with static private IP, Ubuntu 22.04). Three-step provisioning:
1. `remote-exec`: Install Docker
2. `file`: Copy `submit-microservice/` and `moderate-microservice/` directories
3. `remote-exec`: Start both containers with `docker-compose up --build -d`

**RabbitMQ VM provisioners (VM5: 10.0.0.8):**

```hcl
resource "azurerm_linux_virtual_machine" "rabbitmq_vm" {
  ...
  connection {
    type                = "ssh"
    bastion_host        = azurerm_linux_virtual_machine.kong_vm.public_ip_address
  }

  provisioner "remote-exec" {
    inline = [
      "sudo apt-get install -y docker-ce docker-compose",
    ]
  }

  provisioner "file" {
    source      = "../../rabbitmq"
    destination = "/home/${self.admin_username}/rabbitmq"
  }

  provisioner "remote-exec" {
    inline = [
      "cd /home/${self.admin_username}/rabbitmq",
      "sudo docker-compose up -d"
    ]
  }
}
```
- **Bastion host** — VM5 has no public IP. Terraform connects via the Kong VM (which has a public IP) as a jump host. This is a security best practice.

**All four VMs follow the same three-step provisioner pattern:**
1. Install Docker on the VM via `remote-exec`
2. Copy the microservice code via `file` provisioner
3. Start the containers via `remote-exec`

This is **Continuous Deployment via Terraform** — `terraform apply` creates all VMs AND deploys all applications with zero manual steps.

**Connects to:** `variables.tf`, `outputs.tf`, `terraform.tfvars`, `../../rabbitmq/`

**Key terms to know:** Terraform, Infrastructure as Code (IaC), Azure Resource Manager, data source vs resource, NSG, bastion host, provisioner, static IP, SSH key authentication

---

### 📄 `co3404-option2/kong-gateway/terraform/variables.tf`
**Purpose:** Declares all input variables with types, descriptions, and defaults.

```hcl
variable "vm_size" {
  default = "Standard_B1s"
}
variable "private_ip" {
  default = "10.0.0.6"
}
```
- **Variables** — Make the Terraform config reusable. You can override defaults in `terraform.tfvars` or via CLI flags.
- **`Standard_B1s`** — Azure's smallest (cheapest) VM size. Good for lightweight services like Kong.

---

### 📄 `co3404-option2/kong-gateway/terraform/outputs.tf`
**Purpose:** Defines what Terraform prints after `terraform apply`.

```hcl
output "kong_public_ip" {
  value = azurerm_public_ip.kong_ip.ip_address
}
output "ssh_command" {
  value = "ssh ${var.admin_username}@${azurerm_public_ip.kong_ip.ip_address}"
}
```
- Shows the public IP and a ready-to-copy SSH command after deployment.

---

### 📄 `co3404-option2/kong-gateway/terraform/terraform.tfvars`
**Purpose:** Overrides default variable values for this specific deployment.

```hcl
vm_size = "Standard_B2ats_v2"  # Overrides default Standard_B1s
```
- Uses a larger VM than the default (`B2ats_v2` has 2 vCPUs vs `B1s` with 1).

---

# PHASE 5: OPTION 4 — MODERATE MICROSERVICE (VM4/VM2)

The moderate service adds a human moderation step between joke submission and database insertion.

---

### 📄 `co3404-option2/moderate-microservice/docker-compose.yml`
**Purpose:** Runs the moderate app with Auth0 OIDC configuration.

```yaml
services:
  moderate:
    build: .
    ports:
      - "4100:3100"
    environment:
      RABBITMQ_URL: amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_IP}:5672
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_CLIENT_ID: ${AUTH_CLIENT_ID}
      AUTH_ISSUER_URL: ${AUTH_ISSUER_URL}
      BASE_URL: ${BASE_URL}
    volumes:
      - types-cache:/data
```
- **Auth0 variables** — For OIDC (OpenID Connect) authentication. Moderators must log in before approving/rejecting jokes.
- **`types-cache:/data`** — Same cache pattern as submit app for storing joke types locally.

---

### 📄 `co3404-option2/moderate-microservice/.env`
**Purpose:** Configuration including Auth0 credentials.

```
AUTH_SECRET=ksgxREWCQ0SpqnG4UCIuwgcSc7AjyZm-89VQxkSeb7tNVcVhbNouy1f4HYSKRkuB
AUTH_CLIENT_ID=DZBfLq3XkBBDxQlmpgr1zUx6vv4nn3LY
AUTH_CLIENT_SECRET=<Auth0 Client Secret>
AUTH_ISSUER_URL=https://dev-g3u2rv41onxqq8jl.us.auth0.com
BASE_URL=http://localhost:4100
```
- **`AUTH_SECRET`** — Secret key for encrypting session cookies locally. Must be at least 32 characters. Not related to Auth0.
- **`AUTH_CLIENT_ID`** — The OAuth 2.0 Client ID from the Auth0 application dashboard. Identifies this app to Auth0.
- **`AUTH_CLIENT_SECRET`** — The OAuth 2.0 Client Secret from Auth0. Used during the Authorization Code exchange to prove the app's identity.
- **`AUTH_ISSUER_URL`** — The Auth0 tenant domain. `express-openid-connect` uses this to discover OIDC endpoints (e.g., `/authorize`, `/token`, `/userinfo`) via the `.well-known/openid-configuration` endpoint.
- **`BASE_URL`** — The app's public URL. Used to construct the callback URL (`BASE_URL + /callback`) that Auth0 redirects to after login.

---

### 📄 `co3404-option2/moderate-microservice/server.js`
**Purpose:** Express server for joke moderation — pulls from submitted queue, allows approve/reject, pushes to moderated queue.

**What it does:** Implements a two-queue moderation workflow:
1. Submit app → `SUBMITTED_JOKES` queue
2. Moderator reviews → approves or rejects
3. If approved → `MODERATED_JOKES` queue → ETL consumes and inserts into DB

**Code walkthrough:**

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
- **OIDC authentication** — Uses Auth0 as the identity provider. `express-openid-connect` handles the entire OAuth 2.0 / OpenID Connect flow (login redirect, callback, session management).
- **`clientSecret`** — Required for the Authorization Code flow. Auth0 uses this to verify the app's identity during the token exchange at the `/callback` endpoint.
- **`authRequired: false`** — Not all routes require authentication. The `checkAuth` middleware is applied selectively to protected routes (like `POST /moderated`).
- **`auth0Logout: true`** — When the user logs out, they are also logged out of Auth0 (not just the local session).

```javascript
const checkAuth = (req, res, next) => {
    if (!req.oidc.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    next();
};
```
- Custom middleware that returns 401 if the user isn't logged in. Applied only to the `POST /moderated` route.

```javascript
let consumeChannel = null;
let publishChannel = null;

async function connectRabbitMQ(retries = 10, delay = 5000) {
    consumeChannel = await rabbitConnection.createChannel();
    await consumeChannel.assertQueue(SUBMIT_QUEUE, { durable: true });

    publishChannel = await rabbitConnection.createChannel();
    await publishChannel.assertQueue(MODERATED_QUEUE, { durable: true });

    // Subscribe to type_update exchange (same pattern as submit app)
    const subChannel = await rabbitConnection.createChannel();
    await subChannel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    const q = await subChannel.assertQueue(MOD_TYPE_QUEUE, { durable: true });
    await subChannel.bindQueue(q.queue, EXCHANGE_NAME, '');
    subChannel.consume(q.queue, (msg) => {
        const types = JSON.parse(msg.content.toString());
        writeCache(types);
    });
}
```
- **Three channels** — Separate channels for consuming (pulling from SUBMITTED_JOKES), publishing (pushing to MODERATED_JOKES), and subscribing (receiving type updates). Using separate channels prevents interference between operations.

```javascript
app.get('/moderate', async (req, res) => {
    const msg = await consumeChannel.get(SUBMIT_QUEUE, { noAck: false });

    if (msg) {
        const joke = JSON.parse(msg.content.toString());
        res.json({ available: true, joke, deliveryTag: msg.fields.deliveryTag });
    } else {
        res.json({ available: false, message: 'No jokes to moderate' });
    }
});
```
- **`channel.get()` (pull-based)** — Unlike the ETL's `channel.consume()` (push-based), this pulls one message at a time on demand. Each time the moderator is ready, the frontend polls this endpoint.
- **`noAck: false`** — The message is NOT automatically acknowledged. It stays "unacked" until the moderator approves or rejects.
- **`deliveryTag`** — A unique identifier for this message. Sent to the frontend and back to the server when the moderator decides. This allows the server to ack the correct message.

```javascript
app.post('/moderated', checkAuth, async (req, res) => {
    const { setup, punchline, type, isNewType, action, deliveryTag } = req.body;

    if (action === 'approve') {
        publishChannel.sendToQueue(MODERATED_QUEUE, Buffer.from(message), { persistent: true });
    }

    consumeChannel.ack({ fields: { deliveryTag: parseInt(deliveryTag) } });
    res.json({ success: true });
});
```
- **`checkAuth` middleware** — Only authenticated users can approve/reject jokes.
- **Approve** — Publishes to `MODERATED_JOKES` queue (which the ETL consumes).
- **Reject** — Just acknowledges the message without forwarding. The joke is discarded.
- **Manual ack with deliveryTag** — Constructs a minimal message object to ack the original message by its delivery tag.

**Connects to:** RabbitMQ (consumes SUBMITTED_JOKES, publishes to MODERATED_JOKES, subscribes to type_update), Auth0 (OIDC)

**Key terms to know:** OIDC (OpenID Connect), Auth0, OAuth 2.0, message queue consumer/producer, pull-based vs push-based consumption, delivery tag, manual acknowledgement, two-queue pattern, moderation workflow

---

### 📄 `co3404-option2/moderate-microservice/public/index.html`
**Purpose:** Frontend for the moderation dashboard.

Contains: auth status bar (login/logout), a waiting state with spinner (shown while polling for jokes), and a moderation form with editable setup/punchline, type selector, and approve/reject buttons.

---

### 📄 `co3404-option2/moderate-microservice/public/script.js`
**Purpose:** Frontend JavaScript for moderation — polls for jokes, handles approve/reject.

**Code walkthrough:**

```javascript
async function checkAuth() {
    const res = await fetch('/auth-status');
    const auth = await res.json();
    if (auth.isAuthenticated) {
        authStatusSpan.textContent = `Logged in as: ${auth.user.email}`;
        logoutLink.classList.remove('hidden');
    }
}
```
- Checks if the user is logged in and updates the UI accordingly.

```javascript
async function pollForJoke() {
    const res = await fetch('/moderate');
    const data = await res.json();

    if (data.available && data.joke) {
        clearInterval(pollingInterval);
        setupInput.value = data.joke.setup;
        punchlineInput.value = data.joke.punchline;
        deliveryTagInput.value = data.deliveryTag;
        // Show the form, hide the spinner
        waitingState.classList.add('hidden');
        form.classList.remove('hidden');
    }
}

function startPolling() {
    pollingInterval = setInterval(pollForJoke, 1000);
}
```
- **Polling** — Checks the queue every 1 second for new jokes. When one is found, it stops polling, populates the form, and waits for the moderator's decision.
- The moderator can **edit** the joke before approving — the textareas are pre-filled but editable.

```javascript
async function submitModeration(action) {
    const res = await fetch('/moderated', {
        method: 'POST',
        body: JSON.stringify({ action, setup, punchline, type, isNewType, deliveryTag })
    });
    if (res.ok) startPolling();  // Immediately look for next joke
}
```
- Sends the moderator's decision. If successful, starts polling again for the next joke.

**Key terms to know:** Polling, setInterval/clearInterval, delivery tag round-trip

---

### 📄 `co3404-option2/moderate-microservice/public/style.css`
**Purpose:** Premium dark theme for the moderation dashboard.

Same design system. Adds approve (green gradient) and reject (red gradient) button styles, a status bar for auth info, and a spinner animation for the waiting state.

---

# PHASE 6: RABBITMQ STANDALONE (VM5)

---

### 📄 `co3404-option2/rabbitmq/docker-compose.yml`
**Purpose:** Runs RabbitMQ as a standalone service on VM5.

```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"    # AMQP protocol
      - "15672:15672"  # Management web UI
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS}
    volumes:
      - rmq-data:/var/lib/rabbitmq
```
- **`rabbitmq:3-management`** — Includes the web management UI (accessible at port 15672). Regular `rabbitmq:3` doesn't have the UI.
- **Port 5672** — AMQP protocol port. All producers/consumers connect here.
- **Port 15672** — Web management console. Login with guest/guest to see queues, exchanges, message rates.
- **`rmq-data` volume** — Queue data and definitions persist across container restarts.

**Key terms to know:** RabbitMQ, AMQP protocol, message broker, management console

---

### 📄 `co3404-option2/rabbitmq/.env`
**Purpose:** Default RabbitMQ credentials.

```
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
```

---

# PHASE 7: DEPLOY SCRIPTS

---

### 📄 `co3404-option2/deploy.sh`
**Purpose:** One-command deployment script — copies code to all VMs and starts services.

```bash
SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.251.8.242"
VM2="azureuser@51.120.83.211"
VM3="azureuser@20.100.190.184"

scp $SSH_OPTS -r joke-microservice $VM1:~/
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo up --build -d"

scp $SSH_OPTS -r submit-microservice moderate-microservice rabbitmq $VM2:~/
ssh $SSH_OPTS $VM2 "cd rabbitmq && sudo docker compose up -d && \
  cd ../submit-microservice && sudo docker compose up --build -d && \
  cd ../moderate-microservice && sudo docker compose up --build -d"

scp $SSH_OPTS kong-gateway/kong.yaml $VM3:~/
ssh $SSH_OPTS $VM3 "sudo docker restart kong"
```
- **`scp -r`** — Securely copies directories to remote VMs.
- **`--profile mongo`** — Starts VM1 with MongoDB (can change to `mysql` for MySQL).
- **Sequential** — VM1 deploys first, then VM2 (RabbitMQ → submit → moderate in order), then VM3.
- **`-o StrictHostKeyChecking=no`** — Skips the SSH fingerprint verification prompt.

**Key terms to know:** SCP, SSH, deployment automation, shell scripting

---

### 📄 `co3404-option2/deploy_fast.sh`
**Purpose:** Faster deployment — uses a pre-zipped archive and parallel execution.

```bash
scp $SSH_OPTS deploy.zip $VM1:~/
scp $SSH_OPTS deploy.zip $VM2:~/

ssh $SSH_OPTS $VM1 "unzip -o deploy.zip && cd joke-microservice && ..." &
ssh $SSH_OPTS $VM2 "unzip -o deploy.zip && cd rabbitmq && ..." &
ssh $SSH_OPTS $VM3 "sudo docker restart kong" &
wait
```
- **`&` (background)** — Runs all three SSH commands in parallel. `wait` blocks until all finish.
- **`deploy.zip`** — Pre-zipped archive avoids scp'ing many small files (faster over slow connections).
- **`unzip -o`** — Overwrite existing files without prompting.

---

### 📄 `co3404-option2/DOCUMENTATION.md`
**Purpose:** Comprehensive project documentation covering architecture, setup, and deployment instructions.

Covers: architecture diagram, what changed from Option 1, message flow, resilience scenarios, environment variables, local testing, and Azure deployment steps.

---

# SUMMARY TABLE

| File | Purpose | Option |
|------|---------|--------|
| `co3404-option1/docker-compose.yml` | Orchestrates all 3 monolithic services | 1 |
| `co3404-option1/.env` | Database credentials | 1 |
| `co3404-option1/db-init/init.sql` | MySQL schema + 20 seed jokes | 1 |
| `co3404-option1/joke-app/Dockerfile` | Docker build for joke-app | 1 |
| `co3404-option1/joke-app/package.json` | Node.js dependencies (express, mysql2, cors) | 1 |
| `co3404-option1/joke-app/db.js` | MySQL connection pool | 1 |
| `co3404-option1/joke-app/server.js` | API: GET /types, GET /joke/:type | 1 |
| `co3404-option1/joke-app/public/*` | Frontend: joke display UI | 1 |
| `co3404-option1/submit-app/Dockerfile` | Docker build for submit-app | 1 |
| `co3404-option1/submit-app/package.json` | Dependencies (+ swagger) | 1 |
| `co3404-option1/submit-app/db.js` | MySQL connection pool | 1 |
| `co3404-option1/submit-app/swagger.js` | OpenAPI spec config | 1 |
| `co3404-option1/submit-app/server.js` | API: POST /submit (direct DB insert) | 1 |
| `co3404-option1/submit-app/public/*` | Frontend: submission form | 1 |
| `co3404-option2/joke-microservice/docker-compose.yml` | VM1: MySQL/MongoDB + joke-app + ETL | 2 |
| `co3404-option2/joke-microservice/.env` | VM1 config (DB + RabbitMQ IPs) | 2 |
| `co3404-option2/joke-microservice/db-init/init.sql` | MySQL schema (same as Option 1) | 2 |
| `co3404-option2/joke-microservice/mongo-init/init.js` | MongoDB seed script | 4 |
| `co3404-option2/joke-microservice/joke-app/db/index.js` | Database adapter factory (MySQL/Mongo) | 2,4 |
| `co3404-option2/joke-microservice/joke-app/db/mysql-adapter.js` | MySQL pool (same as Option 1) | 2 |
| `co3404-option2/joke-microservice/joke-app/db/mongo-adapter.js` | MongoDB adapter emulating mysql2 API | 4 |
| `co3404-option2/joke-microservice/joke-app/server.js` | API + /joke-types alias for Kong | 2 |
| `co3404-option2/joke-microservice/joke-app/public/*` | Frontend (upgraded dark theme) | 2 |
| `co3404-option2/joke-microservice/etl/Dockerfile` | Docker build for ETL | 2 |
| `co3404-option2/joke-microservice/etl/package.json` | Dependencies (amqplib, mysql2, mongodb) | 2 |
| `co3404-option2/joke-microservice/etl/db/*` | Database adapters (same as joke-app) | 2,4 |
| `co3404-option2/joke-microservice/etl/etl.js` | RabbitMQ consumer → DB writer | 2 |
| `co3404-option2/submit-microservice/docker-compose.yml` | VM2: submit-app | 2 |
| `co3404-option2/submit-microservice/.env` | VM2 config (RabbitMQ + VM1 IPs) | 2 |
| `co3404-option2/submit-microservice/submit-app/server.js` | Queue producer + event-driven types cache | 2 |
| `co3404-option2/submit-microservice/submit-app/swagger.js` | Updated API docs | 2 |
| `co3404-option2/submit-microservice/submit-app/public/*` | Frontend (same form, dark theme) | 2 |
| `co3404-option2/kong-gateway/docker-compose.yml` | VM3: Kong API Gateway | 3 |
| `co3404-option2/kong-gateway/kong.yaml` | Routing rules + rate limiting | 3 |
| `co3404-option2/kong-gateway/certs/*` | Self-signed SSL certificates | 3 |
| `co3404-option2/kong-gateway/terraform/main.tf` | IaC: creates all 4 VMs with CI/CD provisioners | 3,4 |
| `co3404-option2/kong-gateway/terraform/variables.tf` | Terraform input variables | 3 |
| `co3404-option2/kong-gateway/terraform/outputs.tf` | Terraform output values | 3 |
| `co3404-option2/kong-gateway/terraform/terraform.tfvars` | Variable overrides | 3 |
| `co3404-option2/moderate-microservice/docker-compose.yml` | Moderate service + Auth0 config | 4 |
| `co3404-option2/moderate-microservice/.env` | Auth0 + RabbitMQ credentials | 4 |
| `co3404-option2/moderate-microservice/Dockerfile` | Docker build for moderate-app | 4 |
| `co3404-option2/moderate-microservice/package.json` | Dependencies (+ express-openid-connect) | 4 |
| `co3404-option2/moderate-microservice/server.js` | Two-queue moderation + OIDC auth | 4 |
| `co3404-option2/moderate-microservice/public/*` | Frontend: moderation dashboard | 4 |
| `co3404-option2/rabbitmq/docker-compose.yml` | VM5: RabbitMQ standalone broker | 2 |
| `co3404-option2/rabbitmq/.env` | RabbitMQ credentials | 2 |
| `co3404-option2/deploy.sh` | Sequential deployment script | All |
| `co3404-option2/deploy_fast.sh` | Parallel deployment script | All |
| `co3404-option2/DOCUMENTATION.md` | Architecture documentation | All |

---

# CONNECTION MAP

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER (Browser)                               │
│                             │                                       │
│                             ▼                                       │
│                    ┌─────────────────┐                              │
│                    │  Kong Gateway   │ (VM3 - 10.0.0.6)             │
│                    │  Port 80/443    │                              │
│                    └───┬────┬────┬───┘                              │
│                   /joke│ /sub│  / │/mod                              │
│                        │    │    │                                   │
│              ┌─────────┘    │    └──────────┐                       │
│              ▼              ▼               ▼                       │
│    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐             │
│    │  joke-app   │  │  submit-app  │  │ moderate-app │             │
│    │  VM1:4000   │  │  VM2:4200    │  │  VM2:4100    │             │
│    └──────┬──────┘  └──────┬───────┘  └───┬──────┬───┘             │
│           │                │              │      │                  │
│      ┌────▼────┐     ┌─────▼──────┐  ┌───▼──┐   │                  │
│      │  MySQL  │     │ SUBMITTED_ │  │ Pull │   │                  │
│      │ MongoDB │     │ JOKES queue│◄─┤ 1 msg│   │                  │
│      │ VM1     │     └─────┬──────┘  └──────┘   │                  │
│      └────▲────┘           │                     │                  │
│           │          ┌─────▼──────┐        ┌─────▼──────┐          │
│      ┌────┴────┐     │  RabbitMQ  │        │ MODERATED_ │          │
│      │   ETL   │     │  VM5:5672  │        │ JOKES queue│          │
│      │  VM1    │     └────────────┘        └─────┬──────┘          │
│      └────▲────┘                                 │                  │
│           │                                      │                  │
│           └──────────────────────────────────────┘                  │
│              ETL consumes from MODERATED_JOKES                      │
│                                                                     │
│  EVENT: type_update exchange (fanout)                               │
│    ETL publishes → submit-app & moderate-app subscribe              │
│    → Updates local types-cache.json                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Communication protocols:**
- **Browser ↔ Kong:** HTTP/HTTPS (port 80/443)
- **Kong ↔ Microservices:** HTTP (private network, ports 4000/4200/4100)
- **Submit/Moderate/ETL ↔ RabbitMQ:** AMQP (port 5672)
- **joke-app/ETL ↔ Database:** MySQL (port 3306) or MongoDB (port 27017)
- **type_update events:** RabbitMQ fanout exchange → file cache

---

# ISSUES / NOTES FOR SUBMISSION

## Completed

1. **TLS/HTTPS on Kong** — Fully configured with mkcert certificates. Kong listens on port 443 (HTTPS) with TLS termination. All routes in `kong.yaml` explicitly declare `protocols: [https, http]`. Certificates loaded via `KONG_SSL_CERT`/`KONG_SSL_CERT_KEY` environment variables. Terraform NSG already allows port 443.

2. **Moderate microservice (Low 1st)** — All requirements PASS: GET /moderate with pull-based `channel.get()`, POST /moderated publishes to MODERATED_JOKES queue, GET /types reads from file cache, UI with editable fields + 1s polling, ECST via type_update fanout exchange.

3. **Dual database (Mid 1st)** — All requirements PASS: MySQL and MongoDB both supported, switchable via `DB_TYPE` env var, Docker Compose profiles for mutual exclusion, factory pattern abstraction layer, matching seed data.

4. **ECST pattern** — ETL publishes type_update events on new type insertion. Both submit-app and moderate-app subscribe to the fanout exchange and update their local file caches.

5. **OIDC Authentication (Very High 1st)** — Real Auth0 OIDC fully configured and tested:
   - Auth0 tenant: `dev-g3u2rv41onxqq8jl.us.auth0.com`
   - `express-openid-connect` middleware with real Client ID + Client Secret
   - Frontend enforces login redirect for unauthenticated users (`window.location.href = '/login'`)
   - `POST /moderated` protected by `checkAuth` middleware (returns 401 without valid session)
   - `/login` redirects to Auth0 Universal Login page
   - `/callback` handles the OAuth token exchange
   - `/logout` ends session and redirects to Auth0 logout
   - Mock auth fallback removed — real OIDC only

6. **CI/CD pipeline (High 1st)** — Fully automated via Terraform provisioners. `terraform apply` creates all 4 VMs (Kong, Joke, Submit, RabbitMQ) and deploys Docker + application code + starts containers with zero manual steps. Each VM follows the same three-step provisioning pattern: (1) install Docker via `remote-exec`, (2) copy microservice code via `file` provisioner, (3) start containers via `remote-exec`. RabbitMQ VM uses Kong as a bastion host (no public IP); all other VMs connect directly via their public IPs.

## Remaining Issues

1. **Hardcoded IPs in deploy scripts** — `deploy.sh` and `deploy_fast.sh` have hardcoded public IPs. These will change if VMs are recreated. Use Terraform outputs for the new IPs.

2. **`deploy.sh` uses `--profile mongo`** — The deploy script always starts MongoDB profile. Make sure this matches your `.env` `DB_TYPE` setting.

3. **mkcert certificates** — Browsers on other machines (not the one that ran mkcert) will show security warnings since the local CA is not installed. For the demo, you may need to accept the warning or install the mkcert CA root certificate.

4. **Auth0 Callback URLs for Azure** — When deploying to Azure behind Kong, update Auth0 Allowed Callback URLs to include `https://<kong-public-ip>/callback` and update `BASE_URL` in `.env` accordingly.

## Option 4 Audit Summary

| Grade Band | Score | Status |
|---|---|---|
| Low 1st (Moderate + ECST) | 11/11 | DONE |
| Mid 1st (Dual Database) | 5/5 | DONE |
| High 1st (CI/CD) | 3/3 | DONE |
| Very High 1st (OIDC) | 4/4 | DONE |
