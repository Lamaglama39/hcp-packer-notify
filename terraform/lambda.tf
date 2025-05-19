# Lambda 関数
data "archive_file" "lambda" {
  type        = "zip"
  source_file = "src/index.js"
  output_path = "dst/lambda_function.zip"
}

resource "aws_lambda_function" "notify_slack" {
  function_name    = "${var.app_name}-slack-notification"
  filename         = "dst/lambda_function.zip"
  source_code_hash = data.archive_file.lambda.output_base64sha256

  role    = aws_iam_role.lambda_role.arn
  handler = "index.handler"
  runtime = "nodejs22.x"
  timeout = 30

  environment {
    variables = {
      SLACK_WEBHOOK_PARAM_NAME = aws_ssm_parameter.slack_webhook.name
      SLACK_CHANNEL_PARAM_NAME = aws_ssm_parameter.slack_channel.name
    }
  }
}

resource "aws_lambda_function_url" "notify_slack" {
  function_name      = aws_lambda_function.notify_slack.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["https://api.cloud.hashicorp.com"]
    allow_methods = ["POST"]
  }
}
