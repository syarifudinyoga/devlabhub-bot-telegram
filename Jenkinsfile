pipeline {
  agent any

  tools {
    nodejs 'NodeJS 22'
  }

  options {
    disableConcurrentBuilds()
  }

  parameters {
    string(
      name: 'GHCR_NAMESPACE',
      defaultValue: 'syarifudinyoga',
      description: 'Lowercase GitHub user or organization that owns the GHCR package',
      trim: true
    )
  }

  environment {
    VPS_HOST = '100.87.90.67'
    VPS_USER = 'devlabhub'
    VPS_DIR = '/home/devlabhub/devlabhub-telegram-bot'
    SSH_CREDENTIAL = 'biznet-vps'
    ENV_CREDENTIAL = 'devlabhub-telegram-bot-env'
    GHCR_CREDENTIAL = 'ghcr-write'
    PODMAN_COMPOSE = '~/.local/bin/podman-compose'
    IMAGE_NAME = 'devlabhub-telegram-bot'
    BUILDX_BUILDER = 'devlabhub-telegram-bot'
    VERSION = "${BUILD_NUMBER}"
  }

  stages {
    stage('Validate Inputs') {
      steps {
        script {
          if (!(params.GHCR_NAMESPACE ==~ /^[a-z0-9][a-z0-9-]{0,38}$/)) {
            error('GHCR_NAMESPACE must be a lowercase GitHub user or organization name.')
          }
          if (!(env.VERSION ==~ /^[0-9]+$/)) {
            error('Build number is not a safe container image tag.')
          }
        }
      }
    }

    stage('Checkout from Git') {
      steps {
        checkout scm
      }
    }

    stage('Unit Tests') {
      steps {
        sh '''
          set -eu
          npm ci --prefer-offline --no-audit --no-fund
          npm test
        '''
      }
    }

    stage('Build and Push Image to GHCR') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: env.GHCR_CREDENTIAL,
            usernameVariable: 'GHCR_USER',
            passwordVariable: 'GHCR_TOKEN'
          )
        ]) {
          sh '''
            set +x
            export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
            printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USER" --password-stdin
            trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
            docker buildx inspect "$BUILDX_BUILDER" >/dev/null 2>&1 || \
              docker buildx create --name "$BUILDX_BUILDER" --driver docker-container
            docker buildx inspect "$BUILDX_BUILDER" --bootstrap
            docker buildx build \
              --builder "$BUILDX_BUILDER" \
              --platform linux/amd64,linux/arm64 \
              --push \
              --tag "ghcr.io/${GHCR_NAMESPACE}/${IMAGE_NAME}:${VERSION}" \
              --file Dockerfile \
              .
          '''
        }
      }
    }

    stage('Check VPS Connection') {
      steps {
        sshagent([env.SSH_CREDENTIAL]) {
          sh '''
            ssh -o StrictHostKeyChecking=yes \
              ${VPS_USER}@${VPS_HOST} \
              "hostname && whoami && podman --version && ${PODMAN_COMPOSE} version"
          '''
        }
      }
    }

    stage('Prepare Bot Environment') {
      steps {
        withCredentials([
          file(
            credentialsId: env.ENV_CREDENTIAL,
            variable: 'BOT_ENV_FILE'
          )
        ]) {
          sh '''
            set +x
            test -f "$BOT_ENV_FILE"
            if ! awk -F= '$1 == "API_KEY" && length($2) >= 16 { found=1 } END { exit !found }' "$BOT_ENV_FILE"; then
              echo "API_KEY is missing or shorter than 16 characters in the Jenkins secret-file credential." >&2
              exit 1
            fi
            if ! grep -q '^TELEGRAM_BOT_TOKEN=.' "$BOT_ENV_FILE"; then
              echo "TELEGRAM_BOT_TOKEN is missing from the Jenkins secret-file credential." >&2
              exit 1
            fi
            cp "$BOT_ENV_FILE" .env
            chmod 600 .env
          '''
        }
      }
    }

    stage('Upload Compose and Environment') {
      steps {
        sshagent([env.SSH_CREDENTIAL]) {
          sh '''
            ssh -o StrictHostKeyChecking=yes \
              ${VPS_USER}@${VPS_HOST} "mkdir -p '${VPS_DIR}'"
            scp -o StrictHostKeyChecking=yes \
              compose.yaml \
              ${VPS_USER}@${VPS_HOST}:${VPS_DIR}/compose.yaml.new
            scp -o StrictHostKeyChecking=yes \
              .env \
              ${VPS_USER}@${VPS_HOST}:${VPS_DIR}/.env.new
            ssh -o StrictHostKeyChecking=yes \
              ${VPS_USER}@${VPS_HOST} \
              "chmod 644 '${VPS_DIR}/compose.yaml.new' && \
               chmod 600 '${VPS_DIR}/.env.new' && \
               mv -f '${VPS_DIR}/compose.yaml.new' '${VPS_DIR}/compose.yaml' && \
               mv -f '${VPS_DIR}/.env.new' '${VPS_DIR}/.env'"
          '''
        }
      }
    }

    stage('Validate VPS Compose') {
      steps {
        sshagent([env.SSH_CREDENTIAL]) {
          sh '''
            ssh -o StrictHostKeyChecking=yes \
              ${VPS_USER}@${VPS_HOST} \
              "cd '${VPS_DIR}' && GHCR_NAMESPACE='${GHCR_NAMESPACE}' VERSION='${VERSION}' ${PODMAN_COMPOSE} config >/dev/null"
          '''
        }
      }
    }

    stage('Pull Image on VPS') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: env.GHCR_CREDENTIAL,
            usernameVariable: 'GHCR_USER',
            passwordVariable: 'GHCR_TOKEN'
          )
        ]) {
          sshagent([env.SSH_CREDENTIAL]) {
            sh '''
              set +x
              case "$GHCR_USER" in
                ''|*[!A-Za-z0-9-]*)
                  echo "GHCR credential username contains unsupported characters." >&2
                  exit 1
                  ;;
              esac

              REMOTE_SCRIPT='set -eu
              IFS= read -r TOKEN
              printf "%s" "$TOKEN" | podman login ghcr.io --username "$1" --password-stdin
              trap "podman logout ghcr.io >/dev/null 2>&1 || true" EXIT
              cd "$2"
              GHCR_NAMESPACE="$3" VERSION="$4" "$HOME/.local/bin/podman-compose" pull bot'

              printf '%s\\n' "$GHCR_TOKEN" | ssh -T -o StrictHostKeyChecking=yes \
                ${VPS_USER}@${VPS_HOST} \
                "sh -c '$REMOTE_SCRIPT' sh '$GHCR_USER' '${VPS_DIR}' '${GHCR_NAMESPACE}' '${VERSION}'"
            '''
          }
        }
      }
    }

    stage('Deploy Bot') {
      steps {
        sshagent([env.SSH_CREDENTIAL]) {
          sh '''
            ssh -o StrictHostKeyChecking=yes \
              ${VPS_USER}@${VPS_HOST} \
              "cd '${VPS_DIR}' && GHCR_NAMESPACE='${GHCR_NAMESPACE}' VERSION='${VERSION}' ${PODMAN_COMPOSE} up -d --force-recreate bot"
          '''
        }
      }
    }

    stage('Health Check') {
      steps {
        sshagent([env.SSH_CREDENTIAL]) {
          sh '''
            ssh -o StrictHostKeyChecking=yes ${VPS_USER}@${VPS_HOST} 'sh -s' <<'REMOTE'
set -u
for i in $(seq 1 30); do
  STATUS=$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:3006/health || true)
  if [ "$STATUS" = "200" ]; then
    echo "DevLabHub bot health check passed."
    exit 0
  fi
  sleep 2
done
echo "DevLabHub bot health check failed."
podman logs --tail 50 devlabhub-telegram-bot 2>/dev/null || true
exit 1
REMOTE
          '''
        }
      }
    }

    stage('Prune Dangling Images') {
      steps {
        sshagent([env.SSH_CREDENTIAL]) {
          sh '''
            ssh -o StrictHostKeyChecking=yes \
              ${VPS_USER}@${VPS_HOST} "podman image prune -f"
          '''
        }
      }
    }
  }

  post {
    always {
      sh 'rm -f .env'
    }
  }
}
