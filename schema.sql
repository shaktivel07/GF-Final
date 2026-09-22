-- =====================================================================
-- SRM Good Foods — PostgreSQL Database Schema & Seed Data
-- Compatible with: PostgreSQL 13+, Supabase, Neon, AWS RDS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. USERS & PROFILES TABLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    firebase_uid VARCHAR NOT NULL,
    email VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    phone VARCHAR,
    role VARCHAR NOT NULL DEFAULT 'USER',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2. FOOD CATEGORIES TABLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    display_order INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 3. FOOD ITEMS / MENU TABLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_items (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES food_categories(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    description TEXT,
    price DOUBLE PRECISION NOT NULL,
    image_url TEXT,
    is_available BOOLEAN DEFAULT true,
    available_start_time TIME,
    available_end_time TIME,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4. DELIVERY LOCATIONS (SRM Campus Drop Spots)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    description VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 5. ORDERS TABLE (Razorpay Verified & OTP Handshake)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 6. ORDER ITEMS BREAKDOWN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    food_item_id INTEGER NOT NULL REFERENCES food_items(id),
    item_name_snapshot VARCHAR NOT NULL,
    price_snapshot DOUBLE PRECISION NOT NULL,
    quantity INTEGER NOT NULL,
    subtotal DOUBLE PRECISION NOT NULL
);

-- ---------------------------------------------------------------------
-- 7. RESTAURANT STORE SETTINGS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurant_settings (
    id SERIAL PRIMARY KEY,
    is_open_today BOOLEAN DEFAULT true,
    opening_time TIME DEFAULT '07:00:00',
    closing_time TIME DEFAULT '23:00:00',
    closed_message VARCHAR DEFAULT 'Kitchen is closed today for holiday/leave. Reopening tomorrow at 7:00 AM.',
    min_order_amount DOUBLE PRECISION DEFAULT 0,
    delivery_fee DOUBLE PRECISION DEFAULT 0,
    estimated_prep_time_mins INTEGER DEFAULT 25,
    announcement_banner VARCHAR DEFAULT 'Fresh & hot meals delivered across SRM campus!',
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- PERFORMANCE INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);
CREATE INDEX IF NOT EXISTS ix_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS ix_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_food_items_category_id ON food_items(category_id);
CREATE INDEX IF NOT EXISTS ix_food_items_is_available ON food_items(is_available);
CREATE INDEX IF NOT EXISTS ix_delivery_locations_is_active ON delivery_locations(is_active);
CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items(order_id);

-- =====================================================================
-- INITIAL SEED DATA
-- =====================================================================

-- 1. Default Restaurant Settings
INSERT INTO restaurant_settings (
    is_open_today, opening_time, closing_time, closed_message, min_order_amount, delivery_fee, estimated_prep_time_mins, announcement_banner, updated_at
) VALUES (
    true, '07:00:00', '23:00:00', 'Kitchen is currently closed. We reopen tomorrow at 7:00 AM.', 0, 0, 25, 'Fresh & delicious food delivered right to your SRM hostel or building!', NOW()
) ON CONFLICT DO NOTHING;

-- 2. Default SRM Campus Delivery Spots
INSERT INTO delivery_locations (name, description, is_active, created_at) VALUES
    ('Tech Park (TP)', 'Main Lobby / Reception Area', true, NOW()),
    ('University Building (UB)', 'Ground Floor Main Entrance', true, NOW()),
    ('Java Green Food Plaza', 'Central Food Court Seating', true, NOW()),
    ('MBA / Management Block', 'Portico / Waiting Lobby', true, NOW()),
    ('Bio-Tech Block', 'Front Entrance Lobby', true, NOW()),
    ('Hi-Tech / BEL Building', 'East Wing Entrance', true, NOW()),
    ('Mechanical & Civil Block', 'Workshop Block Porch', true, NOW()),
    ('Architecture & Design Block', 'Design Studio Portico', true, NOW()),
    ('Nelson Mandela Hostel', 'Hostel Main Gate / Security Desk', true, NOW()),
    ('Paari & Kaari Hostels', 'Hostel Complex Entrance', true, NOW()),
    ('Oori Hostel', 'Boys Hostel Main Entrance', true, NOW()),
    ('Adhiyaman Hostel', 'Boys Hostel Entrance Porch', true, NOW()),
    ('Meenakshi Hostel', 'Girls Hostel Security Gate', true, NOW()),
    ('Kalpana Chawla Hostel', 'Girls Hostel Security Gate', true, NOW()),
    ('Senbagam Hostel', 'Girls Hostel Security Gate', true, NOW()),
    ('SRM Hospital & Medical College', 'Hospital Gate 1 Entrance', true, NOW()),
    ('Main Campus Arch Gate', 'GST Road Main Entrance', true, NOW())
ON CONFLICT (name) DO NOTHING;

-- 3. Default Food Categories
INSERT INTO food_categories (id, name, display_order, is_active, created_at) VALUES
    (1, 'Biryanis & Rice', 1, true, NOW()),
    (2, 'Rolls & Fast Food', 2, true, NOW()),
    (3, 'North Indian Curries', 3, true, NOW()),
    (4, 'South Indian Classics', 4, true, NOW()),
    (5, 'Snacks & Starters', 5, true, NOW()),
    (6, 'Beverages & Shakes', 6, true, NOW()),
    (7, 'Desserts', 7, true, NOW())
ON CONFLICT (name) DO NOTHING;

-- Reset sequence for food categories
SELECT setval('food_categories_id_seq', (SELECT MAX(id) FROM food_categories));

-- 4. Initial Sample Dishes / Menu Items
INSERT INTO food_items (category_id, name, description, price, image_url, is_available, created_at) VALUES
    (1, 'SRM Special Chicken Dum Biryani', 'Aromatic seeraga samba rice cooked with tender spiced chicken pieces, served with raita and brinjal gravy.', 160.0, 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (1, 'Paneer Tikka Biryani', 'Fragrant basmati rice layered with charcoal grilled paneer cubes and saffron masala.', 140.0, 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (1, 'Egg Dum Biryani', 'Classic layered biryani with two hard-boiled golden fried eggs and spices.', 120.0, 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (2, 'Kolkata Chicken Kathi Roll', 'Flaky parotta wrap loaded with juicy marinated chicken, sliced onions, and mint chutney.', 90.0, 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (2, 'Crispy Paneer Roll', 'Golden fried spicy paneer wrapped in freshly toasted flatbread with signature mayo sauce.', 80.0, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (2, 'Double Egg Cheese Burger', 'Soft toasted brioche bun with crispy double egg patty, cheddar cheese, and house sauce.', 75.0, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (3, 'Butter Chicken Masala', 'Rich tomato and butter gravy with succulent roasted chicken bites.', 150.0, 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (3, 'Paneer Butter Masala', 'Creamy cottage cheese cubes simmered in spiced tomato gravy.', 130.0, 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (3, 'Butter Garlic Naan (2 Pcs)', 'Tandoor baked fluffy flatbread brushed with fresh garlic and melted butter.', 50.0, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (4, 'Ghee Roast Dosa', 'Golden crispy rice crepe cooked in pure ghee served with 3 chutneys and sambar.', 60.0, 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (4, 'Idli Vada Combo', 'Two steaming soft idlis and one crispy medu vada with hot sambar.', 45.0, 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (5, 'Crispy Chicken 65', 'Deep fried chicken chunks tossed with curry leaves and South Indian spices.', 110.0, 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (5, 'Peri Peri French Fries', 'Crispy skin-on potato fries dusted with zesty peri-peri seasoning.', 60.0, 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (6, 'Cold Coffee with Ice Cream', 'Chilled espresso blended with milk and topped with creamy vanilla ice cream.', 65.0, 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (6, 'Fresh Mango Lassi', 'Thick churned sweet yogurt blended with fresh Alphonso mango pulp.', 50.0, 'https://images.unsplash.com/photo-1528751014936-863e6e7a319c?auto=format&fit=crop&w=600&q=80', true, NOW()),
    (7, 'Gulab Jamun (2 Pcs)', 'Warm soft khoya dumplings soaked in fragrant cardamom rose syrup.', 40.0, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80', true, NOW())
ON CONFLICT DO NOTHING;
