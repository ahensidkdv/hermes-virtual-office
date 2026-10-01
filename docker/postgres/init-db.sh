#!/bin/bash
set -e

echo "🔧 Initializing PostgreSQL database..."

# Create extensions
psql -v ON_ERROR_STOP=1 --username postgres --dbname hvo <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL

echo "✅ PostgreSQL initialization complete"
