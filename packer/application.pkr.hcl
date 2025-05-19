packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1"
    }
  }
}

variable "region" {}
variable "instance_type" {}
variable "bucket_name" {}
variable "version" {}

data "amazon-ami" "ubuntu-jammy" {
  region = "ap-northeast-1"
  filters = {
    name = "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
  }
  most_recent = true
  owners      = ["099720109477"]
}

source "amazon-ebs" "ubuntu-jammy" {
  region            = var.region
  source_ami        = data.amazon-ami.ubuntu-jammy.id
  instance_type     = var.instance_type
  ssh_username      = "ubuntu"
  ssh_agent_auth    = false
  ami_name          = "packer_AWS_{{timestamp}}_v${var.version}"
}

build {
  hcp_packer_registry {
    bucket_name = var.bucket_name
    description = <<EOT
Some nice description about the image being published to HCP Packer Registry.
    EOT
    bucket_labels = {
      "owner"          = "platform-team"
      "os"             = "Ubuntu",
      "ubuntu-version" = "Jammy 22.04",
    }

    build_labels = {
      "build-time"   = timestamp()
      "build-source" = basename(path.cwd)
    }
  }
  sources = [
    "source.amazon-ebs.ubuntu-jammy",
  ]
}
