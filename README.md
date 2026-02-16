# CO3404 Distributed Systems — Joke Service

A distributed joke service built with Node.js, Express, MySQL, Docker, and RabbitMQ.

## Project Structure

```
├── co3404-option1/          # Monolithic architecture (HIGH 3rd class)
│   ├── joke-app/            # Joke retrieval app (port 4000)
│   ├── submit-app/          # Joke submission app (port 4200)
│   ├── db-init/             # MySQL schema + seed data
│   └── docker-compose.yml   # All services on one machine
│
└── co3404-option2/          # Microservice architecture (HIGH 2:2)
    ├── joke-microservice/   # VM1: joke-app + ETL + MySQL
    ├── submit-microservice/ # VM2: submit-app + RabbitMQ
    └── DOCUMENTATION.md     # Full architecture documentation
```

## Option 1 — Monolithic

Two Express apps sharing a MySQL database, all in Docker Compose.

- **Joke App** (:4000) — serves random jokes from DB
- **Submit App** (:4200) — submits jokes directly to DB + Swagger docs

```bash
cd co3404-option1
docker-compose up --build -d
```

## Option 2 — Microservices + RabbitMQ

Refactored into two independent microservices for deployment on separate Azure VMs.

- **Submit app** publishes jokes to a RabbitMQ queue (no direct DB access)
- **ETL service** consumes from the queue and writes to MySQL
- **GET /types** fetches via HTTP from joke-app with file-based cache fallback

```bash
# VM2 first (RabbitMQ)
cd co3404-option2/submit-microservice && docker-compose up --build -d

# VM1
cd co3404-option2/joke-microservice && docker-compose up --build -d
```

See [DOCUMENTATION.md](co3404-option2/DOCUMENTATION.md) for full architecture details, message flow, and Azure deployment guide.

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js / Express | Web servers & APIs |
| MySQL 8.0 | Persistent data storage |
| RabbitMQ | Message queue (Option 2) |
| Docker / Docker Compose | Containerisation |
| Swagger UI | API documentation |
| Azure VMs | Cloud deployment (Option 2) |
