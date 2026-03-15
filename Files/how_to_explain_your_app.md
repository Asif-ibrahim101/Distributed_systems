# How to Explain Your App — Option by Option

This is written as if YOU are speaking to your professor. Read it, internalise it, then explain it in your own words.

---

## OPTION 1 — "Two apps, one database, one machine"

### What I built:

"In Option 1, I built two separate web applications — a Joke app and a Submit app — both running on Node.js with Express. They share a single MySQL database. Everything runs in Docker containers on one machine, orchestrated by a single docker-compose file.

The **Joke app** lets a user select a joke type from a dropdown — like general, programming, dad jokes — and click a button to get a random joke. The setup appears immediately, then after 3 seconds the punchline reveals with a fade-in animation. The dropdown is populated dynamically — every time you click on it, it calls the `/types` API endpoint which queries the database for all available types. This means if someone adds a new type through the Submit app, it shows up in the Joke app's dropdown without any page refresh.

The **Submit app** lets a user write a new joke — they enter a setup and punchline, pick an existing type from a dropdown or create a new one, and hit submit. It has client-side validation so you can't submit empty fields. It also has Swagger documentation at `/docs` where you can see and test all the API endpoints interactively.

The **MySQL database** has two tables — `types` and `jokes` — with a foreign key relationship. The types table has a UNIQUE constraint so you can never have duplicate types. I seeded it with about 20 jokes across four categories."

### How they connect:

"All three containers sit on a single Docker bridge network. The apps don't use IP addresses to reach the database — they use the Docker DNS service name `database`. Docker automatically resolves that name to the MySQL container's internal IP. Both apps use mysql2 connection pools, so they can handle multiple simultaneous requests without queuing.

The key thing about Option 1 is **service independence**. If I stop the Submit container, the Joke app keeps working — it only needs the database. If I stop the Joke container, the Submit app keeps working — it also only needs the database. They don't depend on each other at all."

### What I'd draw on a whiteboard:

```
[Joke App :4000] ──────┐
                        ├──── [MySQL :4002]
[Submit App :4200] ─────┘
        
All on ONE machine, ONE Docker network
```

---

## OPTION 1 → OPTION 2 — "What changed and why"

### The problem with Option 1:

"Option 1 has a limitation — everything is on one machine. If that machine goes down, the entire service dies. Also, both apps write directly to the database, which means they're tightly coupled to it. In a real production system, you'd want these services to be independent and resilient."

### What I changed:

"In Option 2, I split the system across two Azure Virtual Machines and introduced asynchronous messaging with RabbitMQ.

**VM1** runs the Joke app, a new ETL service, and the MySQL database.
**VM2** runs the Submit app and RabbitMQ.

The biggest change is that the **Submit app no longer talks to the database**. Instead of writing jokes directly to MySQL, it publishes a message to a RabbitMQ queue. Think of it like dropping a letter in a postbox — the submit app doesn't care if anyone is there to receive it right now. The message sits in the queue until someone picks it up.

That 'someone' is the **ETL service** — a new Node.js app I built that runs alongside the database on VM1. ETL stands for Extract, Transform, Load. It connects to RabbitMQ on VM2 as a consumer, and when a message arrives, it extracts the joke data, transforms it into the right format, and loads it into the database.

The other big change is how the Submit app gets the joke types for its dropdown. It can't read from MySQL anymore because the database is on a different VM. So it makes an HTTP request to the Joke app's `/types` endpoint across the Azure private network. The response gets cached to a JSON file on a Docker volume. If VM1 is completely down, the Submit app reads from this cache file instead — the types might be slightly stale, but the dropdown still works."

### How they connect now:

"The two VMs communicate over the Azure private network using static private IPs — 10.0.0.4 for VM1 and 10.0.0.5 for VM2. Traffic between them never goes over the public internet.

Within each VM, containers still use Docker DNS names. The joke app connects to `database`, not an IP. But across VMs, they use private IPs — the ETL connects to RabbitMQ at `amqp://10.0.0.5:5672`.

Messages in RabbitMQ are durable and persistent — they survive broker restarts. The ETL only acknowledges a message after successfully writing to the database, so if anything goes wrong, the message stays on the queue and gets reprocessed."

### What I'd draw:

