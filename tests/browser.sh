#!/bin/sh
# Runs tests/browser-check.js in a real headless Chromium, in a Playwright container of the SafeAI Docker sidecar.
# The sidecar cannot see this folder, so the project is copied into the container and the pictures are copied back.
set -e
PROJECT=$(cd "$(dirname "$0")/.." && pwd)
CONTAINER=excelclone-browser2
IMAGE=mcr.microsoft.com/playwright:v1.49.0-noble
PLAYWRIGHT=playwright@1.49.0
export NO_PROXY=dind no_proxy=dind DOCKER_HOST=tcp://dind:2375

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker run -d --name "$CONTAINER" -w /tools "$IMAGE" sleep infinity >/dev/null
  docker exec "$CONTAINER" npm install --silent "$PLAYWRIGHT"
fi
docker start "$CONTAINER" >/dev/null
docker exec "$CONTAINER" sh -c 'mkdir -p /app && rm -rf /app/*'
docker cp "$PROJECT/." "$CONTAINER":/app >/dev/null
docker exec "$CONTAINER" sh -c 'mkdir -p /app/tests/out && NODE_PATH=/tools/node_modules node /app/tests/browser-check.js' && result=0 || result=$?
docker cp "$CONTAINER":/app/tests/out/. "$PROJECT/tests/out" >/dev/null
docker stop -t 1 "$CONTAINER" >/dev/null
exit $result
