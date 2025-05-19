
variable "slack_webhook_url" {
  description = "Slack Webhook URL for notifications"
  type        = string
  sensitive   = true
}

variable "slack_channel" {
  description = "Slack Channel for notifications"
  type        = string
  sensitive   = true
}

# Parameter Store
resource "aws_ssm_parameter" "slack_webhook" {
  name        = "/${var.app_name}/slack-webhook"
  description = "Slack Webhook URL for Image Builder notifications"
  type        = "SecureString"
  value       = var.slack_webhook_url
}

resource "aws_ssm_parameter" "slack_channel" {
  name        = "/${var.app_name}/slack-channel"
  description = "Slack Channel for Image Builder notifications"
  type        = "SecureString"
  value       = var.slack_channel
}
