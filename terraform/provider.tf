
terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      env = "terraform"
      app = var.app_name
    }
  }
}

variable "aws_region" {
  type = string
}

variable "app_name" {
  type = string
}

variable "project_id" {
  type = string
}
