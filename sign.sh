#!/bin/bash

if [ -f .env ]; then set -a; source .env; set +a; fi
web-ext sign -s ./src -a ./dist --channel=unlisted --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET" --verbose