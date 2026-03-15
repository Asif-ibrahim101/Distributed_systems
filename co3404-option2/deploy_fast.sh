#!/bin/bash
set -e

SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.251.8.242"
VM2="azureuser@51.120.83.211"
VM3="azureuser@20.100.190.184"

echo "Copying zip to VM1 & VM2..."
scp $SSH_OPTS deploy.zip $VM1:~/
scp $SSH_OPTS deploy.zip $VM2:~/
scp $SSH_OPTS kong-gateway/kong.yaml $VM3:~/

echo "Deploying to VM1 (Joke Service)..."
ssh $SSH_OPTS $VM1 "sudo apt install -y unzip && unzip -o deploy.zip && cd joke-microservice && sudo docker compose --profile mongo up --build -d" &

echo "Deploying to VM2 (Submit, Moderate, RabbitMQ)..."
ssh $SSH_OPTS $VM2 "sudo apt install -y unzip && unzip -o deploy.zip && \
  cd rabbitmq && sudo docker compose up -d && \
  cd ../submit-microservice && sudo docker compose up --build -d && \
  cd ../moderate-microservice && sudo docker compose up --build -d" &

echo "Restarting Kong on VM3..."
ssh $SSH_OPTS $VM3 "sudo docker restart kong-gateway || sudo docker restart kong" &

wait
echo "Deployment complete!"
