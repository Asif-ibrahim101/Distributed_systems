variable "resource_group_name" {
  description = "Existing resource group name"
  type        = string
  default     = "co3404-rg"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "norwayeast"
}

variable "vnet_name" {
  description = "Existing VNet name"
  type        = string
  default     = "co3404-vnet"
}

variable "subnet_name" {
  description = "Existing subnet name"
  type        = string
  default     = "default"
}

variable "vm_name" {
  description = "Kong VM name"
  type        = string
  default     = "kong-vm"
}

variable "vm_size" {
  description = "VM size"
  type        = string
  default     = "Standard_B2ats_v2"
}

variable "admin_username" {
  description = "VM admin username"
  type        = string
  default     = "azureuser"
}

variable "private_ip" {
  description = "Static private IP for Kong VM"
  type        = string
  default     = "10.0.0.6"
}
