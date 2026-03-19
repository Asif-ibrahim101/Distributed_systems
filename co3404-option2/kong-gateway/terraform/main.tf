terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

# ----- DATA SOURCES: Reference existing infrastructure -----

# Existing resource group (created during Option 2)
data "azurerm_resource_group" "existing" {
  name = var.resource_group_name
}

# Existing subnet inside the shared VNet
data "azurerm_subnet" "existing" {
  name                 = var.subnet_name
  virtual_network_name = var.vnet_name
  resource_group_name  = var.resource_group_name
}

# ----- RESOURCES: Create new Kong infrastructure -----

# Public IP for Kong VM (static so it doesn't change on reboot)
resource "azurerm_public_ip" "kong_ip" {
  name                = "${var.vm_name}-ip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
}

# Network Security Group — Kong-specific firewall rules
resource "azurerm_network_security_group" "kong_nsg" {
  name                = "${var.vm_name}-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  # SSH access
  security_rule {
    name                       = "AllowSSH"
    priority                   = 1000
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  # HTTP proxy (Kong)
  security_rule {
    name                       = "AllowHTTP"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  # HTTPS proxy (Kong)
  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  # Kong Admin API (HTTPS)
  security_rule {
    name                       = "AllowKongAdmin"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8445"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

# NIC with static private IP in the shared VNet
resource "azurerm_network_interface" "kong_nic" {
  name                = "${var.vm_name}-nic"
  location            = var.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.existing.id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.private_ip
    public_ip_address_id          = azurerm_public_ip.kong_ip.id
  }
}

# Associate NIC with Kong NSG
resource "azurerm_network_interface_security_group_association" "kong_nsg_assoc" {
  network_interface_id      = azurerm_network_interface.kong_nic.id
  network_security_group_id = azurerm_network_security_group.kong_nsg.id
}

# Kong VM — Ubuntu 22.04 LTS with SSH key authentication
resource "azurerm_linux_virtual_machine" "kong_vm" {
  name                = var.vm_name
  location            = var.location
  resource_group_name = var.resource_group_name
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [
    azurerm_network_interface.kong_nic.id
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file("~/.ssh/id_rsa.pub")
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  # Continuous Deployment Provisioning
  connection {
    type        = "ssh"
    user        = self.admin_username
    private_key = file("~/.ssh/id_rsa")
    host        = azurerm_public_ip.kong_ip.ip_address
  }

  # 1. Install Docker
  provisioner "remote-exec" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y ca-certificates curl gnupg lsb-release unzip",
      "sudo mkdir -m 0755 -p /etc/apt/keyrings",
      "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg || true",
      "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null",
      "sudo apt-get update",
      "sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-compose",
      "sudo usermod -aG docker ${self.admin_username}",
      "sudo chmod 666 /var/run/docker.sock || true"
    ]
  }

  # 2. Copy Kong gateway files to the VM
  provisioner "remote-exec" {
    inline = [
      "mkdir -p /home/${self.admin_username}/kong-gateway"
    ]
  }

  provisioner "file" {
    source      = "../docker-compose.yml"
    destination = "/home/${self.admin_username}/kong-gateway/docker-compose.yml"
  }

  provisioner "file" {
    source      = "../kong.yaml"
    destination = "/home/${self.admin_username}/kong-gateway/kong.yaml"
  }

  provisioner "file" {
    source      = "../certs"
    destination = "/home/${self.admin_username}/kong-gateway/certs"
  }

  # 3. Start the Kong container
  provisioner "remote-exec" {
    inline = [
      "cd /home/${self.admin_username}/kong-gateway",
      "sudo docker-compose up -d"
    ]
  }
}

# ----- JOKE VM (VM1: 10.0.0.4) -----

resource "azurerm_public_ip" "joke_ip" {
  name                = "joke-vm-ip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_security_group" "joke_nsg" {
  name                = "joke-vm-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "AllowSSH"
    priority                   = 1000
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowJokeApp"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4000"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_interface" "joke_nic" {
  name                = "joke-vm-nic"
  location            = var.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.existing.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.0.4"
    public_ip_address_id          = azurerm_public_ip.joke_ip.id
  }
}

resource "azurerm_network_interface_security_group_association" "joke_nsg_assoc" {
  network_interface_id      = azurerm_network_interface.joke_nic.id
  network_security_group_id = azurerm_network_security_group.joke_nsg.id
}

resource "azurerm_linux_virtual_machine" "joke_vm" {
  name                = "joke-vm"
  location            = var.location
  resource_group_name = var.resource_group_name
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [
    azurerm_network_interface.joke_nic.id
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file("~/.ssh/id_rsa.pub")
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  # Continuous Deployment Provisioning
  connection {
    type        = "ssh"
    user        = self.admin_username
    private_key = file("~/.ssh/id_rsa")
    host        = azurerm_public_ip.joke_ip.ip_address
  }

  # 1. Install Docker
  provisioner "remote-exec" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y ca-certificates curl gnupg lsb-release unzip",
      "sudo mkdir -m 0755 -p /etc/apt/keyrings",
      "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg || true",
      "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null",
      "sudo apt-get update",
      "sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-compose",
      "sudo usermod -aG docker ${self.admin_username}",
      "sudo chmod 666 /var/run/docker.sock || true"
    ]
  }

  # 2. Copy the joke microservice code to the VM (excluding node_modules)
  provisioner "local-exec" {
    command = "rsync -avz --exclude 'node_modules' --exclude '.DS_Store' -e 'ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_rsa' ../../joke-microservice ${self.admin_username}@${azurerm_public_ip.joke_ip.ip_address}:/home/${self.admin_username}/"
  }

  # 3. Set correct .env for Azure deployment and start containers
  provisioner "remote-exec" {
    inline = [
      "cd /home/${self.admin_username}/joke-microservice",
      "sed -i 's/RABBITMQ_IP=.*/RABBITMQ_IP=10.0.0.5/' .env",
      "sudo docker-compose --profile mongo up --build -d"
    ]
  }
}

# ----- SUBMIT VM (VM2: 10.0.0.5) — also hosts RabbitMQ and Moderate -----

resource "azurerm_public_ip" "submit_ip" {
  name                = "submit-vm-ip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_security_group" "submit_nsg" {
  name                = "submit-vm-nsg"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "AllowSSH"
    priority                   = 1000
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowSubmitApp"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4200"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowModerateApp"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4100"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowRabbitMQ"
    priority                   = 1003
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5672"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowRabbitMQAdmin"
    priority                   = 1004
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "15672"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_interface" "submit_nic" {
  name                = "submit-vm-nic"
  location            = var.location
  resource_group_name = var.resource_group_name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.existing.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.0.5"
    public_ip_address_id          = azurerm_public_ip.submit_ip.id
  }
}

resource "azurerm_network_interface_security_group_association" "submit_nsg_assoc" {
  network_interface_id      = azurerm_network_interface.submit_nic.id
  network_security_group_id = azurerm_network_security_group.submit_nsg.id
}

resource "azurerm_linux_virtual_machine" "submit_vm" {
  name                = "submit-vm"
  location            = var.location
  resource_group_name = var.resource_group_name
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [
    azurerm_network_interface.submit_nic.id
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file("~/.ssh/id_rsa.pub")
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  # Continuous Deployment Provisioning
  connection {
    type        = "ssh"
    user        = self.admin_username
    private_key = file("~/.ssh/id_rsa")
    host        = azurerm_public_ip.submit_ip.ip_address
  }

  # 1. Install Docker
  provisioner "remote-exec" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y ca-certificates curl gnupg lsb-release unzip",
      "sudo mkdir -m 0755 -p /etc/apt/keyrings",
      "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg || true",
      "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null",
      "sudo apt-get update",
      "sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-compose",
      "sudo usermod -aG docker ${self.admin_username}",
      "sudo chmod 666 /var/run/docker.sock || true"
    ]
  }

  # 2. Copy RabbitMQ, submit, and moderate microservice code (excluding node_modules)
  provisioner "local-exec" {
    command = "rsync -avz --exclude 'node_modules' --exclude '.DS_Store' -e 'ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_rsa' ../../rabbitmq ../../submit-microservice ../../moderate-microservice ${self.admin_username}@${azurerm_public_ip.submit_ip.ip_address}:/home/${self.admin_username}/"
  }

  # 3. Set correct .env values for Azure and start all containers
  provisioner "remote-exec" {
    inline = [
      # Fix submit .env for Azure IPs
      "cd /home/${self.admin_username}/submit-microservice",
      "sed -i 's/VM1_PRIVATE_IP=.*/VM1_PRIVATE_IP=10.0.0.4/' .env",
      "sed -i 's/RABBITMQ_IP=.*/RABBITMQ_IP=10.0.0.5/' .env",
      # Fix moderate .env for Azure IPs and Kong base URL
      "cd /home/${self.admin_username}/moderate-microservice",
      "sed -i 's/RABBITMQ_IP=.*/RABBITMQ_IP=10.0.0.5/' .env",
      "sed -i 's|BASE_URL=.*|BASE_URL=http://${azurerm_public_ip.kong_ip.ip_address}|' .env",
      # Start RabbitMQ first (other services depend on it)
      "cd /home/${self.admin_username}/rabbitmq && sudo docker-compose up -d",
      # Wait for RabbitMQ to be ready
      "sleep 15",
      # Start submit and moderate services
      "cd /home/${self.admin_username}/submit-microservice && sudo docker-compose up --build -d",
      "cd /home/${self.admin_username}/moderate-microservice && sudo docker-compose up --build -d"
    ]
  }
}

output "joke_vm_public_ip" {
  value = azurerm_public_ip.joke_ip.ip_address
}

output "submit_vm_public_ip" {
  value = azurerm_public_ip.submit_ip.ip_address
}

output "kong_public_ip" {
  description = "Kong VM public IP address"
  value       = azurerm_public_ip.kong_ip.ip_address
}

output "kong_private_ip" {
  description = "Kong VM private IP address"
  value       = var.private_ip
}

output "ssh_command" {
  description = "SSH command to connect to Kong VM"
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.kong_ip.ip_address}"
}
