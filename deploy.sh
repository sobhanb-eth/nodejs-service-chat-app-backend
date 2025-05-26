#!/bin/bash

# ----------------------
# KUDU Deployment Script for Linux
# ----------------------

# Prerequisites
# -------------

# Verify node.js installed
if ! command -v node &> /dev/null; then
    echo "Missing node.js executable, please install node.js"
    exit 1
fi

# Setup
# -----

ARTIFACTS=${ARTIFACTS:-"../artifacts"}
DEPLOYMENT_SOURCE=${DEPLOYMENT_SOURCE:-"."}
DEPLOYMENT_TARGET=${DEPLOYMENT_TARGET:-"$ARTIFACTS/wwwroot"}
NEXT_MANIFEST_PATH=${NEXT_MANIFEST_PATH:-"$ARTIFACTS/manifest"}
PREVIOUS_MANIFEST_PATH=${PREVIOUS_MANIFEST_PATH:-"$ARTIFACTS/manifest"}

# Deployment
# ----------

echo "Handling node.js deployment."

# 1. KuduSync (if not in-place deployment)
if [ "$IN_PLACE_DEPLOYMENT" != "1" ]; then
    echo "Syncing files..."
    # For Linux, we'll use rsync or cp instead of KuduSync
    mkdir -p "$DEPLOYMENT_TARGET"
    rsync -av --exclude='.git' --exclude='.hg' --exclude='.deployment' --exclude='deploy.sh' --exclude='deploy.cmd' --exclude='node_modules' "$DEPLOYMENT_SOURCE/" "$DEPLOYMENT_TARGET/"
    if [ $? -ne 0 ]; then
        echo "File sync failed"
        exit 1
    fi
fi

# 2. Install npm packages
if [ -f "$DEPLOYMENT_TARGET/package.json" ]; then
    cd "$DEPLOYMENT_TARGET"
    echo "Installing npm packages..."
    npm install
    if [ $? -ne 0 ]; then
        echo "npm install failed"
        exit 1
    fi
fi

# 3. Build TypeScript
if [ -f "$DEPLOYMENT_TARGET/package.json" ]; then
    cd "$DEPLOYMENT_TARGET"
    echo "Building TypeScript..."
    echo "Current directory: $(pwd)"
    echo "Checking for tsconfig.json..."
    if [ -f "tsconfig.json" ]; then
        echo "tsconfig.json found"
    else
        echo "tsconfig.json NOT found"
    fi

    echo "Running npm run build..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "Main build failed, trying explicit build..."
        npm run build:explicit
        if [ $? -ne 0 ]; then
            echo "Build failed"
            exit 1
        fi
    fi
    echo "Build completed successfully"
fi

echo "Deployment finished successfully."
