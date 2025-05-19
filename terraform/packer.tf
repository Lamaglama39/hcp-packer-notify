# HCP packer
resource "hcp_packer_bucket" "staging" {
  name       = "${var.app_name}-bucket"
  project_id = var.project_id
}

# Webhook Config
resource "hcp_notifications_webhook" "example" {
  name        = "${var.app_name}-webhook"
  description = "Notify for all of the events for all Packer artifact versions existing in the project."
  project_id  = var.project_id

  config = {
    url = aws_lambda_function_url.notify_slack.function_url
  }

  subscriptions = [
    {
      events = [
        {
          actions = ["*"]
          source  = "hashicorp.packer.version"
        }
      ]
    }
  ]
}
