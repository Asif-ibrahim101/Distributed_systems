# CO3404 Option 2 — Microservice Architecture Documentation

## Table of Contents
1. [Overview](#overview)
2. [What Changed from Option 1](om#what-changed-from-option-1)
3. [Architecture Diagram](#architecture-diagram)
4. [Project Structure](#project-structure)
5. [How Each Component Works](#how-each-component-works)
6. [Message Flow (End-to-End)](#message-flow-end-to-end)
7. [Resilience & Fault Tolerance](#resilience--fault-tolerance)
8. [Environment Variables](#environment-variables)
9. [Running Locally](#running-locally)
10. [Azure Deployment](#azure-deployment)

## Overview

Option 2 refactors the Option 1 monolithic architecture into **two independent microservices** that communicate via **RabbitMQ** message queuing. The two microservices are designed to run on **separate Azure VMs**.

| Microservice | VM | Containers | Purpose |
|---|---|---|---|
| **joke-microservice** | VM1 | joke-app, etl-app, database | Serves jokes & processes incoming messages |
| **submit-microservice** | VM2 | submit-app, rabbitmq | Accepts joke submissions & queues them |

---

## What Changed from Option 1

### Files that are UNCHANGED (copied directly)
- `joke-app/` — entire directory (server.js, db.js, Dockerfile, package.json, public/*)
- `db-init/init.sql` — same schema and seed data
- `submit-app/public/` — frontend HTML, CSS, JS (user sees no difference)
- `submit-app/Dockerfile` — same build process

### Files that are NEW
| File | Purpose |
|---|---|
| `etl/etl.js` | RabbitMQ consumer — listens for messages, writes jokes to MySQL |
| `etl/db.js` | MySQL connection pool for ETL (connects via Docker DNS) |
| `etl/Dockerfile` | Docker image for the ETL service |
| `etl/package.json` | Dependencies: amqplib, mysql2 |
| Two `docker-compose.yml` files | One per VM instead of one combined file |
| Two `.env` files | Separate config per VM, includes cross-VM private IPs |

### Files that are MODIFIED
| File | What Changed |
|---|---|
| `submit-app/server.js` | **Completely rewritten.** No longer writes to DB. Now publishes to RabbitMQ queue. GET /types fetches from joke-app via HTTP and caches to a JSON file. |
| `submit-app/package.json` | Removed `mysql2`. Added `amqplib` (RabbitMQ client) and `axios` (HTTP client). |
| `submit-app/swagger.js` | Updated description to reflect queue-based architecture. |

### Files that are REMOVED
| File | Why |
|---|---|
| `submit-app/db.js` | Submit app no longer connects to the database at all. |

---

## Architecture Diagram

```
                    VM2 (Submit Microservice)                    VM1 (Joke Microservice)
              ┌──────────────────────────────┐            ┌──────────────────────────────┐
              │                              │            │                              │
  User ──────►  submit-app (:4200)           │            │  joke-app (:4000)  ◄──── User
              │    │          │               │            │       │                      │
              │    │          │ GET /types    │   HTTP     │       │ read                 │
              │    │          └───────────────┼───────────►│       ▼                      │
              │    │ publish                  │            │    database (:4002)           │
              │    ▼                          │            │       ▲                      │
              │  rabbitmq (:5672)             │   AMQP     │       │ write                │
              │    │                          │◄───────────┼   etl-app (:4001)            │
              │    │                          │  consume   │                              │
              └────┼──────────────────────────┘            └──────────────────────────────┘
                   │                                              ▲
                   └────── messages persist in queue ──────────────┘
```

### Communication Types:
- **Within a VM (Docker DNS):** Containers talk to each other using service names (e.g., `database`, `rabbitmq`)
- **Between VMs (Azure private network):** ETL connects to RabbitMQ using VM2's private IP. Submit-app fetches /types from joke-app using VM1's private IP.
- **User access (public IPs):** Only used for testing — user hits VM public IPs on mapped ports.

---

## Project Structure

```
co3404-option2/
├── joke-microservice/                 # Deployed to VM1
│   ├── docker-compose.yml             # 3 services: database, joke, etl
│   ├── .env                           # DB creds + VM2 private IP
│   ├── joke-app/                      # UNCHANGED from Option 1
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── server.js                  # GET /types, GET /joke/:type
│   │   ├── db.js                      # MySQL pool → "database" via Docker DNS
│   │   └── public/
│   │       ├── index.html
│   │       ├── style.css
│   │       └── script.js
│   ├── etl/                           # NEW — RabbitMQ consumer
│   │   ├── Dockerfile
│   │   ├── package.json               # amqplib, mysql2
│   │   ├── etl.js                     # Consumer: queue → parse → DB insert → ack
│   │   └── db.js                      # MySQL pool → "database" via Docker DNS
│   └── db-init/
│       └── init.sql                   # UNCHANGED — schema + 20 seed jokes
│
└── submit-microservice/               # Deployed to VM2
    ├── docker-compose.yml             # 2 services: rabbitmq, submit
    ├── .env                           # RabbitMQ creds + VM1 private IP
    └── submit-app/
        ├── Dockerfile                 # UNCHANGED
        ├── package.json               # MODIFIED — added amqplib, axios; removed mysql2
        ├── server.js                  # REWRITTEN — queue producer, HTTP /types
        ├── swagger.js                 # UPDATED — reflects queue architecture
        └── public/                    # UNCHANGED — same frontend as Option 1
            ├── index.html
            ├── style.css
            └── script.js
```

---

## How Each Component Works

### 1. Joke App (joke-app/server.js) — UNCHANGED
- Reads jokes directly from MySQL (same as Option 1)
- `GET /types` → returns all joke type names from DB
- `GET /joke/:type?count=N` → returns N random jokes of that type
- Serves the frontend UI on port 3000 (mapped to 4000)

### 2. ETL Service (etl/etl.js) — NEW
This is the bridge between RabbitMQ (on VM2) and MySQL (on VM1).

**Startup:**
1. Connects to RabbitMQ at `amqp://<VM2_PRIVATE_IP>:5672` with retry logic
2. Asserts the queue `SUBMITTED_JOKES` exists and is durable
3. Sets `prefetch(1)` — processes one message at a time
4. Registers a consumer callback and waits for messages

**When a message arrives:**
1. Parses the JSON: `{ setup, punchline, type, isNewType }`
2. If `isNewType` is true → `INSERT IGNORE INTO types (type) VALUES (?)`
3. Looks up `type_id` from the types table
4. Inserts the joke: `INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)`
5. Acknowledges the message → RabbitMQ removes it from the queue
6. If anything fails before ack → message stays in queue for retry

**Retry logic (connectWithRetry):**
```
Attempt 1 → fail → wait 5s → Attempt 2 → fail → wait 5s → ... up to 10 attempts
```
This handles the case where RabbitMQ isn't ready yet (e.g., VM2 still booting).

### 3. Submit App (submit-app/server.js) — MODIFIED
No longer touches the database. Two key changes:

**POST /submit (was: direct DB insert, now: queue publish):**
1. Validates input (setup, punchline, type required)
2. Publishes message to RabbitMQ queue `SUBMITTED_JOKES`
3. Message is **persistent** (survives broker restart)
4. Returns `201 Created` immediately (ETL processes it later)

**GET /types (was: direct DB query, now: HTTP fetch + cache):**
1. Makes HTTP GET to `http://<VM1_PRIVATE_IP>:4000/types` (5s timeout)
2. On success → returns types to client AND writes to `/data/types-cache.json`
3. On failure (VM1 down) → reads from cache file and returns cached types
4. Cache file is on a Docker volume so it persists across container restarts

**RabbitMQ connection:**
- Connects on startup with same retry logic as ETL
- Auto-reconnects if connection drops
- Returns 503 to client if queue is unavailable

### 4. RabbitMQ
- Uses `rabbitmq:3-management` image (includes web management console)
- Queue: `SUBMITTED_JOKES` — durable (survives broker restart)
- Messages: persistent (written to disk, not just memory)
- Data volume: `rmq-data` — queue data survives container recreation
- Management console: port 15672 (default login: guest/guest)

### 5. MySQL Database — UNCHANGED
- Same schema: `types` table + `jokes` table with foreign key
- Same 20 seed jokes across 4 types
- Persistent volume: `db-data`

---

## Message Flow (End-to-End)

Here's exactly what happens when a user submits a joke:

```
Step 1: User fills in the form on http://<VM2>:4200 and clicks "Submit"

Step 2: Frontend JS sends POST /submit with JSON body:
        { setup: "...", punchline: "...", type: "programming", isNewType: false }

Step 3: submit-app/server.js validates the fields, then calls:
        channel.sendToQueue("SUBMITTED_JOKES", message, { persistent: true })

Step 4: RabbitMQ receives the message and stores it in the SUBMITTED_JOKES queue
        (persistent + durable = survives crashes)

Step 5: submit-app returns { message: "Joke submitted successfully!" }
        (User gets instant feedback — doesn't wait for DB insert)

Step 6: ETL on VM1 has a consumer registered on the same queue.
        RabbitMQ delivers the message to ETL's callback function.

Step 7: ETL parses the JSON, runs:
        - INSERT IGNORE INTO types (type) VALUES (?) — if needed
        - SELECT id FROM types WHERE type = ?
        - INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)

Step 8: ETL calls channel.ack(msg) — RabbitMQ removes the message.

Step 9: The joke is now in MySQL. Next time the user requests a joke
        from joke-app, it may appear in the results.
```

---

## Resilience & Fault Tolerance

### Scenario 1: VM1 (joke-microservice) goes down
- **Submit app still works** — jokes publish to RabbitMQ queue and wait
- **GET /types falls back** to cached `/data/types-cache.json`
- **When VM1 comes back** — ETL reconnects and processes all queued messages

### Scenario 2: VM2 (submit-microservice) goes down
- **Joke app still works** — reads directly from DB, no dependency on VM2
- **No new jokes** can be submitted until VM2 is back

### Scenario 3: RabbitMQ container restarts
- **Queue is durable** — RabbitMQ recreates it on startup
- **Messages are persistent** — written to disk, not lost
- **Volume mount** — even if container is destroyed and recreated, data survives

### Scenario 4: ETL crashes mid-processing
- **Message is NOT acknowledged** — stays in queue
- **ETL restarts** (docker restart policy: `unless-stopped`)
- **Message is redelivered** — processed on retry

---

## Environment Variables

### joke-microservice/.env (VM1)
| Variable | Purpose | Example |
|---|---|---|
| `DB_ROOT_PASSWORD` | MySQL root password | `rootpassword` |
| `DB_NAME` | Database name | `jokedb` |
| `DB_USER` | Database user | `jokeuser` |
| `DB_PASSWORD` | Database password | `jokepassword` |
| `RABBITMQ_USER` | RabbitMQ username (for ETL) | `guest` |
| `RABBITMQ_PASS` | RabbitMQ password (for ETL) | `guest` |
| `VM2_PRIVATE_IP` | VM2's Azure private IP (where RabbitMQ runs) | `10.0.0.5` |

### submit-microservice/.env (VM2)
| Variable | Purpose | Example |
|---|---|---|
| `RABBITMQ_USER` | RabbitMQ username | `guest` |
| `RABBITMQ_PASS` | RabbitMQ password | `guest` |
| `VM1_PRIVATE_IP` | VM1's Azure private IP (where joke-app runs) | `10.0.0.4` |

---

## Running Locally

For local testing, both `.env` files use `host.docker.internal` instead of real Azure IPs. This lets containers in separate Docker Compose stacks reach each other via the host machine.

```bash
# Start VM2 first (RabbitMQ needs to be up before ETL connects)
cd co3404-option2/submit-microservice
docker-compose up --build -d

# Then start VM1
cd ../joke-microservice
docker-compose up --build -d
```

### Quick Test:
```bash
# Check types
curl http://localhost:4000/types
curl http://localhost:4200/types

# Submit a joke
curl -X POST http://localhost:4200/submit \
  -H "Content-Type: application/json" \
  -d '{"setup":"Test joke","punchline":"Test punchline","type":"general"}'

# Wait 2-3 seconds for ETL to process, then check
curl http://localhost:4000/joke/general?count=10
```

### Ports:
| Service | URL |
|---------|-----|
| Joke App | http://localhost:4000 |
| Submit App | http://localhost:4200 |
| Swagger Docs | http://localhost:4200/docs |
| RabbitMQ Console | http://localhost:15672 (guest/guest) |
| MySQL | localhost:4002 |

---

## Azure Deployment

### Step 1: Create Two VMs
- Go to Azure Portal → Create Resource → Virtual Machine
- **VM1** (B2s recommended — runs 3 containers): Ubuntu 22.04
- **VM2** (B1s is fine — runs 2 containers): Ubuntu 22.04
- Put both in the **same resource group** → they'll share a VNet automatically
- Note down each VM's **private IP** (e.g., VM1 = 10.0.0.4, VM2 = 10.0.0.5)

### Step 2: Install Docker on Both VMs
```bash
# SSH into each VM and run:
sudo apt update && sudo apt install -y docker.io docker-compose
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### Step 3: Copy Files to VMs
```bash
# From your local machine:
scp -r co3404-option2/joke-microservice/ user@<VM1_PUBLIC_IP>:~/joke-microservice/
scp -r co3404-option2/submit-microservice/ user@<VM2_PUBLIC_IP>:~/submit-microservice/
```

### Step 4: Update .env Files with Real IPs
```bash
# On VM1: edit joke-microservice/.env
VM2_PRIVATE_IP=<actual VM2 private IP>

# On VM2: edit submit-microservice/.env
VM1_PRIVATE_IP=<actual VM1 private IP>
```

### Step 5: Start Services
```bash
# On VM2 first:
cd ~/submit-microservice && docker-compose up --build -d

# Then on VM1:
cd ~/joke-microservice && docker-compose up --build -d
```

### Step 6: Open Azure Firewall Ports
In Azure Portal → VM → Networking → Add inbound port rules for:
- VM1: 4000 (joke-app), 4001 (ETL), 4002 (database)
- VM2: 4200 (submit-app), 5672 (RabbitMQ), 15672 (RabbitMQ console)

### Step 7: Test
Access via VM public IPs:
- `http://<VM1_PUBLIC_IP>:4000` — Joke App
- `http://<VM2_PUBLIC_IP>:4200` — Submit App
- `http://<VM2_PUBLIC_IP>:15672` — RabbitMQ Console
