# CO3404 Option 2 — Microservice Architecture Documentation

## Table of Contents
1. [Overview](#overview)
2. [What Changed from Option 1](#what-changed-from-option-1)
3. [Architecture Diagram](#architecture-diagram)
4. [Project Structure](#project-structure)
5. [How Each Component Works](#how-each-component-works)
6. [Joke Moderation](#joke-moderation)
7. [Message Flow (End-to-End)](#message-flow-end-to-end)
8. [Type Synchronisation (Fanout Exchange)](#type-synchronisation-fanout-exchange)
9. [Database Architecture](#database-architecture)
10. [UI Design & Features](#ui-design--features)
11. [Resilience & Fault Tolerance](#resilience--fault-tolerance)
12. [Kong API Gateway (Option 3)](#kong-api-gateway-option-3)
13. [Environment Variables](#environment-variables)
14. [Deployment](#deployment)
15. [Running Locally](#running-locally)

---

## Overview

Option 2 refactors the Option 1 monolithic architecture into **independent microservices** that communicate via **RabbitMQ** message queuing, with a **Kong API Gateway** providing a single entry point. The services are deployed across **three Azure VMs**.

### Actual Azure Deployment (3 VMs)

| VM | Private IP | Services Running | Purpose |
|---|---|---|---|
| **joke-vm** (VM1) | 10.0.0.4 | joke-app, etl-app, database (MongoDB) | Serves jokes & processes moderated messages |
| **submit-vm** (VM2) | 10.0.0.5 | submit-app, moderate-app, rabbitmq | Accepts submissions, moderation, message queue |
| **kong-vm** (VM3) | 10.0.0.6 | kong gateway | API gateway, TLS termination, rate limiting |

> **Note:** RabbitMQ and the moderate service are co-located on VM2 to stay within Azure student account resource limits. Each service has its own `docker-compose.yml`, so separating them onto dedicated VMs requires only changing IP addresses in `.env` files — no code changes needed.

---

## What Changed from Option 1

### Files that are UNCHANGED (copied directly)
- `joke-app/public/` — frontend HTML, CSS, JS (user sees no difference)
- `submit-app/public/` — frontend HTML, CSS, JS (user sees no difference)
- `db-init/init.sql` — same schema and seed data

### Files that are NEW
| File | Purpose |
|---|---|
| `etl/etl.js` | RabbitMQ consumer — listens for moderated jokes, writes to DB |
| `etl/db.js` | Database connection (MySQL or MongoDB via adapter) |
| `etl/Dockerfile` | Docker image for the ETL service |
| `moderate-microservice/` | Entire moderation service (Auth0-protected) |
| `kong-gateway/` | Kong declarative config, TLS certs, Terraform IaC |
| `joke-app/db/index.js` | Database adapter selector (MySQL or MongoDB) |
| `joke-app/db/mongo-adapter.js` | MongoDB adapter emulating MySQL query interface |
| `deploy.sh` | Automated redeployment script (SCP + SSH) |
| Per-service `docker-compose.yml` | One per microservice instead of one combined file |
| Per-service `.env` | Separate config per service, includes cross-VM IPs |

### Files that are MODIFIED
| File | What Changed |
|---|---|
| `submit-app/server.js` | **Completely rewritten.** No longer writes to DB. Publishes to RabbitMQ queue. Types served from file-based cache updated via fanout exchange events. |
| `submit-app/package.json` | Removed `mysql2`. Added `amqplib` (RabbitMQ client). |
| `submit-app/swagger.js` | Updated description to reflect queue-based architecture. |
| `joke-app/server.js` | Added `/joke-types` alias route for Kong routing. Added database adapter pattern. |

### Files that are REMOVED
| File | Why |
|---|---|
| `submit-app/db.js` | Submit app no longer connects to the database at all. |

---

## Architecture Diagram

```
                         Kong API Gateway (VM3 - 10.0.0.6)
                    ┌─────────────────────────────────────┐
   User ───HTTPS──► │  Kong (:443)                        │
                    │   /joke/* ──────► VM1:4000           │
                    │   /submit* ─────► VM2:4200           │
                    │   / (moderate) ──► VM2:4100           │
                    │   Rate limit: 5 req/min on /joke     │
                    └─────────────────────────────────────┘
                              │                │
               ┌──────────────┘                └──────────────┐
               ▼                                              ▼
    VM2 (Submit + Moderate + RabbitMQ)             VM1 (Joke + ETL + DB)
  ┌──────────────────────────────┐          ┌──────────────────────────────┐
  │                              │          │                              │
  │  submit-app (:4200)          │          │  joke-app (:4000)            │
  │    │ publish                 │          │       │ read                 │
  │    ▼                         │          │       ▼                      │
  │  rabbitmq (:5672)            │  AMQP    │    database (MongoDB)        │
  │    │           │             │◄─────────┼───  ▲                        │
  │    │           │             │ consume   │    │ write                  │
  │    │     moderate-app (:4100)│          │  etl-app                    │
  │    │       (Auth0 protected) │          │    │                        │
  │    │       pull-based (get)  │          │    │ publish type_update    │
  │    │           │             │          │    ▼                        │
  │    │           │ approve     │  AMQP    │  fanout exchange            │
  │    │           └─────────────┼─────────►│  (type_update)             │
  │    │                         │          │                              │
  └────┼─────────────────────────┘          └──────────────────────────────┘
       │                                           ▲
       └────── messages persist in queue ──────────┘
```

### Communication Types:
- **Within a VM (Docker DNS):** Containers talk to each other using service names (e.g., `database`, `rabbitmq`)
- **Between VMs (Azure private network):** ETL connects to RabbitMQ using VM2's private IP (10.0.0.5). Kong routes to VMs via private IPs.
- **User access:** All traffic goes through Kong on VM3 via HTTPS (port 443). Direct VM access is only for debugging.

---

## Project Structure

```
co3404-option2/
├── joke-microservice/                 # Deployed to VM1
│   ├── docker-compose.yml             # Services: database (mysql/mongo profiles), joke, etl
│   ├── .env                           # DB creds + RabbitMQ IP + DB_TYPE
│   ├── joke-app/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── server.js                  # GET /types, GET /joke-types, GET /joke/:type
│   │   ├── db/
│   │   │   ├── index.js               # Adapter selector: DB_TYPE → mysql or mongo
│   │   │   ├── mysql-adapter.js       # MySQL pool (connectionLimit: 10)
│   │   │   └── mongo-adapter.js       # MongoDB adapter emulating MySQL query()
│   │   └── public/
│   │       ├── index.html
│   │       ├── style.css              # Dark theme, glassmorphism, animations
│   │       └── script.js              # 3-second punchline reveal delay
│   ├── etl/
│   │   ├── Dockerfile
│   │   ├── package.json               # amqplib, mysql2/mongodb
│   │   ├── etl.js                     # Consumer: MODERATED_JOKES queue → DB insert → type_update fanout
│   │   └── db.js
│   └── db-init/
│       └── init.sql                   # Schema + 20 seed jokes (MySQL profile only)
│
├── submit-microservice/               # Deployed to VM2
│   ├── docker-compose.yml             # Services: submit (+ rabbitmq if standalone)
│   ├── .env                           # RabbitMQ creds + VM1 private IP
│   └── submit-app/
│       ├── Dockerfile
│       ├── package.json               # amqplib (RabbitMQ client)
│       ├── server.js                  # Queue producer, fanout subscriber, file-based type cache
│       ├── swagger.js                 # OpenAPI spec for queue-based architecture
│       └── public/
│           ├── index.html             # New type toggle checkbox + input
│           ├── style.css              # Shared dark theme
│           └── script.js              # Client-side validation
│
├── moderate-microservice/             # Deployed to VM2
│   ├── docker-compose.yml             # Service: moderate
│   ├── .env                           # RabbitMQ creds + Auth0 config
│   ├── Dockerfile
│   ├── server.js                      # Pull-based moderation (channel.get), Auth0 OIDC
│   └── public/
│       ├── index.html                 # Editable setup/punchline textareas, type dropdown
│       ├── style.css                  # Shared dark theme + spinner animation
│       └── script.js                  # 1-second polling interval
│
├── rabbitmq/                          # Standalone RabbitMQ (deployed to VM2)
│   └── docker-compose.yml             # RabbitMQ with management console
│
├── kong-gateway/                      # Deployed to VM3
│   ├── docker-compose.yml             # Kong DB-less mode
│   ├── kong.yaml                      # Declarative routes, rate limiting plugin
│   ├── certs/                         # TLS certificates (mkcert-generated)
│   └── terraform/
│       ├── main.tf                    # Full Azure IaC: 3 VMs, NSGs, VNet, provisioners, outputs
│       ├── outputs.tf                 # (outputs moved to main.tf)
│       └── variables.tf               # Configurable Azure parameters
│
└── deploy.sh                          # Automated redeployment (SCP + SSH)
```

---

## How Each Component Works

### 1. Joke App (joke-app/server.js)
Reads jokes directly from the database via the adapter pattern.

- `GET /types` and `GET /joke-types` → returns all joke type names from DB
- `GET /joke/:type?count=N` → returns N random jokes of that type
- `GET /joke/any?count=N` → returns N random jokes from ALL types
- Serves the frontend UI on port 3000 (mapped to 4000)
- Uses `parseInt(req.query.count) || 1` — defaults to 1 for invalid count values (0, -1, "abc" all safely resolve to 1)

### 2. ETL Service (etl/etl.js)
This is the bridge between the MODERATED_JOKES RabbitMQ queue and the database.

**Startup:**
1. Connects to RabbitMQ at `amqp://<RABBITMQ_IP>:5672` with retry logic (10 attempts, 5s delay)
2. Asserts the queue `MODERATED_JOKES` exists and is durable
3. Sets `prefetch(1)` — processes one message at a time
4. Registers a push-based consumer callback via `channel.consume()` and waits for messages

**When a message arrives:**
1. Parses the JSON: `{ setup, punchline, type }`
2. If new type → `INSERT IGNORE INTO types (type) VALUES (?)` (prevents duplicates)
3. Publishes a `type_update` event to the fanout exchange with the full updated type list
4. Looks up `type_id` from the types table
5. Inserts the joke: `INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)`
6. Acknowledges the message (`channel.ack(msg)`) → RabbitMQ removes it from the queue
7. If anything fails before ack → `channel.nack(msg, false, true)` requeues the message for retry

### 3. Submit App (submit-app/server.js)
No longer touches the database. Acts as a queue producer.

**POST /submit:**
1. Validates input (setup, punchline, type required)
2. Publishes message to RabbitMQ queue `SUBMITTED_JOKES` with `{ persistent: true }`
3. Returns `201 Created` immediately (processing happens asynchronously)

**GET /types and GET /submit-types:**
- Both return the same data — `/submit-types` is an alias used by the frontend when accessed through Kong's reverse proxy
- Reads from a local file-based cache (`/data/types-cache.json`)
- Cache is updated via the `type_update` fanout exchange (event-driven, NOT HTTP polling)
- Cache file is on a Docker volume so it persists across container restarts
- On startup, cache is initialised with default types if file doesn't exist
- Both endpoints are documented in the OpenAPI/Swagger spec

**RabbitMQ connection:**
- Connects on startup with retry logic (10 attempts, 5s delay)
- Subscribes to `type_update` fanout exchange for cache updates
- Returns 503 to client if queue is unavailable

### 4. RabbitMQ
- Uses `rabbitmq:3-management` image (includes web management console on port 15672)
- **Queues:** `SUBMITTED_JOKES` and `MODERATED_JOKES` — both durable (survive broker restart)
- **Exchange:** `type_update` — fanout exchange for broadcasting type list changes
- **Messages:** persistent (written to disk via `{ persistent: true }`)
- **Data volume:** `rmq-data` — queue data survives container recreation

### 5. Database

The joke and ETL services support both **MySQL** and **MongoDB**. The `DB_TYPE` environment variable selects the engine.

**Database adapter pattern (`joke-app/db/index.js`):**
```javascript
if (process.env.DB_TYPE === 'mongo') module.exports = require('./mongo-adapter');
else module.exports = require('./mysql-adapter');
```

**MySQL adapter (`mysql-adapter.js`):**
- Uses `mysql2` connection pooling with `connectionLimit: 10` concurrent connections
- `waitForConnections: true` — queues requests when pool is full instead of failing
- `queueLimit: 0` — unlimited queue (no requests rejected)
- Exports promise-based pool for async/await support

**MongoDB adapter (`mongo-adapter.js`):**
- Emulates the MySQL `db.query(sql, params)` interface using MongoDB aggregation pipelines
- Singleton `MongoClient` connection (built-in connection pooling)
- Random joke selection uses `$sample` aggregation stage
- `INSERT IGNORE` emulated via `updateOne({ upsert: true, $setOnInsert })`

**Azure deployment uses MongoDB** (`DB_TYPE=mongo` in joke-microservice/.env).

---

## Joke Moderation

Submitted jokes do not go directly into the database. A human moderator must approve or reject them first.

### Moderate App (moderate-microservice/server.js)

**Authentication:**
- Protected by **Auth0 OIDC** authentication (express-openid-connect)
- `GET /auth-status` returns login state to the frontend
- Login/logout/callback routes handled by Auth0 middleware

**Pull-based message retrieval:**
The moderate service uses `channel.get()` (pull-based) rather than `channel.consume()` (push-based). This is the correct pattern for moderation because:
- The moderator controls the pace (reviews one joke at a time)
- HTTP is request-response — the delivery tag must be returned to the client
- The frontend polls every 1 second to check for new jokes

**Workflow:**
1. `GET /moderate` → calls `channel.get(SUBMITTED_JOKES, { noAck: false })` to pull one joke
2. Returns the joke content + delivery tag to the frontend
3. Moderator can **edit** the setup, punchline, and type before deciding
4. `POST /moderated` with action `approve`:
   - Publishes edited joke to `MODERATED_JOKES` queue (persistent)
   - Acknowledges the original message from `SUBMITTED_JOKES`
   - ETL picks it up and inserts into the database
5. `POST /moderated` with action `reject`:
   - Acknowledges the message (removes from queue) without forwarding
   - Joke is discarded

**Type management in moderate UI:**
- Types dropdown populated via `/moderate-types` endpoint
- "Map to a new type instead" checkbox toggles a text input for custom types
- Types cache updated via the same `type_update` fanout exchange

---

## Message Flow (End-to-End)

Here's exactly what happens when a user submits a joke:

```
Step 1: User fills in the form on the Submit App and clicks "Submit"
        Frontend validates: setup, punchline, and type must all be filled in

Step 2: Frontend JS sends POST /submit with JSON body:
        { setup: "...", punchline: "...", type: "programming", isNewType: false }

Step 3: submit-app/server.js validates the fields, then calls:
        channel.sendToQueue("SUBMITTED_JOKES", message, { persistent: true })

Step 4: RabbitMQ stores the message in the SUBMITTED_JOKES queue
        (persistent + durable = survives crashes)

Step 5: submit-app returns { message: "Joke submitted successfully!" }
        (User gets instant feedback — doesn't wait for moderation)

Step 6: Moderator opens the Moderate App (Auth0 login required)
        Frontend polls GET /moderate every 1 second

Step 7: moderate-app calls channel.get(SUBMITTED_JOKES) — pulls ONE joke
        Returns joke content + delivery tag to the moderator's browser

Step 8: Moderator reviews (can edit setup, punchline, type), then:
        - APPROVE → joke published to MODERATED_JOKES queue, original ack'd
        - REJECT → original message ack'd, joke discarded

Step 9: ETL on VM1 has a push-based consumer (channel.consume) on MODERATED_JOKES
        RabbitMQ delivers the approved joke to ETL's callback function

Step 10: ETL parses the JSON, runs:
         - INSERT IGNORE INTO types (type) VALUES (?) — if new type
         - Publishes type_update event to fanout exchange
         - SELECT id FROM types WHERE type = ?
         - INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)

Step 11: ETL calls channel.ack(msg) — RabbitMQ removes the message

Step 12: The joke is now in the database. Next time any user requests jokes,
         it may appear in the results.
```

---

## Type Synchronisation (Fanout Exchange)

When the ETL service creates a new joke type, it publishes an event to the `type_update` **fanout exchange**. This broadcasts the updated type list to all subscribed services:

```
ETL inserts new type → publishes to "type_update" exchange
                              │
                    ┌─────────┼─────────┐
                    ▼                    ▼
            submit-app              moderate-app
      (updates types-cache.json) (updates types-cache.json)
```

- **Fanout exchange** = every subscriber gets every message (broadcast pattern)
- Each subscriber creates a temporary, exclusive queue bound to the exchange
- On receiving an update, the service writes the new type list to `/data/types-cache.json`
- This eliminates synchronous HTTP calls between services for type data
- If a service is down when the event fires, it will use its last cached version

---

## UI Design & Features

All three frontends share a consistent premium dark theme with the following design elements:

### Visual Design
- **Colour palette:** `--primary-color: #6366f1` (indigo), `--secondary-color: #ec4899` (pink), dark navy gradient background
- **Glassmorphism:** `backdrop-filter: blur(12px)` with semi-transparent card backgrounds
- **Floating orbs:** `body::before/::after` with `filter: blur(80px)` and `@keyframes float` animation
- **Button effects:** Gradient backgrounds, hover lift (`translateY(-2px)`), active press (`scale(0.98)`)
- **Input focus rings:** Glow effect via `box-shadow: 0 0 0 2px rgba(...)`
- **Responsive:** Flexbox layout with `@media (min-width: 640px)` breakpoint

### Joke App Features
- **`<base href="/joke-app/">`** — ensures static assets (CSS, JS) load correctly when served through Kong's `strip_path: true` route
- **3-second punchline delay:** `setTimeout(() => { ... }, 3000)` with `@keyframes popIn` animation (scale 0.8→1 + opacity fade)
- **Count selector:** User can request 1-10 jokes at a time
- **Type dropdown:** Populated dynamically from `/types` endpoint

### Submit App Features
- **`<base href="/submit-app/">`** — ensures static assets load correctly through Kong
- **Client-side validation:** Checks `!setup || !punchline || !type` before sending, shows error feedback via `showFeedback('Please fill in all fields...', 'error')`
- **New type toggle:** Checkbox `id="new-type-toggle"` reveals a text input `id="new-type-input"` for custom types
- **Success/error animations:** `@keyframes fadeInSlide` for feedback messages

### Moderate App Features
- **Editable fields:** `<textarea id="setup">` and `<textarea id="punchline">` are editable by default, with "(Editable)" labels
- **Async initialization:** `init()` awaits `checkAuth()` and `loadTypes()` before starting the polling loop — prevents race conditions where polling starts before auth state or types are known
- **1-second polling:** `pollingInterval = setInterval(pollForJoke, 1000)` for real-time joke fetching
- **Type dropdown:** `<select id="type-select">` populated via `/moderate-types`, with "Map to a new type instead" checkbox toggle
- **Loading spinner:** `@keyframes spin` CSS spinner displayed while waiting for jokes
- **Auth-gated UI:** Login button shown until Auth0 authentication completes

---

## Resilience & Fault Tolerance

### Scenario 1: VM1 (joke-microservice) goes down
- **Submit app still works** — jokes publish to RabbitMQ queue and wait
- **Moderation still works** — jokes can be approved/rejected (queued for ETL)
- **GET /types falls back** to cached `/data/types-cache.json`
- **When VM1 comes back** — ETL reconnects and processes all queued messages

### Scenario 2: VM2 (submit + moderate + RabbitMQ) goes down
- **Joke app still works** — reads directly from DB, no dependency on VM2
- **No new jokes** can be submitted or moderated until VM2 is back

### Scenario 3: RabbitMQ container restarts
- **Queues are durable** — RabbitMQ recreates them on startup
- **Messages are persistent** — written to disk via `{ persistent: true }`
- **Volume mount** (`rmq-data`) — even if container is destroyed and recreated, data survives

### Scenario 4: ETL crashes mid-processing
- **Message is NOT acknowledged** — stays in MODERATED_JOKES queue
- **ETL restarts** (docker restart policy: `unless-stopped`)
- **Message is redelivered** — processed on retry via `channel.nack(msg, false, true)`

### Scenario 5: Kong goes down
- Backend services continue operating — they're independent of Kong
- Users lose the single entry point and must use direct VM IPs temporarily

### Connection retry logic
Both ETL and submit-app use the same retry pattern:
```
Attempt 1 → fail → wait 5s → Attempt 2 → fail → wait 5s → ... up to 10 attempts
```
This handles startup ordering (e.g., RabbitMQ not ready yet when ETL starts).

---

## Kong API Gateway (Option 3)

Kong provides a single entry point for all microservices, running in **DB-less declarative mode** on VM3.

### Routing (kong.yaml)

Kong defines two separate services for the joke backend — one rate-limited for API calls, one unthrottled for UI and type lookups:

| Kong Path | Kong Service | Routes To | Rate Limited |
|---|---|---|---|
| `/joke/*` | joke-service | VM1:4000 | Yes (5/min) |
| `/joke-app/*` | joke-app-ui-service | VM1:4000 | No |
| `/joke-types` | joke-app-ui-service | VM1:4000 | No |
| `/submit` | submit-service | VM2:4200 | No |
| `/submit-types` | submit-service | VM2:4200 | No |
| `/submit-app/*` | submit-service | VM2:4200 | No |
| `/docs`, `/docs/*` | submit-service | VM2:4200 | No |
| `/moderate`, `/moderated` | moderate-service | VM2:4100 | No |
| `/moderate-types` | moderate-service | VM2:4100 | No |
| `/auth-status`, `/login`, `/logout`, `/callback` | moderate-service | VM2:4100 | No |
| `/` (root) | moderate-service | VM2:4100 | No |

The joke and submit frontends use `<base href="/joke-app/">` and `<base href="/submit-app/">` respectively, so their static assets (CSS, JS) resolve correctly when served through Kong's `strip_path: true` routes.

### TLS Termination
- TLS certificates generated using `mkcert` and deployed to the Kong VM's filesystem
- Certificates are mounted into the Kong container via Docker volume (`./certs:/etc/kong/certs:ro`) — NOT baked into the Docker image
- Terraform `main.tf` copies the `certs/` directory to the VM via `file` provisioner
- Kong listens on port 443 (HTTPS) and terminates TLS before proxying to backends over HTTP

### Rate Limiting
- Applied to `/joke/*` routes via Kong's `rate-limiting` plugin
- **5 requests per minute** per client (local counter policy)
- Protects backend databases from being overwhelmed by spam or DoS attacks

### Security (NSGs)
- Kong VM: Only ports 80 and 443 open to the internet
- Backend VMs: Only accessible from within the Azure VNet (private IPs)
- RabbitMQ management console (15672) not exposed through Kong

---

## Environment Variables

### joke-microservice/.env (VM1)
| Variable | Purpose | Example |
|---|---|---|
| `DB_TYPE` | Database engine selection | `mongo` |
| `DB_ROOT_PASSWORD` | MySQL root password (MySQL profile) | `rootpassword` |
| `DB_NAME` | Database name | `jokedb` |
| `DB_USER` | Database user | `jokeuser` |
| `DB_PASSWORD` | Database password | `jokepassword` |
| `MONGO_URI` | MongoDB connection string | `mongodb://database:27017` |
| `RABBITMQ_USER` | RabbitMQ username (for ETL) | `guest` |
| `RABBITMQ_PASS` | RabbitMQ password (for ETL) | `guest` |
| `RABBITMQ_IP` | IP where RabbitMQ runs (VM2) | `10.0.0.5` |

### submit-microservice/.env (VM2)
| Variable | Purpose | Example |
|---|---|---|
| `RABBITMQ_USER` | RabbitMQ username | `guest` |
| `RABBITMQ_PASS` | RabbitMQ password | `guest` |
| `RABBITMQ_IP` | RabbitMQ IP (same VM or remote) | `host.docker.internal` |
| `VM1_PRIVATE_IP` | VM1's private IP (for fallback) | `10.0.0.4` |

### moderate-microservice/.env (VM2)
| Variable | Purpose | Example |
|---|---|---|
| `RABBITMQ_USER` | RabbitMQ username | `guest` |
| `RABBITMQ_PASS` | RabbitMQ password | `guest` |
| `RABBITMQ_IP` | RabbitMQ IP (same VM) | `host.docker.internal` |
| `AUTH_SECRET` | Auth0 session secret | (random string) |
| `AUTH_CLIENT_ID` | Auth0 application client ID | (from Auth0 dashboard) |
| `AUTH_CLIENT_SECRET` | Auth0 application client secret | (from Auth0 dashboard) |
| `AUTH_ISSUER_URL` | Auth0 tenant URL | `https://dev-xxx.us.auth0.com` |
| `BASE_URL` | Public URL for Auth0 callbacks | `https://20.100.190.184` |

---

## Deployment

### Automated Initial Deployment (Terraform)

Running `terraform apply` performs the entire deployment with zero manual steps:

1. Creates 3 Azure VMs (joke, submit, kong), VNet, subnets, NSGs, and public IPs
2. SSHs into each VM and installs Docker + docker-compose (`remote-exec` provisioner)
3. Copies project files to each VM via `rsync` (`local-exec` provisioner) — excludes `node_modules` and `.DS_Store`
4. Patches `.env` files with Azure private IPs using `sed` (so local `.env` defaults work without manual editing)
5. Starts RabbitMQ first on VM2 (with a 15s sleep), then submit and moderate services
6. Starts containers on VM1 and VM3 in parallel

The Terraform config consolidates RabbitMQ, submit, and moderate onto a single VM (VM2) instead of using a separate RabbitMQ VM with bastion access, to stay within Azure student account limits.

### Subsequent Redeployments (deploy.sh)

The `deploy.sh` script automates code updates via SCP and SSH:

```bash
# What deploy.sh does:
# VM1: SCP joke-microservice → SSH docker compose --profile mongo up --build -d
# VM2: SCP submit, moderate, rabbitmq → SSH docker compose up -d (rabbitmq) + up --build -d (submit, moderate)
# VM3: SCP kong.yaml → SSH docker restart kong
```

### Azure Firewall Ports
- **Kong VM (VM3):** 80, 443 (public — user-facing)
- **VM1, VM2:** Only accessible via VNet private IPs (not directly from internet in production)

---

## Running Locally

For local testing, `.env` files use `host.docker.internal` instead of Azure private IPs. This lets containers in separate Docker Compose stacks reach each other via the host machine.

```bash
# Start RabbitMQ first (creates the shared-network)
cd co3404-option2/rabbitmq
docker compose up -d

# Start submit microservice
cd ../submit-microservice
docker compose up --build -d

# Start moderate microservice
cd ../moderate-microservice
docker compose up --build -d

# Start joke microservice (MongoDB starts automatically)
cd ../joke-microservice
docker compose up --build -d

# Start Kong gateway (routes will fail locally unless kong.yaml IPs are updated)
cd ../kong-gateway
docker compose up -d
```

### Ports:
| Service | URL |
|---------|-----|
| Joke App | http://localhost:4000 |
| Submit App | http://localhost:4200 |
| Moderate App | http://localhost:4100 |
| Swagger Docs | http://localhost:4200/docs |
| RabbitMQ Console | http://localhost:15672 (guest/guest) |
| Kong (HTTP) | http://localhost:80 |
| Kong (HTTPS) | https://localhost:443 |

### Quick Test:
```bash
# Check types
curl http://localhost:4000/types

# Submit a joke
curl -X POST http://localhost:4200/submit \
  -H "Content-Type: application/json" \
  -d '{"setup":"Test joke","punchline":"Test punchline","type":"general"}'

# Check RabbitMQ console for message in SUBMITTED_JOKES queue
# Approve via moderate app, then check joke appears:
curl http://localhost:4000/joke/general?count=10
```

### Docker Volumes (Data Persistence):
| Volume | Service | Purpose |
|---|---|---|
| `db-data` | MySQL | Database files survive container recreation |
| `mongo-data` | MongoDB | Database files survive container recreation |
| `rmq-data` | RabbitMQ | Queue data and messages survive container recreation |
| `types-cache` | Submit, Moderate | Cached type list persists across restarts |

### Health Checks:
- **MySQL:** `mysqladmin ping -h localhost` (interval 10s, timeout 5s, 5 retries)
- **MongoDB:** `mongosh --eval "db.adminCommand('ping')"` (interval 10s, timeout 5s, 5 retries)
- Services use `depends_on` with `condition: service_healthy` within the same docker-compose stack
- Cross-VM dependencies use retry logic instead (Docker depends_on can't span VMs)
