# CO3404 Option 4 — Video Script (Option-by-Option Walkthrough)
# Target: 14-15 minutes

---

## PRE-RECORDING SETUP

### Terminal — pre-set variables:
```bash
SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.251.8.242"
VM2="azureuser@51.120.83.211"
VM3="azureuser@20.100.190.184"
KONG_IP="20.100.190.184"
```

### Browser tabs open (all through Kong — single entry point):
1. Azure Portal — co3404-rg resource group
2. Joke App UI — `http://20.100.190.184/joke-app/`
3. Submit App UI — `http://20.100.190.184/submit-app/`
4. Swagger Docs — `http://20.100.190.184/docs`
5. Moderate App UI — `http://20.100.190.184/`
6. RabbitMQ Console — `http://51.120.83.211:15672`

### SSH sessions ready in separate terminal tabs:
- Tab for VM1, Tab for VM2, Tab for VM3

---

## 0:00 – 0:30 | INTRODUCTION

**[Screen: Azure portal showing VMs]**

"Hi, I'm Asif. This is my CO3404 Distributed Systems assignment. I've implemented all four options building on top of each other, targeting an Exceptional First.

I'm going to walk through each option — what was required, what I built, and demonstrate it working. The system is running live on Azure right now across three VMs — joke-vm, submit-vm, and kong-vm — all in the co3404-rg resource group in the norwayeast region.

Let me quickly confirm everything is running."

