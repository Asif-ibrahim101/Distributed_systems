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
