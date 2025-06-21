#!/bin/bash

# Define variables
EXTENSION_NAME="ai-price-tracker"
VERSION=$(jq -r '.version' src/manifest.json)
ARTIFACTS_DIR="dist"
SIGNED_FILE="$ARTIFACTS_DIR/$EXTENSION_NAME-$VERSION.xpi"

# Find the .xpi file and rename it
for file in "$ARTIFACTS_DIR"/*.xpi; do
  if [ -f "$file" ] && [[ ! "$file" =~ $EXTENSION_NAME ]]; then
      mv "$file" "$SIGNED_FILE"
      echo "Renamed $file to $SIGNED_FILE"
  fi
done