```
VM1 (10.0.0.4)                    VM2 (10.0.0.5)
┌─────────────────┐              ┌─────────────────┐
│ [Joke App :4000]│◄──HTTP /types──│[Submit App :4200]│
│ [ETL :4001]     │◄──AMQP consume─│[RabbitMQ :5672] │
│ [MySQL :4002]   │              │                 │
└─────────────────┘              └─────────────────┘
        ▲                              │
        │                              │
    ETL writes                  Submit publishes
    to database                 to queue
```

### The key improvement:

"The system is now resilient to whole-VM failure. If VM1 goes down completely — joke app, ETL, database, everything — the Submit app still works. Users can keep submitting jokes, they just queue up in RabbitMQ. When VM1 comes back, the ETL processes all the queued messages and the database catches up. This is the power of loose coupling through message queues."

---

## OPTION 2 → OPTION 3 — "What changed and why"

### The problem with Option 2:

"In Option 2, users need to know two different IP addresses and port numbers to access the services. The Joke app is at one IP on port 4000, the Submit app is at another IP on port 4200. That's messy and exposes our internal architecture. There's also no encryption — everything is plain HTTP. And there's nothing stopping someone from hammering the API with thousands of requests."

### What I added:

"Option 3 introduces a **Kong API Gateway** on a third VM. Kong acts as a reverse proxy — it's the single front door to the entire system. Users only need one URL.

When a request comes in, Kong looks at the path and decides where to forward it:
- `/joke/general` → forwards to VM1's joke app
- `/submit` → forwards to VM2's submit app  
- `/docs` → forwards to VM2's Swagger docs

I also added **HTTPS** using TLS certificates generated with mkcert. Kong handles TLS termination — it decrypts incoming HTTPS traffic, then talks to the backend VMs over plain HTTP through the private network. The certificate files sit on the VM's filesystem and are mounted into Kong's container as a volume — they're not baked into the Docker image, which is what the assignment requires.

**Rate limiting** is a Kong plugin I applied to the joke service — I set it to 5 requests per minute so it's easy to demonstrate. After 5 requests, Kong returns a 429 Too Many Requests error.

The third key addition is **Terraform**. Instead of manually creating the Kong VM through the Azure portal, I wrote infrastructure-as-code. My Terraform config references the existing resource group, VNet, and subnet using data sources, and creates the Kong VM with a public IP and static private IP. One command — `terraform apply` — creates everything."

### How it connects:

"Kong is on VM3 at 10.0.0.6. It's the only VM that really needs a public IP now — users connect to Kong, and Kong routes to the backend VMs using their private IPs. All inter-service traffic stays on the Azure private network.

VM1 and VM2 are completely unchanged from Option 2. I didn't modify a single line of code on them. Kong just sits in front and routes traffic."

### What I'd draw:

```
User (browser)
      │
      ▼ HTTPS
[Kong Gateway :443]  ── VM3 (10.0.0.6)
      │         │
      ▼         ▼
   VM1         VM2
 (joke)     (submit)
```

### The key improvement:

"Users now interact with one URL, traffic is encrypted, and the joke API is protected from abuse. The internal architecture is hidden — you could move services to different VMs, add more instances, or completely restructure the backend, and the user would never know. That's the value of an API gateway."

---

## OPTION 3 → OPTION 4 — "What changed and why"

### The problem with Option 3:

"In Option 3, any joke submitted by any user goes straight into the database via the ETL. There's no quality control — someone could submit offensive or nonsensical jokes and they'd immediately appear in the system. Also, the system only supports MySQL. And the submit app still polls the joke service synchronously for types, which creates a dependency."

### What I changed — this is the biggest upgrade:

"Option 4 introduces five major changes. Let me walk through each one.

**First: the Moderate microservice.** I added a fourth VM running a new app where a human moderator reviews every joke before it reaches the database. The message flow changes from submit → ETL → database, to submit → moderate → ETL → database. The moderator sees the joke in editable text fields, can change the setup, punchline, or type, and then either approves it or rejects it. If they approve, it goes to the ETL. If they reject, it's discarded and the next joke loads.

The moderate app pulls jokes from the queue using `channel.get()` — that's pull-based, meaning the moderator controls the pace. They approve one joke, the app pulls the next. If no jokes are waiting, the UI shows a 'waiting for jokes' message and polls every second until one arrives.

**Second: RabbitMQ moves to its own VM.** In Option 2-3, RabbitMQ lived on VM2 with the submit app. But now three services need it — submit, moderate, and ETL. So I extracted it to its own dedicated VM5 at 10.0.0.8. All services connect to it over the private network.

