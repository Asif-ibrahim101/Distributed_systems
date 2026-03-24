#!/bin/bash
set -e

SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.100.187.137"
VM2="azureuser@51.120.78.45"
VM3="azureuser@20.100.192.182"
KONG_PUBLIC_IP="20.100.192.182"

echo "Deploying to VM1 (Joke Service)..."
scp $SSH_OPTS -r joke-microservice $VM1:~/
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose up --build -d"

echo "Deploying to VM2 (Submit, Moderate, RabbitMQ)..."
scp $SSH_OPTS -r submit-microservice moderate-microservice rabbitmq $VM2:~/
ssh $SSH_OPTS $VM2 "
  cd ~/rabbitmq && sudo docker compose up -d && \
  cd ~/submit-microservice && sed -i 's/^KONG_IP=.*/KONG_IP=$KONG_PUBLIC_IP/' .env && sed -i 's/^RABBITMQ_IP=.*/RABBITMQ_IP=localhost/' .env && sed -i 's/^VM1_PRIVATE_IP=.*/VM1_PRIVATE_IP=10.0.0.4/' .env && sudo docker compose up --build -d && \
  cd ~/moderate-microservice && sed -i 's/^BASE_URL=.*/BASE_URL=https:\/\/$KONG_PUBLIC_IP/' .env && sudo docker compose up --build -d
"

echo "Deploying to VM3 (Kong Gateway)..."
scp $SSH_OPTS kong-gateway/kong.yaml $VM3:~/kong-gateway/kong.yaml
ssh $SSH_OPTS $VM3 "sudo docker restart kong-gateway || sudo docker restart kong"

echo "Deployment complete!"
