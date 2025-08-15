pipeline {
  agent any

  environment {
    VAULT_ADDR                             = "https://vault.hyades.matt3r.ai:8200"
    VAULT_TOKEN                            = credentials('jenkins-vault-token')
    CONSUL_HTTP_ADDR                       = "https://consul.hyades.matt3r.ai:8501"
    CONSUL_HTTP_TOKEN                      = credentials('jenkins-consul-token')
    NOMAD_ADDR                             = "https://nomad.hyades.matt3r.ai:4646"
    NOMAD_TOKEN                            = credentials('jenkins-nomad-token')
    registryName                           = '963414178352.dkr.ecr.us-west-2.amazonaws.com'
    registryNameSpace                      = '/annotation-platform'
    apBackendImageName                     = 'annotation-platform-backend'
    apFrontendImageName                    = 'annotation-platform-frontend'
    apBackendImage                         = ''
    apFrontendImage                        = ''
  }
  
  stages {
    stage('Building artifacts (annotation-platform backend)') {
      steps {
        script {
          apBackendImage = docker.build(registryName + registryNameSpace + \
            apBackendImageName + ":$BUILD_NUMBER", "-f backend/Dockerfile backend")
        }
      }
    }

    stage('Building artifacts (annotation-platform frontend)') {
      steps {
        script {
          apFrontendImage = docker.build(registryName + registryNameSpace + \
            apFrontendImageName + ":$BUILD_NUMBER", "-f frontend/Dockerfile frontend")
        }
      }
    }

    stage('Publishing artifacts (annotation-platform)') {
      steps {
        script {
          sh "aws --region us-west-2 ecr get-login-password | docker login --username AWS --password-stdin 963414178352.dkr.ecr.us-west-2.amazonaws.com"
          apBackendImage.push()
          apFrontendImage.push()
          apBackendImage.push 'latest'
          apFrontendImage.push 'latest'
        }
      }
    }

//    stage('Deploying to Nomad cluster') {
//      steps {
//        script {
//            echo "Deploying to nomad cluster (staging - processor only)"
//            sh """
//              cd nomad && nomad job run -detach -region=us-west-2 \
//              -var processor-image=${fleetTelemetryProcessorStagingImage.id} \
//              fleet-telemetry.hcl
//            """
//        }
//      }
//    }
  }
}
