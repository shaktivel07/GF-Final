import psycopg2
import psycopg2.pool
import psycopg2.extras
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
load_dotenv()

DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    print('CRITICAL WARNING: DATABASE_URL is not set in environment variables')

# ---------------------------------------------------------------------------
# Connection Pool
# ---------------------------------------------------------------------------
_pool = None


def get_pool():
    global _pool
    if _pool is None:
        db_url = os.environ.get('DATABASE_URL', '')
        if not db_url:
            raise ValueError("DATABASE_URL is not set in environment or .env file.")
        
        kwargs = {'minconn': 1, 'maxconn': 10, 'dsn': db_url}
        if 'sslmode' not in db_url.lower() and 'localhost' not in db_url and '127.0.0.1' not in db_url:
            kwargs['sslmode'] = 'require'

        _pool = psycopg2.pool.ThreadedConnectionPool(**kwargs)
    return _pool


def get_conn():
    return get_pool().getconn()


def put_conn(conn):
    get_pool().putconn(conn)


def query(sql, params=None, fetch='all'):
    """Execute a query and return rows (as dicts) or None for writes."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            if fetch == 'all':
                rows = cur.fetchall()
                conn.commit()
                return [dict(r) for r in rows]
            elif fetch == 'one':
                row = cur.fetchone()
                conn.commit()
                return dict(row) if row else None
            else:
                conn.commit()
                if cur.description:
                    rows = cur.fetchall()
                    return [dict(r) for r in rows]
                return cur.rowcount
    except Exception:
        conn.rollback()
        raise
    finally:
        put_conn(conn)


def execute(sql, params=None):
    """Execute a write query (INSERT/UPDATE/DELETE). Returns rowcount."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            conn.commit()
            if cur.description:
                rows = cur.fetchall()
                return [dict(r) for r in rows]
            return cur.rowcount
    except Exception:
        conn.rollback()
        raise
    finally:
        put_conn(conn)


