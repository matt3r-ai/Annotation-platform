variable "nomad-namespace" {
  type = string
  description = "Nomad namespace to deploy annotation platform to."
  default = "default"
}

variable "ap-frontend-image" {
  type = string
  description = "Annotation Platform frontend docker image."
  validation {
    condition = strlen(var.ap-frontend-image) > 0
    error_message = "Length of the image name can't be 0."
  }
}

variable "ap-backend-image" {
  type = string
  description = "Annotation Platform frontend docker image."
  validation {
    condition = strlen(var.ap-backend-image) > 0
    error_message = "Length of the image name can't be 0."
  }
}

job "annotation-platform" {
  datacenters = ["*"]
  namespace = "${var.nomad-namespace}"

  constraint {
    attribute = "${node.class}"
    operator = "regexp"
    value = "generic"
  }

  group "annotation-platform-frontend" {

    count = 1

    network {
      mode = "bridge"
      port "ap-frontend-port" {
        to = 80
      }
      dns {
        servers = ["172.16.32.144", "172.16.33.167"]
      }
    }

    service {
      name = "annotation-platform-frontend"
      port = "ap-frontend-port"
      tags = [
        "envoy.enable=true",
        "envoy.http.enabled=true",
        "envoy.http.vhost=annotation-platform.hyades.matt3r.ai",
        "envoy.http.domains=annotation-platform.hyades.matt3r.ai",
        "envoy.http.tls=true",
        "envoy.http.tls.sni=hyades.matt3r.ai"
      ]
      connect {
        sidecar_service {
          proxy {
            upstreams {
              destination_name = "annotation-platform-backend-connect"
              local_bind_port = 8000
            }
	        }
        }
      }
    }

    task "annotation-platform-frontend" {
      driver = "docker"

      config {
        image = "${var.ap-frontend-image}"
        ports = ["ap-frontend-port"]
      }

      resources {
        memory = 512
        cpu = 500
      }
    }
  }

  group "annotation-platform-backend" {

    count = 1

    constraint {
      attribute = "${node.class}"
      operator = "regexp"
      value = "generic"
    }  

    network {
      mode = "bridge"
      port "ap-backend-port" {
        to = 8000
      }
      dns {
        servers = ["172.16.32.144", "172.16.33.167"]
      }
    }

    service {
      name = "annotation-plarform-backend"
      port = "ap-backend-port"
    }

    service {
      name = "annotation-platform-backend-connect"
      port = "8000"
      connect {
        sidecar_service {}
      }
    }

    volume "annotation-platform-backend-volume" {
      type            = "csi"
      attachment_mode = "file-system"
      access_mode     = "single-node-writer"
      read_only       = false
      source          = "annotation-platform-backend-volume"
    }

    task "annotation-platform-backend" {
      driver = "docker"

      vault {}

      config {
        image = "${var.ap-backend-image}"
        ports = ["ap-backend-port"]
        extra_hosts = ["host.docker.internal:host-gateway"]
      }

      env {
        WISEAD_API_BASE = "http://host.docker.internal:9008"
      }

      resources {
        memory = 1024
        cpu = 1000
      }
    }
  }
}
