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
}
