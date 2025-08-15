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

  group "annotation-platform-frontend" {

    count = 1

    network {
      mode = "bridge"
      port "ap-frontend-port" {
        to = 9092
      }
      dns {
        servers = ["172.16.32.144", "172.16.33.167"]
      }
    }

    service {
      name = "annotation-platform-frontend"
      connect {
        sidecar_service {
          proxy {
            upstreams {
              destination_name = "annotation-platform-backend-connect"
              local_bind_port = 9092
            }
	        }
        }
      }
    }

    volume "ap-frontend-volume" {
      type            = "csi"
      attachment_mode = "file-system"
      access_mode     = "single-node-writer"
      read_only       = false
      source          = "ap-frontend-volume"
    }

    task "annotation-platform-frontend" {
      driver = "docker"

      volume_mount {
        volume = "ap-frontend-volume"
        destination = "/data"
        read_only = false
      }

      template {
        data = file("./templates/kafka.env.tpl")
        destination = "alloc/kafka.env"
        env = true
      }
    
      config {
        image = "apache/kafka:3.7.0"
        ports = ["kafka-broker-port", "kafka-controller-port"]
      }

      resources {
        memory = 2048
        cpu = 1000
      }
    }
  }

  group "fleet-telemetry-server" {

    count = 1

    constraint {
      attribute = "${node.class}"
      operator = "regexp"
      value = "generic"
    }  

    update {
      max_parallel     = 1
      canary           = 1
      min_healthy_time = "30s"
      healthy_deadline = "5m"
      auto_revert      = true
      auto_promote     = false
    }

    network {
      mode = "bridge"
      port "fleet-telemetry-server-port" {
        to = "443"
      }
      port "fleet-telemetry-metrics-port" {
        to = "9090"
      }
      dns {
        servers = ["172.16.32.144", "172.16.33.167"]
      }
    }

    service {
      name = "fleet-telemetry-server"
      port = "fleet-telemetry-server-port"
      tags = [
        "envoy.tcp=true",
        "envoy.tcp.host=fleet-telemetry"
      ]
      connect {
        sidecar_service {
          proxy {
            upstreams {
              destination_name = "fleet-telemetry-kafka-broker-connect"
              local_bind_port = 9092
            }
	      }
	    }
      }
    }

    service {
      name = "fleet-telemetry-metrics"
      port = "fleet-telemetry-metrics-port"
      tags = [ "prometheus" ]
    }

    task "fleet-telemetry-server" {
      driver = "docker"

      vault {}

      template {
        data = <<EOH
        SUPPRESS_TLS_HANDSHAKE_ERROR_LOGGING = true
        EOH

        destination = "alloc/fleet-telemetry-server.env"
        env = true
      }

      template {
        data = file("./templates/config.json.tpl")
        destination = "alloc/config.json"
        change_mode = "restart"
      }

      template {
        data = file("./templates/certificate.pem.tpl")
        destination = "${NOMAD_SECRETS_DIR}/certificate.pem"
        change_mode = "restart"
      }

      template {
        data = file("./templates/key.pem.tpl")
        destination = "${NOMAD_SECRETS_DIR}/key.pem"
        change_mode = "restart"
      }

      config {
        image = "${var.server-image}"
        ports = ["fleet-telemetry-server-port", "fleet-telemetry-metrics-port"]
        volumes = [
	  "alloc/config.json:/etc/fleet-telemetry/config.json",
	  "secrets/certificate.pem:/etc/fleet-telemetry/certificate.pem",
	  "secrets/key.pem:/etc/fleet-telemetry/key.pem"
	]
      }

      resources {
        memory = 2048
        cpu = 2000
      }
    }
  }

  group "fleet-telemetry-processor" {

    count = 1

    constraint {
      attribute = "${node.class}"
      operator = "regexp"
      value = "generic"
    }  

    network {
      mode = "bridge"
      dns {
        servers = ["172.16.32.144", "172.16.33.167"]
      }
    }

    service {
      name = "fleet-telemetry-processor"
      connect {
        sidecar_service {
          proxy {
            upstreams {
              destination_name = "fleet-telemetry-kafka-broker-connect"
              local_bind_port = 9092
            }
          }
        }
      }
    }

    volume "fleet-telemetry-data-vol" {
      type            = "csi"
      attachment_mode = "file-system"
      access_mode     = "single-node-writer"
      read_only       = false
      source          = "fleet-telemetry-data-vol"
    }

    task "fleet-telemetry-processor" {
      driver = "docker"

      volume_mount {
        volume = "fleet-telemetry-data-vol"
        destination = "/usr/src/app/data"
        read_only = false
      }

      vault {} 

      config {
        image = "${var.processor-image}"
      }

      template {
        data = <<EOH
        KAFKA_BROKER="127.0.0.1:9092"
        KAFKA_TOPIC=tesla_telemetry_V
        KAFKA_GROUP=trip_consumer_group
        OUTPUT_DIR=/usr/src/app/data
        APPSYNC_ENDPOINT="https://3ybqvhla55ff7ihuasuzk6rbwy.appsync-api.us-west-2.amazonaws.com/graphql"
        APPSYNC_ENDPOINT_DEV="https://du6jy3m37jgmnpip5swlzw4doa.appsync-api.us-west-2.amazonaws.com/graphql"
        APPSYNC_CLIENT_ROLE_ARN="arn:aws:iam::963414178352:role/service-role/dynamoDB_update-key-state_role"
        MIN_TRIP_DURATION=40
        EOH

        destination = "alloc/fleet-telemetry-processor.env"
        env = true
      }
    }
  }
}
