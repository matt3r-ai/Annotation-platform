terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 3.27"
    }
    vault = {
      source = "hashicorp/vault"
    }
    nomad = {
      source = "hashicorp/nomad"
    }
  }
  backend "s3" {
    bucket = "matt3r-terraform-states"
    key = "states/annotation-platform"
    region = "us-west-2"
    profile = "matt3r"
  }
  required_version = ">= 0.14.9"
}

provider "aws" {
  profile = "matt3r"
  region = "us-west-2"
}
