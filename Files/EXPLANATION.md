# What We Built: A Simple Explanation

This document explains exactly what we did to transform your Joke App from a basic, single-server setup (Option 1) into a professional, cloud-hosted microservices architecture (Option 2) on Azure.

## 1. The Starting Point (Option 1)
Originally, your application was a **monolith**. This means everything lived in one place:
- **One App:** Both the "Submit a Joke" and "Get a Joke" features were tightly bundled together.
- **One Database:** Everything directly talked to the same MySQL database.
- **One Location:** If that single server went down, or if the database got overwhelmed with people submitting jokes, the entire app (even people just trying to *read* jokes) would crash.

## 2. What We Changed (Option 2: Microservices)
We separated your app into **two distinct pieces (microservices)** so they could operate independently and handle more traffic safely.

### Part 1: The "Submit" Microservice (VM2)
This part is like a post office drop box. 
- When a user submits a new joke, the Submit App no longer tries to write it directly to the database. 
- Instead, it hands the joke to **RabbitMQ**, which acts like a highly reliable mail queue. 
- **Why?** Because even if the database is busy, offline, or broken, RabbitMQ will safely hold onto the joke until it can be processed. No jokes get lost.

### Part 2: The "Joke" Microservice (VM1)
This part is the main archive and display.
- **The ETL Service (The Mail Carrier):** We built a brand new "ETL" (Extract, Transform, Load) program. It constantly checks the RabbitMQ mail queue. When it finds a new joke, it safely inserts it into the MySQL Database.
- **The Joke App (The Display):** When users want to read jokes, it simply reads them from the database and shows them. 

**The Big Benefit:** If thousands of people try to submit jokes at once, RabbitMQ absorbs the spike. The ETL service processes them at its own pace. Meanwhile, people reading jokes on the Joke App notice zero slowdowns because it's completely separated from the submission chaos.

## 3. How We Deployed to Azure
Instead of running this on your laptop, we put it on the public internet using Microsoft Azure. Here is how Azure makes it work:

- **Two Virtual Machines (VMs):** Azure gave us two "computers in the cloud" located in Norway. One computer runs Part 1 (Submit), the other runs Part 2 (Joke).
- **Docker Containers:** We used Docker to package your code, MySQL, and RabbitMQ into neat, portable containers. We installed Docker on the Azure VMs and started the containers.
- **Private Networking:** Azure created a safe, private network tunnel between the two VMs. This allows the ETL Service on VM1 to securely connect to the RabbitMQ queue on VM2 without exposing that connection to the public internet.
- **Public IP Addresses:** We gave your frontend apps public IP addresses so anyone in the world can visit the websites in their browser.
- **Security Firewalls (NSG):** We configured Azure to only allow internet traffic on the specific "doors" (ports) your web apps use, keeping the databases and message queues safely locked down from hackers.

---
*Created on March 6, 2026. Your Azure deployment is fully active and functional!*

## 4. The Single Entry Point (Option 3: Kong API Gateway)

To make the architecture even more professional, secure, and easier to use, we added a **Kong API Gateway** using **Terraform** (Infrastructure as Code). This maps to the advanced requirements of your assignment.

### 🏗️ Automated Cloud Infrastructure (Terraform)
Instead of manually clicking through the Azure portal to create servers, we wrote Terraform code (`main.tf`, `variables.tf`). This treats infrastructure as code, allowing us to build it automatically and reproducibly. We used Terraform to provision a third Azure VM (`kong-vm`), give it a static public IP address (`20.100.190.184`), and apply strict firewall rules (NSGs) that only open necessary web ports.

### 🚦 The "Receptionist" (Kong Gateway)
Previously, users had to know two different IP addresses and ports to use your apps (one for the Joke app on VM1, another for the Submit app on VM2). 

Now, Kong acts as a single point of entry (a reverse proxy):
- **Single Address:** All user traffic goes exclusively to the Kong VM over standard web ports (`80` and `443`).
- **Smart Routing:** Kong looks at the requested URL path (e.g., `/joke/general` or `/submit`) and invisibly forwards the request to the correct private VM (`10.0.0.4` or `10.0.0.5`) across Azure's secure Virtual Network.
- **Conflict Resolution:** We updated both apps to use distinct paths (`/joke-types` and `/submit-types`) through Kong, resolving the routing conflict where both apps originally shared the exact same endpoint path.

### 🔒 Security & Reliability Upgrades
- **HTTPS Encryption:** We generated and deployed a secure TLS certificate using `mkcert`. This enables HTTPS, ensuring all traffic between the user's browser and the Kong Gateway is encrypted.
- **Spam Protection:** We added a rate-limiting plugin in Kong to enforce a maximum of 5 requests per minute on the joke reading endpoints. This protects your backend databases from being overwhelmed or crashed by spam requests (a Denial of Service attack).