**[Paste in terminal:]**
```bash
ssh $SSH_OPTS $VM1 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh $SSH_OPTS $VM2 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh $SSH_OPTS $VM3 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

"All containers are up. Let's start from Option 1."

---

## 0:30 – 4:00 | OPTION 1 — TWO APPS, ONE DATABASE (3.5 minutes)

**[Screen: VS Code showing co3404-option1/ folder structure briefly]**

"Option 1 required a basic distributed system — two separate Express applications sharing a MySQL database, all running in Docker containers.

I built a **Joke app** on port 3000 and a **Submit app** on port 3200, with MySQL as the shared database. All three run in Docker containers via a single docker-compose file on one Docker network. The Joke app is exposed on port 4000 and the Submit app on port 4200."

### Joke App Demo

**[Switch to browser: Joke App UI through Kong]**

"Here's the Joke app. The requirements said the dropdown must be populated dynamically from the database — so every time I click this dropdown, it calls GET /types which queries the database for all available joke types. No hardcoded values.

I'll select 'programming' and click Get Joke."

**[Click — show setup appearing, then punchline after 3 seconds]**

"The setup appears immediately. Three seconds later, the punchline reveals — that was a specific requirement. Each click fetches a different random joke. The API uses ORDER BY RAND() LIMIT for random selection with MySQL, or the $sample aggregation pipeline with MongoDB.

The assignment also required the API to support returning multiple jokes. Let me show that."

**[Switch to terminal, paste:]**
```bash
curl -sk https://$KONG_IP/joke/programming?count=3 | python3 -m json.tool
```

"Three random programming jokes returned as JSON. The UI only shows one, but the API is designed to be reusable — for example, someone printing jokes on Christmas crackers could request 50 at once."

### Submit App Demo

**[Switch to browser: Submit App UI]**

"The Submit app lets users enter a new joke. The requirements specified: a setup field, a punchline field, a dropdown for type selection populated from the database, an option to add a new type, a submit button that sends all data at once, and client-side validation preventing empty submissions."

**[Show: try to submit with empty fields — validation prevents it]**

"I can't submit with empty fields — the validation catches it. Let me fill in a joke and submit."

**[Fill in a joke, submit, show success feedback]**

### Swagger Documentation

**[Switch to browser: Swagger docs at http://KONG_IP/docs]**

"The assignment required OpenAPI documentation at GET /docs with interactive testing. Here it is — all endpoints documented with request and response schemas. I can test them directly from here."

**[Quickly test GET /submit-types from Swagger]**

### Database Structure

"The database has two tables — types and jokes — with a foreign key relationship. The types table has a UNIQUE constraint preventing duplicates. Both apps use mysql2 connection pools with parameterised queries to prevent SQL injection.

The data lives on a Docker persistent volume, so it survives container restarts."

### Resilience

"The key non-functional requirement for Option 1 was service independence. If I stop the submit app, the joke app keeps working. If I stop the joke app, submit keeps working. They only share the database — they don't depend on each other."

---

## 4:00 – 7:30 | OPTION 2 — MICROSERVICES + RABBITMQ (3.5 minutes)

**[Screen: brief architecture diagram or whiteboard]**

"Option 2 required splitting the system across two Azure VMs and introducing asynchronous messaging. Three new things were added: RabbitMQ as a message broker, an ETL service, and a types file cache.

The fundamental change is that the **submit app no longer writes to the database**. Instead, it publishes messages to a RabbitMQ queue called SUBMITTED_JOKES. The ETL service on the other VM consumes those messages and writes to the database. This decouples the two microservices."

### Message Queue Demo

"Let me demonstrate the message flow. I'll submit a joke."

**[Switch to browser: Submit UI — submit a joke]**

"The joke has been published to the RabbitMQ queue."

**[Switch to browser: RabbitMQ Console at http://51.120.83.211:15672]**

"Here in the RabbitMQ management console, you can see the queues. The message is waiting to be consumed.

The requirements specified that queues must be **durable** — they survive broker restarts — and messages must be **persistent** — written to disk, not just memory. The ETL acknowledges each message only after successfully writing to the database. If the ETL crashes before acknowledging, the message stays on the queue and gets redelivered. No data loss."

### ETL Service

**[Switch to terminal:]**
```bash
ssh $SSH_OPTS $VM1 "sudo docker logs etl-app --tail 10"
```

"Here are the ETL logs — you can see it consuming messages from the MODERATED_JOKES queue, inserting types if they're new, and inserting jokes. The ETL runs on its own Node.js server in a Docker container alongside the joke app and database on VM1."

### Types Cache

"The other key change was the types cache. Since the submit app can't access the database anymore, it needs another way to populate the types dropdown. The submit service subscribes to a type_update fanout exchange on RabbitMQ. When the ETL inserts a new type, it publishes an event to that exchange. The submit service receives the event and writes the types to a JSON cache file at /data/types-cache.json on a Docker volume. If RabbitMQ is down, the cache file is used as fallback — it even seeds with default types on first startup.

This ensured the dropdown always worked, even during outages."

### Resilience Demo

"Let me demonstrate the resilience improvement. I'll stop the entire joke microservice on VM1."

**[Paste in terminal:]**
```bash
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo down"
```

"VM1 is completely down. But the Submit app still works."

**[Switch to Submit UI — submit a joke, show it works]**

"The joke is on the RabbitMQ queue, waiting. The types dropdown works from the cache file."

**[Switch to RabbitMQ Console — show message count]**

"Message is queued. Now I'll bring VM1 back."

**[Paste:]**
```bash
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo up -d"
```

**[Wait a few seconds, check ETL logs:]**
```bash
ssh $SSH_OPTS $VM1 "sudo docker logs etl-app --tail 5"
```

"The ETL reconnected to RabbitMQ and processed the queued messages automatically. The system self-heals."

---

## 7:30 – 9:30 | OPTION 3 — KONG API GATEWAY + TERRAFORM (2 minutes)

**[Screen: Kong config or architecture diagram]**

"Option 3 required three things: an API gateway providing a single entry point, HTTPS encryption, and Terraform infrastructure as code.

I implemented **Kong** as a reverse proxy on VM3. Instead of users accessing multiple IPs and ports, everything goes through one URL. Kong runs in DB-less declarative mode — all configuration is in a single kong.yaml file."

### Single Entry Point

"Let me show the kong.yaml."

**[Switch to VS Code and open co3404-option2/kong-gateway/kong.yaml]**

"Each service has a URL pointing to the private IP of its VM. Routes map paths to services — /joke and /joke-types go to the joke-service on VM1 at 10.0.0.4:4000, /submit and /submit-types go to the submit-service on VM2 at 10.0.0.5:4200, /moderate and /moderated go to the moderate-service on VM2 at 10.0.0.5:4100. The microservices are hidden behind the gateway."

### HTTPS

**[Switch to browser — show HTTPS access]**

"All traffic is encrypted with HTTPS. I generated a TLS certificate using mkcert and deployed it to the Kong VM's filesystem — configured via KONG_SSL_CERT and KONG_SSL_CERT_KEY environment variables in docker-compose.yml, mounted as a Docker volume, not baked into the image. That was a specific requirement."

### Rate Limiting

"I applied the rate-limiting plugin to the joke service — set to 5 requests per minute to make it easy to demonstrate."

**[Paste in terminal:]**
```bash
for i in $(seq 1 10); do echo "Request $i: $(curl -s -o /dev/null -w '%{http_code}' http://$KONG_IP/joke-types)"; done
```

"Requests 1 through 5 return 200. Then 429 — Too Many Requests. Kong blocks excessive traffic before it reaches the backend."

### Terraform

**[Switch to VS Code: terraform files]**

"The infrastructure is managed using Terraform. The main.tf uses data sources for existing infrastructure like the resource group and subnet, and resource blocks for creating VMs with public IPs, network security groups, and NICs — each with static private IPs on the shared VNet. Let me show the key parts."

**[Show main.tf briefly — point out data sources, VM resources, and provisioners]**

"One `terraform apply` command creates all the VMs with the correct network config, public IP, and security group rules."

---

## 9:30 – 13:30 | OPTION 4 — EVERYTHING ELSE (4 minutes)

**[Screen: architecture diagram]**

"Option 4 is the biggest upgrade. It required five new features: a Moderate microservice, Event-Carried State Transfer, dual database support, OIDC authentication, and a continuous deployment pipeline. I also polished all the UIs."

### 4a: Moderate Microservice (1 minute)

"The moderate app adds a human review step. In Options 2-3, jokes went straight from the SUBMITTED_JOKES queue to the ETL. Now they go through a moderator first.

The message flow is: the submit app publishes to the SUBMITTED_JOKES queue, the moderate app pulls one joke at a time using channel.get() — that's pull-based, not push-based, the moderator controls the pace — the moderator can edit the setup, punchline, or type, then approve or reject. Approved jokes go to the MODERATED_JOKES queue. The ETL now consumes from MODERATED_JOKES instead of SUBMITTED_JOKES.

The moderate service uses two separate RabbitMQ channels — one for consuming from the submit queue and one for publishing to the moderated queue."

**[Switch to Moderate UI at http://KONG_IP/ — show a joke waiting]**

"Here's a joke waiting for review. The fields are editable. I can change the type from the dropdown or keep the submitted one. Approve sends it to the moderated queue with persistent delivery. Reject simply acknowledges and discards it."

**[Approve, show next joke auto-loading or 'Waiting for jokes' polling state]**

"When no jokes are waiting, the UI shows this polling state — it checks every second."

### 4b: ECST Events (1 minute)

"The Event-Carried State Transfer pattern is how types propagate across services. When the ETL inserts a new type into the database, it publishes a type_update event to a **fanout exchange** — that's the key design choice. A regular queue delivers each message to one consumer, but a fanout exchange broadcasts to all bound queues.

Both the submit service and the moderate service each have their own durable queue bound to this exchange. When a type_update event arrives, each service writes the updated types list to its local /data/types-cache.json file on a Docker volume.

Let me demonstrate."

**[Paste in terminal:]**
```bash
curl -s -X POST http://$KONG_IP/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"astronomy","setup":"How do astronomers organise a party?","punchline":"They planet!","isNewType":true}'
```

**[Switch to Moderate UI — approve the astronomy joke]**

**[Check ETL logs:]**
```bash
ssh $SSH_OPTS $VM1 "sudo docker logs etl-app --tail 5"
```

"ETL inserted the new type and published the type_update event. Now both dropdowns have 'astronomy' without any page refresh."

**[Show both Submit and Moderate dropdowns with the new type]**

### 4c: Dual Database (30 seconds)

"I support both MySQL and MongoDB, switchable via the DB_TYPE environment variable. Docker Compose profiles control which database container starts — `--profile mysql` starts MySQL, `--profile mongo` starts MongoDB. Only one runs at a time.

The code uses a factory pattern in db/index.js — it checks DB_TYPE and returns either the MySQL or MongoDB adapter. Both adapters expose the same query interface so the rest of the application code doesn't change at all."

**[Show MongoDB data:]**
```bash
ssh $SSH_OPTS $VM1 "sudo docker exec joke-database-mongo mongosh jokedb --eval 'db.types.find().toArray()'"
```

"Currently running MongoDB. Switching is a one-line env change plus swapping the Docker Compose profile — the application code doesn't change."

### 4d: OIDC Authentication (30 seconds)

"The moderate service requires authentication via Auth0 as my OIDC provider. I'm using the express-openid-connect library. The auth middleware is applied globally with authRequired set to false, so the moderate UI loads for everyone — but the POST /moderated endpoint is protected with a custom checkAuth middleware that returns 401 if the user isn't authenticated."

**[If not already logged in, show the Auth0 redirect]**

"Unauthenticated users get redirected to Auth0's login page. Let me prove the API is protected too."

**[Paste:]**
```bash
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" -X POST http://$KONG_IP/moderated
```

"401 — unauthorized. The checkAuth middleware blocks unauthenticated requests before they reach the route handler."

### 4e: CD Pipeline (30 seconds)

**[Show terraform main.tf with provisioners]**

"The deployment is fully automated with Terraform provisioners. Each VM resource has three stages: a remote-exec provisioner installs Docker via SSH, a file provisioner copies the project files, and another remote-exec provisioner runs docker compose up. One `terraform apply` — zero manual steps.

There's also a deploy.sh script that handles redeployment — it SCPs the updated code to each VM and restarts the containers."

### 4f: Polished UIs (15 seconds)

**[Quickly flash through all three UIs]**

"All three frontends share a consistent design — loading states, validation feedback, responsive layout, and smooth animations like the punchline fade-in. Professional and usable as the assignment required."

---

## 13:30 – 14:30 | OVERALL RESILIENCE + ARCHITECTURE SUMMARY (1 minute)

"Let me tie it all together. The progression from Option 1 to 4 follows a theme of **progressive decoupling**.

Option 1 — apps share a database directly. Tightly coupled to the data store.

Option 2 — a message queue decouples submit from the database. Loose coupling through asynchronous messaging.

Option 3 — an API gateway decouples users from the backend topology. One URL for everything.

Option 4 — events replace polling. Services don't call each other at all — state changes propagate reactively through the fanout exchange.

At each step, the system became more resilient. Right now, every service can fail independently and the others keep working. When services recover, queued messages are processed and event-driven caches resynchronise automatically. Nothing is lost — queues are durable, messages are persistent, and volumes preserve data."

---

## 14:30 – 15:00 | CONCLUSION (30 seconds)

"To summarise — I've implemented all four options: a containerised two-app system with a shared MySQL database in Option 1, a microservice architecture with RabbitMQ and an ETL service in Option 2, an API gateway with HTTPS and Terraform in Option 3, and event-driven moderation with dual databases, OIDC authentication, and automated deployment in Option 4.

The system is fully operational on Azure, resilient to failure, and every functional and non-functional requirement has been demonstrated. Thank you."

---

## TIMING SUMMARY

| Section | Duration | Running Total |
|---------|----------|---------------|
| Introduction | 0:30 | 0:30 |
| **OPTION 1** — joke + submit + DB demo | 3:30 | 4:00 |
| **OPTION 2** — RabbitMQ + ETL + cache + resilience | 3:30 | 7:30 |
| **OPTION 3** — Kong + HTTPS + rate limiting + Terraform | 2:00 | 9:30 |
| **OPTION 4a** — Moderate microservice | 1:00 | 10:30 |
| **OPTION 4b** — ECST events demo | 1:00 | 11:30 |
| **OPTION 4c** — Dual database | 0:30 | 12:00 |
| **OPTION 4d** — OIDC authentication | 0:30 | 12:30 |
| **OPTION 4e** — CD pipeline | 0:30 | 13:00 |
| **OPTION 4f** — Polished UIs | 0:15 | 13:15 |
| Architecture summary + resilience | 1:00 | 14:15 |
| Conclusion | 0:30 | 14:45 |

**Total: ~14:45** — safely under 15 minutes with a small buffer.

---

## CHEAT SHEET — All commands for copy-paste

```bash
# === VARIABLES ===
SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.251.8.242"
VM2="azureuser@51.120.83.211"
VM3="azureuser@20.100.190.184"
KONG_IP="20.100.190.184"

