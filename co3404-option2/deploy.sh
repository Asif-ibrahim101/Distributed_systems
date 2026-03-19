#!/bin/bash
set -e

SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.100.185.233"
VM2="azureuser@20.100.186.237"
VM3="azureuser@20.100.186.201"

echo "Deploying to VM1 (Joke Service)..."
scp $SSH_OPTS -r joke-microservice $VM1:~/
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo up --build -d"

echo "Deploying to VM2 (Submit, Moderate, RabbitMQ)..."
scp $SSH_OPTS -r submit-microservice moderate-microservice rabbitmq $VM2:~/
ssh $SSH_OPTS $VM2 "
  cd rabbitmq && sudo docker compose up -d && \
  cd ../submit-microservice && sudo docker compose up --build -d && \
  cd ../moderate-microservice && sudo docker compose up --build -d
"

echo "Deploying to VM3 (Kong Gateway)..."
scp $SSH_OPTS kong-gateway/kong.yaml $VM3:~/
ssh $SSH_OPTS $VM3 "sudo docker restart kong-gateway || sudo docker restart kong"

echo "Deployment complete!"
