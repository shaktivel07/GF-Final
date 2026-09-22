"""
Database initialization and seeding script for SRM Good Foods Flask Backend.
Run this script to initialize your PostgreSQL / Supabase database from schema.sql.
"""

import os
import sys
from dotenv import load_dotenv
import psycopg2

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
load_dotenv()

DATABASE_URL = os.environ.get('DATABASE_URL', '')

if not DATABASE_URL:
    print('ERROR: DATABASE_URL is not set in flask_app/.env')
    print('Please edit flask_app/.env and set your DATABASE_URL before running this script.')
    sys.exit(1)

schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
if not os.path.exists(schema_path):
    print(f'ERROR: schema.sql not found at {schema_path}')
    sys.exit(1)

with open(schema_path, 'r', encoding='utf-8') as f:
    sql_script = f.read()

print('Connecting to PostgreSQL database...')
try:
    kwargs = {'dsn': DATABASE_URL}
    if 'sslmode' not in DATABASE_URL.lower() and 'localhost' not in DATABASE_URL and '127.0.0.1' not in DATABASE_URL:
        kwargs['sslmode'] = 'require'

    conn = psycopg2.connect(**kwargs)
    conn.autocommit = True
    with conn.cursor() as cur:
        print('Executing schema.sql...')
        cur.execute(sql_script)
    conn.close()
    print('Database initialized and seeded successfully!')
except Exception as e:
    print(f'Database initialization failed: {e}')
    sys.exit(1)