# === SHOW ALL CONTAINERS ===
ssh $SSH_OPTS $VM1 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh $SSH_OPTS $VM2 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"
ssh $SSH_OPTS $VM3 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'"

# === OPTION 1: JOKE API TESTS ===
curl -sk https://$KONG_IP/joke-types | python3 -m json.tool
curl -sk "https://$KONG_IP/joke/programming?count=3" | python3 -m json.tool

# === OPTION 2: SUBMIT A JOKE ===
curl -s -X POST http://$KONG_IP/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"dad","setup":"What do you call a fake noodle?","punchline":"An impasta!"}'

# === OPTION 2: ETL LOGS ===
ssh $SSH_OPTS $VM1 "sudo docker logs etl-app --tail 10"

# === OPTION 2: RESILIENCE — STOP VM1 ===
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo down"

# === OPTION 2: RESILIENCE — START VM1 ===
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo up -d"

# === OPTION 3: SHOW KONG CONFIG ===
# Open in VS Code: co3404-option2/kong-gateway/kong.yaml

# === OPTION 3: RATE LIMITING TEST ===
for i in $(seq 1 10); do echo "Request $i: $(curl -s -o /dev/null -w '%{http_code}' http://$KONG_IP/joke-types)"; done

# === OPTION 4a: SUBMIT JOKE FOR MODERATION ===
curl -s -X POST http://$KONG_IP/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"dad","setup":"Why did the scarecrow win an award?","punchline":"He was outstanding in his field!"}'

