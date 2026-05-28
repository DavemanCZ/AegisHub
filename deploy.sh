#!/bin/bash
set -e

echo "Deploying Aegis Hub..."

if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "WARNING: Please update .env with secure passwords!"
    exit 1
fi

docker-compose down
docker-compose up -d --build

echo "Aegis Hub deployed successfully!"
echo "It might take a few seconds for Caddy to provision the Let's Encrypt certificates."