def query_returning(sql, params=None):
    """Execute INSERT/UPDATE with RETURNING and return the row(s)."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            conn.commit()
            return [dict(r) for r in rows]
    except Exception:
        conn.rollback()
        raise
    finally:
        put_conn(conn)


# ---------------------------------------------------------------------------
# Audit Log (no-op to preserve storage)
# ---------------------------------------------------------------------------
def log_audit(user_id, action, details, ip_address='127.0.0.1'):
    """No-op: Audit logs are no longer written to PostgreSQL."""
    return


# ---------------------------------------------------------------------------
# SRM Default Delivery Locations
# ---------------------------------------------------------------------------
SRM_DEFAULT_LOCATIONS = [
    {'name': 'Tech Park (TP)', 'description': 'Main Lobby / Reception Area'},
    {'name': 'University Building (UB)', 'description': 'Ground Floor Main Entrance'},
    {'name': 'Java Green Food Plaza', 'description': 'Central Food Court Seating'},
    {'name': 'MBA / Management Block', 'description': 'Portico / Waiting Lobby'},
    {'name': 'Bio-Tech Block', 'description': 'Front Entrance Lobby'},
    {'name': 'Hi-Tech / BEL Building', 'description': 'East Wing Entrance'},
    {'name': 'Mechanical & Civil Block', 'description': 'Workshop Block Porch'},
    {'name': 'Architecture & Design Block', 'description': 'Design Studio Portico'},
    {'name': 'Nelson Mandela Hostel', 'description': 'Hostel Main Gate / Security Desk'},
    {'name': 'Paari & Kaari Hostels', 'description': 'Hostel Complex Entrance'},
    {'name': 'Oori Hostel', 'description': 'Boys Hostel Main Entrance'},
    {'name': 'Adhiyaman Hostel', 'description': 'Boys Hostel Entrance Porch'},
    {'name': 'Meenakshi Hostel', 'description': 'Girls Hostel Security Gate'},
    {'name': 'Kalpana Chawla Hostel', 'description': 'Girls Hostel Security Gate'},
    {'name': 'Senbagam Hostel', 'description': 'Girls Hostel Security Gate'},
    {'name': 'SRM Hospital & Medical College', 'description': 'Hospital Gate 1 Entrance'},
    {'name': 'Main Campus Arch Gate', 'description': 'GST Road Main Entrance'},
]


def _seed_default_locations():
    try:
        for loc in SRM_DEFAULT_LOCATIONS:
            existing = query(
                'SELECT id FROM delivery_locations WHERE LOWER(name) = LOWER(%s)',
                (loc['name'],),
            )
            if not existing:
                execute(
                    'INSERT INTO delivery_locations (name, description, is_active, created_at) VALUES (%s, %s, true, NOW())',
                    (loc['name'], loc['description']),
                )
    except Exception as e:
        print(f'Error seeding default delivery locations: {e}')


# ---------------------------------------------------------------------------
# Schema Initialization (lazy, once)
# ---------------------------------------------------------------------------
_schema_initialized = False


def cleanup_duplicate_users():
    """Remove any duplicate user rows in PostgreSQL and ensure unique index."""
    try:
        # Re-assign any order foreign keys pointing to duplicate user ids
        execute("""
            DO $$
            DECLARE
                r RECORD;
            BEGIN
                FOR r IN 
                    SELECT LOWER(email) as email, MIN(id) as keep_id, ARRAY_AGG(id) as all_ids 
                    FROM users 
                    GROUP BY LOWER(email) 
                    HAVING COUNT(*) > 1
                LOOP
                    UPDATE orders SET user_id = r.keep_id WHERE user_id = ANY(r.all_ids) AND user_id != r.keep_id;
                    DELETE FROM users WHERE id = ANY(r.all_ids) AND id != r.keep_id;
                END LOOP;
            END $$;
        """)
        execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_unique ON users(LOWER(email));")
    except Exception as e:
        print(f"User deduplication notice: {e}")


def ensure_database_ready():
    global _schema_initialized
    if _schema_initialized:
        return

    try:
        # Fast path: check if tables already exist
        row = query("SELECT to_regclass('public.users') as exists_flag", fetch='one')
        if row and row.get('exists_flag'):
            cleanup_duplicate_users()
            _schema_initialized = True
            return
    except Exception as e:
        print(f'Fast table check failed, attempting initialization: {e}')

    # Slow path: create schema
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    firebase_uid VARCHAR NOT NULL,
                    email VARCHAR NOT NULL,
                    name VARCHAR NOT NULL,
                    phone VARCHAR,
                    role VARCHAR NOT NULL DEFAULT 'USER',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS food_categories (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR NOT NULL UNIQUE,
                    display_order INTEGER DEFAULT 1,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS food_items (
                    id SERIAL PRIMARY KEY,
                    category_id INTEGER NOT NULL REFERENCES food_categories(id),
                    name VARCHAR NOT NULL,
                    description TEXT,
                    price DOUBLE PRECISION NOT NULL,
                    image_url TEXT,
                    is_available BOOLEAN DEFAULT true,
                    available_start_time TIME,
                    available_end_time TIME,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS delivery_locations (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR NOT NULL UNIQUE,
                    description VARCHAR,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    order_number VARCHAR NOT NULL UNIQUE,
                    idempotency_key VARCHAR UNIQUE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    delivery_location_id INTEGER NOT NULL REFERENCES delivery_locations(id),
                    location_name_snapshot VARCHAR NOT NULL,
                    delivery_person_id INTEGER REFERENCES users(id),
                    status VARCHAR NOT NULL DEFAULT 'CONFIRMED',
                    total_amount DOUBLE PRECISION NOT NULL,
                    payment_status VARCHAR DEFAULT 'PENDING',
                    razorpay_order_id VARCHAR UNIQUE,
                    razorpay_payment_id VARCHAR,
                    razorpay_signature VARCHAR,
                    otp_hash VARCHAR,
                    raw_otp VARCHAR,
                    otp_attempts INTEGER DEFAULT 0,
                    kitchen_notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    preparing_at TIMESTAMP,
                    prepared_at TIMESTAMP,
                    dispatched_at TIMESTAMP,
                    delivered_at TIMESTAMP,
                    cancelled_at TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS order_items (
                    id SERIAL PRIMARY KEY,
                    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                    food_item_id INTEGER NOT NULL REFERENCES food_items(id),
                    item_name_snapshot VARCHAR NOT NULL,
                    price_snapshot DOUBLE PRECISION NOT NULL,
                    quantity INTEGER NOT NULL,
                    subtotal DOUBLE PRECISION NOT NULL
                );

                CREATE TABLE IF NOT EXISTS restaurant_settings (
                    id SERIAL PRIMARY KEY,
                    is_open_today BOOLEAN DEFAULT true,
                    opening_time TIME DEFAULT '07:00:00',
                    closing_time TIME DEFAULT '23:00:00',
                    closed_message VARCHAR DEFAULT 'Kitchen is closed today for holiday/leave. Reopening tomorrow at 7:00 AM.',
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)

            # Indexes
            cur.execute("""
                CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS ix_users_firebase_uid ON users(firebase_uid);
                CREATE INDEX IF NOT EXISTS ix_orders_user_id ON orders(user_id);
                CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
                CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at DESC);
                CREATE INDEX IF NOT EXISTS ix_food_items_category_id ON food_items(category_id);
                CREATE INDEX IF NOT EXISTS ix_food_items_is_available ON food_items(is_available);
                CREATE INDEX IF NOT EXISTS ix_delivery_locations_is_active ON delivery_locations(is_active);
                CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items(order_id);
            """)
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        put_conn(conn)

    # Seed data
    _seed_default_locations()

    # Default settings
    settings_check = query('SELECT id FROM restaurant_settings LIMIT 1')
    if not settings_check:
        execute("""
            INSERT INTO restaurant_settings (is_open_today, opening_time, closing_time, closed_message, updated_at)
            VALUES (true, '07:00:00', '23:00:00', 'Kitchen is currently closed. We reopen at 7:00 AM.', NOW())
        """)

    _schema_initialized = True
