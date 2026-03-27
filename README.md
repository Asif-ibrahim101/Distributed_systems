# CO3404 Distributed Systems — Joke Service

A distributed joke service built with Node.js, Express, MongoDB, Docker, RabbitMQ, Auth0, and Kong API Gateway.

## Quick Start (Run Locally)

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed (includes Docker Compose).

> **Note:** All `.env` files with the defaults below are already included in the repository. No manual setup is needed — just clone and run.

### Environment Defaults

<details>
<summary><strong>Option 1 — <code>co3404-option1/.env</code></strong></summary>

```env
DB_ROOT_PASSWORD=rootpassword
DB_NAME=jokedb
DB_USER=jokeuser
DB_PASSWORD=jokepassword
```
</details>

<details>
<summary><strong>Option 2 — <code>co3404-option2/rabbitmq/.env</code></strong></summary>

```env
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
```
</details>

<details>
<summary><strong>Option 2 — <code>co3404-option2/joke-microservice/.env</code></strong></summary>

```env
DB_TYPE=mongo
DB_HOST=mongodb
DB_ROOT_PASSWORD=rootpassword
DB_NAME=jokedb
DB_USER=jokeuser
DB_PASSWORD=jokepassword
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_IP=10.0.0.5
```
</details>

<details>
<summary><strong>Option 2 — <code>co3404-option2/submit-microservice/.env</code></strong></summary>

```env
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
VM1_PRIVATE_IP=localhost
RABBITMQ_IP=host.docker.internal
KONG_IP=20.100.192.182
```
</details>

<details>
<summary><strong>Option 2 — <code>co3404-option2/moderate-microservice/.env</code></strong></summary>

```env
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_IP=host.docker.internal
AUTH_SECRET=ksgxREWCQ0SpqnG4UCIuwgcSc7AjyZm-89VQxkSeb7tNVcVhbNouy1f4HYSKRkuB
AUTH_CLIENT_ID=DZBfLq3XkBBDxQlmpgr1zUx6vv4nn3LY
AUTH_CLIENT_SECRET=-lx44zIzzA5EmTgPzm4o_AHj5oVyq3sVSAdUFstRyAq5HTCRYDS2rJ9H9PadljEY
AUTH_ISSUER_URL=https://dev-g3u2rv41onxqq8jl.us.auth0.com
BASE_URL=http://localhost:4100
```
</details>

---

Run these commands **in order** from the project root:

```bash
# 1. RabbitMQ (must start first — creates the shared Docker network)
cd co3404-option2/rabbitmq
docker compose up -d
cd ../..

# 2. Submit service
cd co3404-option2/submit-microservice
docker compose up --build -d
cd ../..

# 3. Moderate service
cd co3404-option2/moderate-microservice
docker compose up --build -d
cd ../..

# 4. Joke service + MongoDB
cd co3404-option2/joke-microservice
docker compose up --build -d
cd ../..
```

### Access the services

| Service | URL |
|---------|-----|
| Joke App | http://localhost:4000 |
| Submit App | http://localhost:4200 |
| Moderate App | http://localhost:4100 |
| Swagger API Docs | http://localhost:4200/docs |
| RabbitMQ Console | http://localhost:15672 (guest/guest) |

### Test the full flow

1. **Submit a joke** at http://localhost:4200 — fill in setup, punchline, and type, then click Submit
2. **Moderate the joke** at http://localhost:4100 — log in with Auth0, then approve or reject
3. **View the joke** at http://localhost:4000 — select the type and click Get Joke

### Stop all services

```bash
cd co3404-option2/joke-microservice && docker compose down && cd ../..
cd co3404-option2/moderate-microservice && docker compose down && cd ../..
cd co3404-option2/submit-microservice && docker compose down && cd ../..
cd co3404-option2/rabbitmq && docker compose down && cd ../..
```

---

## Project Structure

```
├── co3404-option1/                # Option 1: Monolithic architecture
│   ├── joke-app/                  # Joke retrieval app (port 4000)
│   ├── submit-app/                # Joke submission app (port 4200)
│   ├── db-init/                   # MySQL schema + seed data
│   └── docker-compose.yml         # All services on one machine
│
└── co3404-option2/                # Option 2 & 3: Microservices + API Gateway
    ├── joke-microservice/         # VM1: joke-app + ETL + MongoDB
    ├── submit-microservice/       # VM2: submit-app
    ├── moderate-microservice/     # VM2: moderation UI + Auth0 OIDC
    ├── rabbitmq/                  # VM2: standalone RabbitMQ broker
    ├── kong-gateway/              # VM3: Kong Gateway + Terraform + TLS
    ├── deploy.sh                  # Automated Azure deployment script
    ├── DOCUMENTATION.md           # Full technical documentation
    └── README.md                  # Option 2 specific readme
```

---

## Option 1 — Monolithic

Two Express apps sharing a MySQL database, all in one Docker Compose.

```bash
cd co3404-option1
docker compose up --build -d
```

- **Joke App** (http://localhost:4000) — serves random jokes
- **Submit App** (http://localhost:4200) — submits jokes directly to DB

---

## Option 2 — Microservices + RabbitMQ

Refactored into independent microservices communicating via RabbitMQ message queues.

- **Submit app** publishes jokes to a RabbitMQ queue (no direct DB access)
- **Moderate app** pulls jokes from the queue, allows approve/reject via Auth0-protected UI
- **ETL service** consumes approved jokes and writes to MongoDB
- **Type sync** via RabbitMQ fanout exchange with file-based cache fallback

### Message Flow

```
Submit App → [SUBMITTED_JOKES queue] → Moderate App → [MODERATED_JOKES queue] → ETL → MongoDB → Joke App
```

---

## Option 3 — Kong API Gateway + Terraform

A Kong API Gateway on a third VM provides a single HTTPS entry point for all services.

- **Terraform** provisions 3 Azure VMs, VNet, NSGs, and deploys all services automatically
- **Kong** routes all traffic through one public IP with TLS termination
- **Rate limiting** on `/joke` endpoints (5 requests/min)
- **Routing:** `/joke-app`, `/submit-app`, `/moderate-app`, `/docs` all via one gateway

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js / Express | Web servers and APIs |
| MongoDB / MySQL | Persistent data storage |
| RabbitMQ | Message queue + fanout exchange |
| Docker / Docker Compose | Containerisation |
| Kong | API Gateway, reverse proxy, rate limiting |
| Auth0 (OIDC) | Authentication for moderation |
| Terraform | Infrastructure as Code (Azure) |
| Swagger UI | API documentation |
| mkcert | TLS certificate generation |

---

For full technical details, see [co3404-option2/DOCUMENTATION.md](co3404-option2/DOCUMENTATION.md).