**Third: Event-Carried State Transfer.** This is the core architectural pattern change. Instead of the submit app polling the joke service for types via HTTP, the system now uses events. Here's how it works:

When the ETL writes a joke to the database and the type was new, it publishes a `type_update` event to a RabbitMQ fanout exchange. A fanout exchange broadcasts to ALL bound queues — like a radio station. Both the submit app and moderate app subscribe to this exchange with their own queues. When the event arrives, they update their local types cache files.

This means the `/types` endpoint on submit and moderate just reads a local JSON file — no network call to the joke service needed. Types stay in sync through events, not polling. The system is eventually consistent without any tight coupling.

**Fourth: dual database.** The joke microservice now supports both MySQL and MongoDB, switchable with an environment variable. I used Docker Compose profiles — `--profile mysql` starts MySQL, `--profile mongo` starts MongoDB. Only one runs at a time. The code uses a database abstraction layer — a factory function that returns either a MySQL adapter or MongoDB adapter. Both adapters have identical interfaces, so the rest of the code doesn't change at all.

**Fifth: OIDC authentication.** The moderate service is a privileged role — not everyone should be able to approve or reject jokes. I integrated Auth0 as an OpenID Connect identity provider. When you visit the moderate page, if you're not logged in, you get redirected to Auth0's login page. After authenticating, you're redirected back with a session. The POST /moderated endpoint checks your authentication before accepting the request.

**Sixth: Continuous Deployment.** The moderate VM is deployed entirely through Terraform with provisioners. Running `terraform apply` creates the VM, installs Docker via SSH, copies the project files, and starts the containers — fully automated, zero manual steps.

**Seventh: Polished UIs.** All three frontends got a visual overhaul — consistent colour scheme, loading states, animations, responsive layout, and proper form validation."

### How everything connects now:

"The full message flow for a joke is:

1. User submits a joke through the Submit UI (via Kong)
2. Submit app publishes it to the 'submit' queue on VM5
3. Moderate app pulls it from the queue, moderator reviews it
4. Moderator approves → moderate app publishes to 'moderated' queue on VM5
5. ETL consumes from 'moderated' queue, writes to the database
6. If it was a new type, ETL publishes a type_update event to the fanout exchange
7. Both submit and moderate receive the event and update their types caches

Meanwhile, the Joke app just reads from the database and serves jokes. It doesn't participate in the messaging at all — it only needs the database."

### What I'd draw:

```
                    [Kong :443]
                   /     |      \
                  /      |       \
          [Joke]    [Submit]   [Moderate]
          VM1        VM2        VM4
            │          │           │
            │          └─publish──►│
            │            submit    │
            │            queue     │
            │                      │
            │          ┌─publish───┘
            │          │ moderated
            │          │ queue
            │◄─────────┘
          [ETL]
            │
            ▼
        [MySQL/MongoDB]
            │
            │ (if new type)
            ▼
      type_update event
       /            \
  [Submit]      [Moderate]
  cache           cache

        [RabbitMQ] — VM5 (central broker)
```

### The key improvements:

"Option 4 transforms the system from a message-based architecture to an event-driven architecture. The moderation step adds quality control. The ECST pattern eliminates synchronous dependencies between services. Dual database support demonstrates technology flexibility. OIDC adds security. And the CD pipeline demonstrates DevOps automation.

Each service can fail independently and the others keep working. When services recover, events and queued messages bring everything back into sync automatically."

---

## THE GOLDEN THREAD — How to tie it all together

"If you look at the progression from Option 1 to Option 4, there's a clear theme: **progressive decoupling**.

In **Option 1**, the apps share a database. They're distributed but tightly coupled to the data store.

In **Option 2**, I introduced a message queue. The submit app no longer knows about the database — it just drops messages. This is loose coupling through asynchronous messaging.

In **Option 3**, I added an API gateway. Now even the users don't know about the internal architecture — they see one URL. The services are decoupled from the client.

In **Option 4**, I replaced polling with events. Services don't even call each other anymore — state changes propagate reactively through a fanout exchange. This is event-driven decoupling.

At each step, the system became more resilient, more scalable, and more maintainable. Each service knows less about the others, which means you can change, replace, or scale any service without affecting the rest. That's the fundamental principle of distributed systems."