# === OPTION 4b: SUBMIT JOKE WITH NEW TYPE (ECST DEMO) ===
curl -s -X POST http://$KONG_IP/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"astronomy","setup":"How do astronomers organise a party?","punchline":"They planet!","isNewType":true}'

# === OPTION 4b: CHECK ETL LOGS FOR TYPE EVENT ===
ssh $SSH_OPTS $VM1 "sudo docker logs etl-app --tail 5"

# === OPTION 4c: SHOW MONGODB DATA ===
ssh $SSH_OPTS $VM1 "sudo docker exec joke-database-mongo mongosh jokedb --eval 'db.types.find().toArray()'"

# === OPTION 4d: TEST AUTH PROTECTION ===
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" -X POST http://$KONG_IP/moderated

# === DOCKER LOGS (DEBUGGING) ===
ssh $SSH_OPTS $VM1 "sudo docker logs joke-app --tail 20"
ssh $SSH_OPTS $VM1 "sudo docker logs etl-app --tail 20"
ssh $SSH_OPTS $VM2 "sudo docker logs submit-app --tail 20"
ssh $SSH_OPTS $VM2 "sudo docker logs moderate-app --tail 20"
ssh $SSH_OPTS $VM2 "sudo docker logs rabbitmq --tail 20"
ssh $SSH_OPTS $VM3 "sudo docker logs kong --tail 20"

