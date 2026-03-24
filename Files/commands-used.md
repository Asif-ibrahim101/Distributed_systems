# Terminal Commands Used

## Terraform Import (Importing Existing Azure Resources into State)

```bash
# Joke VM resources
terraform import azurerm_public_ip.joke_pip /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/publicIPAddresses/joke-vm-ip
terraform import azurerm_network_security_group.joke_nsg /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/networkSecurityGroups/joke-vm-nsg
terraform import azurerm_network_interface.joke_nic /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/networkInterfaces/joke-vm-nic
terraform import azurerm_network_interface_security_group_association.joke_nsg_assoc /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/networkInterfaces/joke-vm-nic
terraform import azurerm_linux_virtual_machine.joke_vm /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Compute/virtualMachines/joke-vm

# Submit VM resources
terraform import azurerm_public_ip.submit_pip /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/publicIPAddresses/submit-vm-ip
terraform import azurerm_network_security_group.submit_nsg /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/networkSecurityGroups/submit-vm-nsg
terraform import azurerm_network_interface.submit_nic /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/networkInterfaces/submit-vm-nic
terraform import azurerm_network_interface_security_group_association.submit_nsg_assoc /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Network/networkInterfaces/submit-vm-nic
terraform import azurerm_linux_virtual_machine.submit_vm /subscriptions/<sub-id>/resourceGroups/co3404-rg/providers/Microsoft.Compute/virtualMachines/submit-vm

# Remove orphaned resources from state
terraform state rm azurerm_network_interface.moderate_nic
terraform state rm azurerm_network_security_group.moderate_nsg
terraform state rm azurerm_network_interface_security_group_association.moderate_nsg_assoc
```

## Terraform Plan/Apply

```bash
terraform plan
terraform apply
```

## Starting/Stopping Azure VMs

```bash
# Start all VMs
az vm start -g co3404-rg -n joke-vm --no-wait
az vm start -g co3404-rg -n kong-vm --no-wait
az vm start -g co3404-rg -n submit-vm --no-wait

# Check VM power states
az vm list -g co3404-rg -d --query "[].{name:name, state:powerState}" -o table

# List VM names
az vm list -g co3404-rg --query "[].name" -o tsv

# Deallocate (stop billing) all VMs
az vm deallocate -g co3404-rg -n joke-vm --no-wait
az vm deallocate -g co3404-rg -n kong-vm --no-wait
az vm deallocate -g co3404-rg -n submit-vm --no-wait
```

## SSH Into VMs

```bash
SSH_OPTS="-o StrictHostKeyChecking=no -i ~/.ssh/id_rsa"
VM1="azureuser@20.251.8.242"   # joke-vm
VM2="azureuser@51.120.83.211"  # submit-vm
VM3="azureuser@20.100.190.184" # kong-vm

ssh $SSH_OPTS $VM1
ssh $SSH_OPTS $VM2
ssh $SSH_OPTS $VM3
```

## Fixing Docker Compose v2 on VMs (v1 incompatible with Docker 28.2)

```bash
# Install Docker Compose v2 plugin manually (run on each VM via SSH)
ssh $SSH_OPTS $VM1 "sudo mkdir -p /usr/local/lib/docker/cli-plugins && sudo curl -fsSL 'https://github.com/docker/compose/releases/download/v2.29.1/docker-compose-linux-x86_64' -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose"
ssh $SSH_OPTS $VM2 "sudo mkdir -p /usr/local/lib/docker/cli-plugins && sudo curl -fsSL 'https://github.com/docker/compose/releases/download/v2.29.1/docker-compose-linux-x86_64' -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose"
```

## Fixing Stale db.js Files on VM1 (Node resolves file before directory)

```bash
ssh $SSH_OPTS $VM1 "rm -f ~/joke-microservice/joke-app/db.js && rm -f ~/joke-microservice/etl/db.js"
```

## Deploying Services (deploy.sh)

```bash
cd /Users/asifibrahim/Desktop/Distributed_system/co3404-option2
bash deploy.sh
```

### What deploy.sh does:

```bash
# VM1 - Joke Service
scp $SSH_OPTS -r joke-microservice $VM1:~/
ssh $SSH_OPTS $VM1 "cd joke-microservice && sudo docker compose --profile mongo up --build -d"

# VM2 - Submit, Moderate, RabbitMQ
scp $SSH_OPTS -r submit-microservice moderate-microservice rabbitmq $VM2:~/
ssh $SSH_OPTS $VM2 "
  cd rabbitmq && sudo docker compose up -d && \
  cd ../submit-microservice && sudo docker compose up --build -d && \
  cd ../moderate-microservice && sudo docker compose up --build -d
"

# VM3 - Kong Gateway
scp $SSH_OPTS kong-gateway/kong.yaml $VM3:~/
ssh $SSH_OPTS $VM3 "sudo docker restart kong-gateway || sudo docker restart kong"
```

## Fixing .env on VMs (after SSH)

```bash
# On VM1: Fix DB_HOST for MongoDB
ssh $SSH_OPTS $VM1 "sed -i 's/DB_HOST=database/DB_HOST=mongodb/' ~/joke-microservice/.env"

# On VM2: Fix RabbitMQ IP for Linux (host.docker.internal doesn't work)
ssh $SSH_OPTS $VM2 "sed -i 's/RABBITMQ_IP=host.docker.internal/RABBITMQ_IP=10.0.0.5/' ~/submit-microservice/.env"
ssh $SSH_OPTS $VM2 "sed -i 's/RABBITMQ_IP=host.docker.internal/RABBITMQ_IP=10.0.0.5/' ~/moderate-microservice/.env"
```

## End-to-End Testing via curl

```bash
KONG_IP="20.100.190.184"

# Test joke types
curl -s http://$KONG_IP:8000/jokes/types

# Test random joke
curl -s http://$KONG_IP:8000/jokes/random

# Test HTTPS (via Kong with mkcert certs)
curl -sk https://$KONG_IP:8443/jokes/types

# Submit a joke
curl -s -X POST http://$KONG_IP:8000/submit/submitJoke \
  -H "Content-Type: application/json" \
  -d '{"type":"Programming","setup":"Why do programmers prefer dark mode?","punchline":"Because light attracts bugs!"}'

# Get next joke to moderate (pulls from RabbitMQ queue)
curl -s http://$KONG_IP:8000/moderate/nextJoke

# Test auth-protected endpoint (should return 401)
curl -s -o /dev/null -w "%{http_code}" -X POST http://$KONG_IP:8000/moderate/moderated

# Test rate limiting (should get 429 after limit)
for i in $(seq 1 10); do
  echo "Request $i: $(curl -s -o /dev/null -w '%{http_code}' http://$KONG_IP:8000/jokes/types)"
done

# Check Docker containers on each VM
ssh $SSH_OPTS $VM1 "sudo docker ps"
ssh $SSH_OPTS $VM2 "sudo docker ps"
ssh $SSH_OPTS $VM3 "sudo docker ps"

# Check Docker logs
ssh $SSH_OPTS $VM1 "sudo docker logs joke-app --tail 20"
ssh $SSH_OPTS $VM2 "sudo docker logs submit-app --tail 20"
ssh $SSH_OPTS $VM2 "sudo docker logs moderate-app --tail 20"
ssh $SSH_OPTS $VM2 "sudo docker logs rabbitmq --tail 20"
```