# === START ALL VMS (before recording) ===
az vm start -g co3404-rg -n joke-vm --no-wait && az vm start -g co3404-rg -n kong-vm --no-wait && az vm start -g co3404-rg -n submit-vm --no-wait

# === STOP ALL VMS (after recording) ===
az vm deallocate -g co3404-rg -n joke-vm --no-wait && az vm deallocate -g co3404-rg -n kong-vm --no-wait && az vm deallocate -g co3404-rg -n submit-vm --no-wait

# === REDEPLOY (if needed before recording) ===
cd /Users/asifibrahim/Desktop/Distributed_system/co3404-option2 && bash deploy.sh
```

---

## ARCHITECTURE REFERENCE

### VMs and Private IPs
| VM | Azure Name | Public IP | Private IP | Services |
|----|-----------|-----------|------------|----------|
| VM1 | joke-vm | 20.251.8.242 | 10.0.0.4 | joke-app (4000), etl-app (4001), MongoDB (4002) |
| VM2 | submit-vm | 51.120.83.211 | 10.0.0.5 | submit-app (4200), moderate-app (4100), RabbitMQ (5672/15672) |
| VM3 | kong-vm | 20.100.190.184 | 10.0.0.6 | Kong Gateway (80→8000, 443→8443) |

### Kong Routes
| Path | Service | Backend |
|------|---------|---------|
| /joke, /joke-types | joke-service | 10.0.0.4:4000 |
| /submit, /submit-types, /docs | submit-service | 10.0.0.5:4200 |
| /moderate, /moderated, /moderate-types, /auth-status, /login, /logout, /callback, / | moderate-service | 10.0.0.5:4100 |

### RabbitMQ Queues & Exchange
| Name | Type | Purpose |
|------|------|---------|
| SUBMITTED_JOKES | Queue (durable) | Submit app publishes here, Moderate app pulls from here |
| MODERATED_JOKES | Queue (durable) | Moderate app publishes approved jokes, ETL consumes |
| type_update | Fanout Exchange (durable) | ETL publishes type events, Submit + Moderate subscribe |

### Key Files
| File | Purpose |
|------|---------|
| co3404-option1/docker-compose.yml | Option 1: single-host setup with MySQL |
| co3404-option2/joke-microservice/joke-app/server.js | Joke API: GET /types, GET /joke/:type |
| co3404-option2/joke-microservice/joke-app/db/index.js | DB adapter factory (MySQL or MongoDB) |
| co3404-option2/joke-microservice/etl/etl.js | ETL: consumes MODERATED_JOKES, writes to DB, publishes type events |
| co3404-option2/submit-microservice/submit-app/server.js | Submit API: POST /submit, types cache, fanout subscriber |
| co3404-option2/moderate-microservice/server.js | Moderate API: GET /moderate (pull), POST /moderated (approve/reject), Auth0 OIDC |
| co3404-option2/kong-gateway/kong.yaml | Kong declarative config: routes, rate limiting |
| co3404-option2/kong-gateway/terraform/main.tf | Terraform IaC: all VMs, NICs, NSGs, provisioners |
| co3404-option2/deploy.sh | Redeployment script: SCP + docker compose up |
