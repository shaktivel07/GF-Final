import os
import json
import hashlib
import hmac
import math
import random
import time
from datetime import datetime

from flask import Flask, request, jsonify, render_template, send_from_directory, session, redirect, url_for
from dotenv import load_dotenv
import razorpay

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
load_dotenv()

from db import query, execute, query_returning, log_audit, ensure_database_ready

# ---------------------------------------------------------------------------
# Flask App
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'srm-good-foods-flask-secret')

# ---------------------------------------------------------------------------
# Razorpay Client
# ---------------------------------------------------------------------------
RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', '')
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', '')

rzp_client = razorpay.Client(auth=(
    RAZORPAY_KEY_ID or 'rzp_placeholder',
    RAZORPAY_KEY_SECRET or 'secret_placeholder',
))

# ---------------------------------------------------------------------------
# Admin / Staff Passwords
# ---------------------------------------------------------------------------
ADMIN_EMAILS = [
    e.strip().lower()
    for e in (os.environ.get('ADMIN_EMAILS', '') or '').split(',')
    if e.strip()
]
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
KITCHEN_PASSWORD = os.environ.get('KITCHEN_PASSWORD', '')
DELIVERY_PASSWORD = os.environ.get('DELIVERY_PASSWORD', '')

# Firebase config (passed to templates)
FIREBASE_CONFIG = {
    'apiKey': os.environ.get('VITE_FIREBASE_API_KEY', ''),
    'authDomain': os.environ.get('VITE_FIREBASE_AUTH_DOMAIN', ''),
    'projectId': os.environ.get('VITE_FIREBASE_PROJECT_ID', ''),
    'storageBucket': os.environ.get('VITE_FIREBASE_STORAGE_BUCKET', ''),
    'messagingSenderId': os.environ.get('VITE_FIREBASE_MESSAGING_SENDER_ID', ''),
    'appId': os.environ.get('VITE_FIREBASE_APP_ID', ''),
    'measurementId': os.environ.get('VITE_FIREBASE_MEASUREMENT_ID', ''),
}

APP_URL = os.environ.get('VITE_APP_URL', 'https://goodfoods.srmtrc.in')


def match_password(input_pw, env_val):
    if not env_val or not input_pw:
        return False
    return input_pw in [p.strip() for p in env_val.split(',')]


def _serialize(obj):
    """Make psycopg2 results JSON-serializable."""
    if obj is None:
        return None
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, datetime):
        if obj.tzinfo is None:
            return obj.isoformat() + 'Z'
        return obj.isoformat()
    if isinstance(obj, (int, float, str, bool)):
        return obj
    return str(obj)


# ---------------------------------------------------------------------------
# Middleware: Ensure DB ready before every request
# ---------------------------------------------------------------------------
@app.before_request
def before_req():
    try:
        ensure_database_ready()
    except Exception as e:
        if request.path.startswith('/api/'):
            return jsonify({'error': f'Database connection error: {e}', 'code': 'DB_CONNECTION_ERROR'}), 500


# ---------------------------------------------------------------------------
# Page Routes (serve Jinja2 templates)
# ---------------------------------------------------------------------------
@app.route('/')
def page_store():
    return render_template('index.html',
                           firebase_config=json.dumps(FIREBASE_CONFIG),
                           razorpay_key_id=RAZORPAY_KEY_ID,
                           app_url=APP_URL)


@app.route('/tracking')
def page_tracking():
    return render_template('tracking.html',
                           firebase_config=json.dumps(FIREBASE_CONFIG),
                           razorpay_key_id=RAZORPAY_KEY_ID,
                           app_url=APP_URL)


@app.route('/kitchen')
def page_kitchen():
    if session.get('staff_role') not in ('KITCHEN', 'ADMIN'):
        return redirect('/?require_login=kitchen')
    return render_template('kitchen.html',
                           firebase_config=json.dumps(FIREBASE_CONFIG),
                           razorpay_key_id=RAZORPAY_KEY_ID,
                           app_url=APP_URL)


@app.route('/delivery')
def page_delivery():
    if session.get('staff_role') not in ('DELIVERY', 'ADMIN'):
        return redirect('/?require_login=delivery')
    return render_template('delivery.html',
                           firebase_config=json.dumps(FIREBASE_CONFIG),
                           razorpay_key_id=RAZORPAY_KEY_ID,
                           app_url=APP_URL)


@app.route('/admin')
def page_admin():
    if session.get('staff_role') != 'ADMIN':
        return redirect('/?require_login=admin')
    return render_template('admin.html',
                           firebase_config=json.dumps(FIREBASE_CONFIG),
                           razorpay_key_id=RAZORPAY_KEY_ID,
                           app_url=APP_URL)


@app.route('/logout')
def page_logout():
    session.clear()
    return redirect('/')


# =====================================================================
# 1. HEALTH CHECK
# =====================================================================
@app.route('/api/health')
def api_health():
    try:
        row = query('SELECT NOW() as db_time', fetch='one')
        return jsonify({
            'status': 'ok',
            'service': 'SRM Good Foods Flask Backend',
            'db': 'connected',
            'db_time': _serialize(row['db_time']),
            'timestamp': datetime.utcnow().isoformat(),
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# =====================================================================
# 2. AUTHENTICATION & USER MANAGEMENT
# =====================================================================
@app.route('/api/auth/sync-user', methods=['POST'])
def api_sync_user():
    data = request.get_json(force=True)
    firebase_uid = data.get('firebase_uid')
    email = data.get('email')
    name = data.get('name')
    phone = data.get('phone')

    if not firebase_uid or not email:
        return jsonify({'error': 'firebase_uid and email are required'}), 400

    normalized = email.strip().lower()
    is_admin_email = normalized in ADMIN_EMAILS

    try:
        existing = query(
            'SELECT id, firebase_uid, email, name, phone, role FROM users WHERE LOWER(email) = %s OR firebase_uid = %s ORDER BY id ASC',
            (normalized, firebase_uid),
        )

        if existing:
            user = existing[0]
            target_role = 'ADMIN' if is_admin_email else (user.get('role') or 'USER')
            clean_phone = phone.strip() if phone else user.get('phone')
            updated = query_returning(
                'UPDATE users SET firebase_uid = %s, name = COALESCE(%s, name), phone = COALESCE(%s, phone), role = %s, updated_at = NOW() WHERE id = %s RETURNING id, firebase_uid, email, name, phone, role',
                (firebase_uid, name or user.get('name'), clean_phone, target_role, user['id']),
            )
            user = updated[0] if updated else user

            # If duplicate rows exist, merge orders and remove extra rows
            if len(existing) > 1:
                for extra in existing[1:]:
                    execute('UPDATE orders SET user_id = %s WHERE user_id = %s', (user['id'], extra['id']))
                    execute('DELETE FROM users WHERE id = %s', (extra['id'],))
        else:
            target_role = 'ADMIN' if is_admin_email else 'USER'
            clean_phone = phone.strip() if phone else None
            created = query_returning(
                '''INSERT INTO users (firebase_uid, email, name, phone, role, created_at, updated_at) 
                   VALUES (%s, %s, %s, %s, %s, NOW(), NOW()) 
                   ON CONFLICT DO NOTHING 
                   RETURNING id, firebase_uid, email, name, phone, role''',
                (firebase_uid, normalized, name or 'SRM Customer', clean_phone, target_role),
            )
            if created:
                user = created[0]
                log_audit(user['id'], 'USER_REGISTERED', f'New customer signed in: {normalized}')
            else:
                user = query('SELECT id, firebase_uid, email, name, phone, role FROM users WHERE LOWER(email) = %s', (normalized,), fetch='one')

        return jsonify(_serialize({'user': user, **user}))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/update-phone', methods=['POST'])
def api_update_phone():
    data = request.get_json(force=True)
    firebase_uid = data.get('firebase_uid')
    phone = data.get('phone')

    if not firebase_uid or not phone:
        return jsonify({'error': 'firebase_uid and phone are required'}), 400

    clean_phone = phone.strip()
    if len(clean_phone) < 10:
        return jsonify({'error': 'Please enter a valid 10-digit phone number'}), 400

    try:
        result = query_returning(
            'UPDATE users SET phone = %s, updated_at = NOW() WHERE firebase_uid = %s RETURNING id, firebase_uid, email, name, phone, role',
            (clean_phone, firebase_uid),
        )
        if not result:
            return jsonify({'error': 'User not found'}), 404

        user = result[0]
        log_audit(user['id'], 'PHONE_UPDATED', f'User updated phone number to: {clean_phone}')
        return jsonify(_serialize({'user': user}))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/auth/portal-login', methods=['POST'])
def api_portal_login():
    data = request.get_json(force=True)
    username = data.get('username', '').strip().lower()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'Email / Username and password are required'}), 400

    # Kitchen
    kitchen_users = ['srm', 'kitchen', 'kitchen@srmgoodfoods.com', 'kitchen@srmist.edu.in', 'srm@srmist.edu.in']
    if username in kitchen_users and match_password(password, KITCHEN_PASSWORD):
        session['staff_role'] = 'KITCHEN'
        session['staff_user'] = {'id': -101, 'name': 'SRM Kitchen Master', 'role': 'KITCHEN', 'username': 'srm'}
        return jsonify({
            'portal': 'KITCHEN',
            'user': {'id': -101, 'name': 'SRM Kitchen Master', 'role': 'KITCHEN', 'username': 'srm',
                     'email': username if '@' in username else 'kitchen@srmgoodfoods.com'},
            'token': 'srm_kitchen_portal_token_2026',
        })

    # Delivery
    delivery_users = ['delivery', 'delivery@srmgoodfoods.com', 'delivery@srmist.edu.in', 'rider@srmgoodfoods.com']
    if username in delivery_users and match_password(password, DELIVERY_PASSWORD):
        session['staff_role'] = 'DELIVERY'
        session['staff_user'] = {'id': -102, 'name': 'SRM Delivery Executive', 'role': 'DELIVERY', 'username': 'delivery'}
        return jsonify({
            'portal': 'DELIVERY',
            'user': {'id': -102, 'name': 'SRM Delivery Executive', 'role': 'DELIVERY', 'username': 'delivery',
                     'email': username if '@' in username else 'delivery@srmgoodfoods.com'},
            'token': 'srm_delivery_portal_token_2026',
        })

    # Admin
    is_admin = username in ['admin', 'admin@srmgoodfoods.com', 'admin@srmist.edu.in'] or username in ADMIN_EMAILS
    if is_admin and match_password(password, ADMIN_PASSWORD):
        session['staff_role'] = 'ADMIN'
        session['staff_user'] = {'id': -100, 'name': 'SRM Administrator', 'role': 'ADMIN', 'username': 'admin'}
        return jsonify({
            'portal': 'ADMIN',
            'user': {'id': -100, 'name': 'SRM Administrator', 'email': username if '@' in username else 'admin@srmgoodfoods.com',
                     'role': 'ADMIN', 'username': 'admin'},
            'token': 'srm_admin_portal_token_2026',
        })

    # DB admin check
    try:
        db_admin = query(
            "SELECT id, name, email, role FROM users WHERE LOWER(email) = %s AND role = 'ADMIN' LIMIT 1",
            (username,),
        )
        if db_admin and match_password(password, ADMIN_PASSWORD):
            u = db_admin[0]
            session['staff_role'] = 'ADMIN'
            session['staff_user'] = {'id': u['id'], 'name': u.get('name') or 'SRM Administrator', 'role': 'ADMIN'}
            return jsonify({
                'portal': 'ADMIN',
                'user': {'id': u['id'], 'name': u.get('name') or 'SRM Administrator',
                         'email': u['email'], 'role': 'ADMIN', 'username': 'admin'},
                'token': 'srm_admin_portal_token_2026',
            })
    except Exception:
        pass

    return jsonify({'error': 'Invalid credentials. Please verify your email / username and password.'}), 401


# =====================================================================
# 3. RESTAURANT SETTINGS
# =====================================================================
@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    try:
        result = query('SELECT * FROM restaurant_settings ORDER BY id ASC LIMIT 1')
        if not result:
            inserted = query_returning(
                "INSERT INTO restaurant_settings (is_open_today, opening_time, closing_time, closed_message, updated_at) VALUES (true, '07:00:00', '23:00:00', 'Kitchen is currently closed. We reopen at 7:00 AM.', NOW()) RETURNING *"
            )
            return jsonify(_serialize(inserted[0]))
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/settings', methods=['PUT'])
def api_update_settings():
    data = request.get_json(force=True)
    try:
        existing = query('SELECT id FROM restaurant_settings LIMIT 1')
        if existing:
            updated = query_returning(
                'UPDATE restaurant_settings SET is_open_today = %s, opening_time = %s, closing_time = %s, closed_message = %s, updated_at = NOW() WHERE id = %s RETURNING *',
                (data.get('is_open_today'), data.get('opening_time'), data.get('closing_time'),
                 data.get('closed_message'), existing[0]['id']),
            )
        else:
            updated = query_returning(
                'INSERT INTO restaurant_settings (is_open_today, opening_time, closing_time, closed_message, updated_at) VALUES (%s, %s, %s, %s, NOW()) RETURNING *',
                (data.get('is_open_today'), data.get('opening_time'), data.get('closing_time'), data.get('closed_message')),
            )
        log_audit(None, 'SETTINGS_UPDATED',
                  f"Shop settings updated: is_open={data.get('is_open_today')}, hours={data.get('opening_time')}-{data.get('closing_time')}")
        return jsonify(_serialize(updated[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# 4. CATEGORIES
# =====================================================================
@app.route('/api/categories', methods=['GET'])
def api_get_categories():
    try:
        result = query('SELECT * FROM food_categories WHERE is_active = true ORDER BY display_order ASC, id ASC')
        return jsonify(_serialize(result))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/categories', methods=['POST'])
def api_add_category():
    data = request.get_json(force=True)
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Category name is required'}), 400
    try:
        result = query_returning(
            'INSERT INTO food_categories (name, display_order, is_active, created_at) VALUES (%s, %s, %s, NOW()) RETURNING *',
            (name, data.get('display_order', 0), data.get('is_active', True)),
        )
        log_audit(None, 'CATEGORY_ADDED', f'Added category: {name}')
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/categories/<int:cat_id>', methods=['PUT'])
def api_update_category(cat_id):
    data = request.get_json(force=True)
    try:
        result = query_returning(
            'UPDATE food_categories SET name = COALESCE(%s, name), display_order = COALESCE(%s, display_order), is_active = COALESCE(%s, is_active) WHERE id = %s RETURNING *',
            (data.get('name'), data.get('display_order'), data.get('is_active'), cat_id),
        )
        if not result:
            return jsonify({'error': 'Category not found'}), 404
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/categories/<int:cat_id>', methods=['DELETE'])
def api_delete_category(cat_id):
    try:
        execute('UPDATE food_categories SET is_active = false WHERE id = %s', (cat_id,))
        return jsonify({'success': True, 'message': 'Category deactivated'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# 5. FOOD ITEMS
# =====================================================================
@app.route('/api/items', methods=['GET'])
def api_get_items():
    include_all = request.args.get('all') == 'true'
    try:
        sql = """SELECT f.*, c.name as category_name
                 FROM food_items f LEFT JOIN food_categories c ON f.category_id = c.id"""
        if not include_all:
            sql += ' WHERE f.is_available = true AND (c.is_active = true OR c.is_active IS NULL)'
        sql += ' ORDER BY f.category_id ASC, f.id ASC'
        result = query(sql)
        return jsonify(_serialize(result))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/items', methods=['POST'])
def api_add_item():
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    price = data.get('price')
    if not name or price is None:
        return jsonify({'error': 'Name and price are required'}), 400
    try:
        result = query_returning(
            """INSERT INTO food_items
               (category_id, name, description, price, image_url, is_available, available_start_time, available_end_time, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING *""",
            (data.get('category_id'), name, data.get('description', ''), float(price),
             data.get('image_url', ''), data.get('is_available', True),
             data.get('available_start_time'), data.get('available_end_time')),
        )
        log_audit(None, 'ITEM_ADDED', f'Added food item: {name} (Rs. {price})')
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/items/<int:item_id>', methods=['PUT'])
def api_update_item(item_id):
    data = request.get_json(force=True)
    try:
        result = query_returning(
            """UPDATE food_items
               SET category_id = COALESCE(%s, category_id),
                   name = COALESCE(%s, name),
                   description = COALESCE(%s, description),
                   price = COALESCE(%s, price),
                   image_url = COALESCE(%s, image_url),
                   is_available = COALESCE(%s, is_available),
                   available_start_time = %s,
                   available_end_time = %s
               WHERE id = %s RETURNING *""",
            (data.get('category_id'), data.get('name'), data.get('description'),
             float(data['price']) if data.get('price') is not None else None,
             data.get('image_url'), data.get('is_available'),
             data.get('available_start_time'), data.get('available_end_time'), item_id),
        )
        if not result:
            return jsonify({'error': 'Item not found'}), 404
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def api_delete_item(item_id):
    try:
        execute('DELETE FROM food_items WHERE id = %s', (item_id,))
        return jsonify({'success': True, 'message': 'Item deleted'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# 6. DELIVERY LOCATIONS
# =====================================================================
@app.route('/api/locations', methods=['GET'])
def api_get_locations():
    show_all = request.args.get('all') == 'true'
    try:
        if show_all:
            result = query('SELECT * FROM delivery_locations ORDER BY name ASC')
        else:
            result = query('SELECT * FROM delivery_locations WHERE is_active = true ORDER BY name ASC')
        return jsonify(_serialize(result))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/locations', methods=['POST'])
def api_add_location():
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Location name is required'}), 400
    try:
        result = query_returning(
            'INSERT INTO delivery_locations (name, description, is_active, created_at) VALUES (%s, %s, %s, NOW()) RETURNING *',
            (name, data.get('description', ''), data.get('is_active', True)),
        )
        log_audit(None, 'LOCATION_ADDED', f'Added delivery location: {name}')
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/locations/<int:loc_id>', methods=['PUT'])
def api_update_location(loc_id):
    data = request.get_json(force=True)
    try:
        result = query_returning(
            'UPDATE delivery_locations SET name = COALESCE(%s, name), description = COALESCE(%s, description), is_active = COALESCE(%s, is_active) WHERE id = %s RETURNING *',
            (data.get('name'), data.get('description'), data.get('is_active'), loc_id),
        )
        if not result:
            return jsonify({'error': 'Location not found'}), 404
        return jsonify(_serialize(result[0]))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/locations/<int:loc_id>', methods=['DELETE'])
def api_delete_location(loc_id):
    hard = request.args.get('hard') == 'true'
    try:
        if hard:
            order_check = query('SELECT id FROM orders WHERE delivery_location_id = %s LIMIT 1', (loc_id,))
            if order_check:
                execute('UPDATE delivery_locations SET is_active = false WHERE id = %s', (loc_id,))
                return jsonify({'success': True, 'message': 'Location deactivated as it has associated order history'})
            execute('DELETE FROM delivery_locations WHERE id = %s', (loc_id,))
            return jsonify({'success': True, 'message': 'Location permanently deleted'})
        else:
            execute('UPDATE delivery_locations SET is_active = false WHERE id = %s', (loc_id,))
            return jsonify({'success': True, 'message': 'Location deactivated'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# 7. RAZORPAY PAYMENT & ORDER PLACEMENT
# =====================================================================
@app.route('/api/orders/create-razorpay-order', methods=['POST'])
def api_create_razorpay_order():
    data = request.get_json(force=True)
    items = data.get('items', [])
    firebase_uid = data.get('firebase_uid')

    if not items:
        return jsonify({'error': 'Cart is empty'}), 400

    try:
        # Phone check
        if firebase_uid:
            user_row = query('SELECT phone FROM users WHERE firebase_uid = %s', (firebase_uid,), fetch='one')
            if not user_row or not user_row.get('phone'):
                return jsonify({'error': 'Phone number is strictly required before placing order', 'code': 'PHONE_REQUIRED'}), 400

        # Restaurant open check
        settings_row = query('SELECT * FROM restaurant_settings LIMIT 1', fetch='one')
        if settings_row and not settings_row.get('is_open_today'):
            return jsonify({'error': settings_row.get('closed_message') or 'Restaurant is currently closed today.'}), 400

        # Validate items and calculate total
        item_ids = [i['food_item_id'] for i in items]
        placeholders = ','.join(['%s'] * len(item_ids))
        db_items = query(f'SELECT id, name, price, is_available FROM food_items WHERE id IN ({placeholders})', tuple(item_ids))
        db_map = {i['id']: i for i in db_items}

        total_amount = 0
        for cart_item in items:
            db_item = db_map.get(cart_item['food_item_id'])
            if not db_item or not db_item.get('is_available'):
                return jsonify({'error': f'Item "{cart_item.get("name", "selected")}" is currently unavailable'}), 400
            total_amount += db_item['price'] * cart_item['quantity']

        if total_amount <= 0:
            return jsonify({'error': 'Invalid order total'}), 400

        amount_in_paisa = round(total_amount * 100)

        rzp_order = rzp_client.order.create({
            'amount': amount_in_paisa,
            'currency': 'INR',
            'receipt': f'rcpt_{int(time.time())}_{random.randint(0, 999)}',
            'notes': {'firebase_uid': firebase_uid or ''},
        })

        return jsonify({
            'razorpay_order_id': rzp_order['id'],
            'amount': rzp_order['amount'],
            'currency': rzp_order.get('currency', 'INR'),
            'key_id': RAZORPAY_KEY_ID,
            'total_amount': total_amount,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/verify-and-place', methods=['POST'])
def api_verify_and_place():
    data = request.get_json(force=True)
    razorpay_order_id = data.get('razorpay_order_id')
    razorpay_payment_id = data.get('razorpay_payment_id')
    razorpay_signature = data.get('razorpay_signature')
    firebase_uid = data.get('firebase_uid')
    delivery_location_id = data.get('delivery_location_id')
    kitchen_notes = data.get('kitchen_notes', '')
    items = data.get('items', [])

    if not razorpay_order_id or not razorpay_payment_id or not razorpay_signature:
        return jsonify({'error': 'Missing Razorpay payment verification details'}), 400
    if not firebase_uid:
        return jsonify({'error': 'User authentication is required'}), 400
    if not delivery_location_id:
        return jsonify({'error': 'Please select a delivery location'}), 400

    try:
        # Verify signature
        generated = hmac.new(
            RAZORPAY_KEY_SECRET.encode('utf-8'),
            f'{razorpay_order_id}|{razorpay_payment_id}'.encode('utf-8'),
            hashlib.sha256,
        ).hexdigest()

        if generated != razorpay_signature:
            return jsonify({'error': 'Payment signature verification failed. Order not recorded.'}), 400

        # Get user
        user_row = query(
            'SELECT id, name, email, phone FROM users WHERE firebase_uid = %s', (firebase_uid,), fetch='one'
        )
        if not user_row:
            return jsonify({'error': 'User profile not found'}), 404

        if not user_row.get('phone'):
            return jsonify({'error': 'Phone number is strictly required before placing order', 'code': 'PHONE_REQUIRED'}), 400

        # Get location name
        loc_row = query('SELECT id, name FROM delivery_locations WHERE id = %s', (delivery_location_id,), fetch='one')
        location_name = loc_row['name'] if loc_row else 'Campus Location'

        # Validate items
        item_ids = [i['food_item_id'] for i in items]
        placeholders = ','.join(['%s'] * len(item_ids))
        db_items = query(f'SELECT id, name, price FROM food_items WHERE id IN ({placeholders})', tuple(item_ids))
        db_map = {i['id']: i for i in db_items}

        total_amount = 0
        validated_items = []
        for item in items:
            db_item = db_map.get(item['food_item_id'])
            if db_item:
                subtotal = db_item['price'] * item['quantity']
                total_amount += subtotal
                validated_items.append({
                    'food_item_id': db_item['id'],
                    'name': db_item['name'],
                    'price': db_item['price'],
                    'quantity': item['quantity'],
                    'subtotal': subtotal,
                })

        order_number = f'SRM-{random.randint(1000, 9999)}'
        raw_otp = str(random.randint(1000, 9999))
        otp_hash = hashlib.sha256(raw_otp.encode()).hexdigest()

        order_rows = query_returning(
            """INSERT INTO orders
               (order_number, user_id, delivery_location_id, location_name_snapshot, status, total_amount, payment_status,
                razorpay_order_id, razorpay_payment_id, razorpay_signature, raw_otp, otp_hash, otp_attempts, kitchen_notes, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, %s, NOW()) RETURNING *""",
            (order_number, user_row['id'], delivery_location_id, location_name,
             'CONFIRMED', total_amount, 'PAID',
             razorpay_order_id, razorpay_payment_id, razorpay_signature,
             raw_otp, otp_hash, kitchen_notes),
        )
        created_order = order_rows[0]

        for vi in validated_items:
            execute(
                """INSERT INTO order_items (order_id, food_item_id, item_name_snapshot, price_snapshot, quantity, subtotal)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (created_order['id'], vi['food_item_id'], vi['name'], vi['price'], vi['quantity'], vi['subtotal']),
            )

        log_audit(user_row['id'], 'ORDER_PLACED',
                  f'Order {order_number} placed for Rs. {total_amount}. Payment ID: {razorpay_payment_id}. Location: {location_name}')

        created_order['items'] = validated_items
        return jsonify(_serialize({'success': True, 'order': created_order}))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# 8. ORDER QUERIES & STATUS UPDATES
# =====================================================================
@app.route('/api/orders/my-orders')
def api_my_orders():
    firebase_uid = request.args.get('firebase_uid')
    if not firebase_uid:
        return jsonify({'error': 'firebase_uid is required'}), 400

    try:
        user_row = query('SELECT id FROM users WHERE firebase_uid = %s', (firebase_uid,), fetch='one')
        if not user_row:
            return jsonify([])

        orders = query(
            """SELECT o.*,
                json_agg(json_build_object(
                    'id', oi.id, 'food_item_id', oi.food_item_id,
                    'item_name', oi.item_name_snapshot, 'price', oi.price_snapshot,
                    'quantity', oi.quantity, 'subtotal', oi.subtotal
                )) as items
               FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id
               WHERE o.user_id = %s GROUP BY o.id ORDER BY o.created_at DESC""",
            (user_row['id'],),
        )
        return jsonify(_serialize(orders))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/track/<order_number>')
def api_track_order(order_number):
    try:
        orders = query(
            """SELECT o.*, u.name as customer_name, u.phone as customer_phone,
                json_agg(json_build_object(
                    'id', oi.id, 'food_item_id', oi.food_item_id,
                    'item_name', oi.item_name_snapshot, 'price', oi.price_snapshot,
                    'quantity', oi.quantity, 'subtotal', oi.subtotal
                )) as items
               FROM orders o JOIN users u ON o.user_id = u.id
               LEFT JOIN order_items oi ON o.id = oi.order_id
               WHERE o.order_number = %s OR o.id::text = %s
               GROUP BY o.id, u.name, u.phone""",
            (order_number, order_number),
        )
        if not orders:
            return jsonify({'error': 'Order not found'}), 404
        
        ord_data = orders[0]
        # Never expose OTP in public tracking endpoint
        ord_data['raw_otp'] = None
        ord_data['otp_hash'] = None
        return jsonify(_serialize(ord_data))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/kitchen')
def api_kitchen_orders():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    status_filter = request.args.get('status')
    
    where_clauses = ["1=1"]
    params = []

    if status_filter and status_filter != 'ALL':
        if status_filter == 'ACTIVE':
            where_clauses.append("o.status IN ('CONFIRMED', 'PREPARING')")
        elif status_filter == 'DONE':
            where_clauses.append("o.status IN ('DELIVERED', 'CLOSED', 'CANCELLED')")
        else:
            where_clauses.append("o.status = %s")
            params.append(status_filter)

    if start_date:
        where_clauses.append("o.created_at >= %s")
        params.append(start_date + " 00:00:00")

    if end_date:
        where_clauses.append("o.created_at <= %s")
        params.append(end_date + " 23:59:59")

    where_sql = " AND ".join(where_clauses)

    try:
        orders = query(
            f"""SELECT o.*, u.name as customer_name, u.phone as customer_phone,
                json_agg(json_build_object(
                    'id', oi.id, 'food_item_id', oi.food_item_id,
                    'item_name', oi.item_name_snapshot, 'price', oi.price_snapshot,
                    'quantity', oi.quantity, 'subtotal', oi.subtotal
                )) as items
               FROM orders o JOIN users u ON o.user_id = u.id
               LEFT JOIN order_items oi ON o.id = oi.order_id
               WHERE {where_sql}
               GROUP BY o.id, u.name, u.phone
               ORDER BY
                 CASE 
                   WHEN o.status='CONFIRMED' THEN 1 
                   WHEN o.status='PREPARING' THEN 2 
                   WHEN o.status='DISPATCHED' THEN 3 
                   WHEN o.status='UNPICKED' THEN 4
                   ELSE 5 
                 END ASC,
                 o.created_at DESC""",
            tuple(params) if params else None
        )
        # NEVER expose customer OTP to kitchen
        for o in orders:
            o['raw_otp'] = None
            o['otp_hash'] = None
        return jsonify(_serialize(orders))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/delivery')
def api_delivery_orders():
    try:
        # Delivery partners ONLY see orders that have been DISPATCHED by the kitchen (or unpicked/delivered)
        orders = query(
            """SELECT o.*, u.name as customer_name, u.phone as customer_phone,
                json_agg(json_build_object(
                    'id', oi.id, 'food_item_id', oi.food_item_id,
                    'item_name', oi.item_name_snapshot, 'price', oi.price_snapshot,
                    'quantity', oi.quantity, 'subtotal', oi.subtotal
                )) as items
               FROM orders o JOIN users u ON o.user_id = u.id
               LEFT JOIN order_items oi ON o.id = oi.order_id
               WHERE o.status IN ('DISPATCHED', 'UNPICKED', 'DELIVERED')
               GROUP BY o.id, u.name, u.phone
               ORDER BY
                 CASE 
                   WHEN o.status='DISPATCHED' THEN 1 
                   WHEN o.status='UNPICKED' THEN 2 
                   ELSE 3 
                 END ASC,
                 o.created_at DESC"""
        )
        # NEVER expose customer OTP to delivery partner (they must get it from customer upon handover)
        for o in orders:
            o['raw_otp'] = None
            o['otp_hash'] = None
        return jsonify(_serialize(orders))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>/status', methods=['POST'])
def api_update_order_status(order_id):
    data = request.get_json(force=True)
    status = data.get('status')
    actor = data.get('actor', 'Staff')

    valid = ['CONFIRMED', 'PREPARING', 'DISPATCHED', 'UNPICKED', 'CANCELLED', 'CLOSED']
    
    # Strictly block direct transition to DELIVERED without OTP verification
    if status == 'DELIVERED':
        return jsonify({
            'error': 'Cannot mark order as Delivered directly. The customer must provide the 4-digit OTP to complete handover.'
        }), 403

    if status not in valid:
        return jsonify({'error': f"Invalid status '{status}'. Valid: {', '.join(valid)}"}), 400

    try:
        ts_col = ''
        if status == 'PREPARING':
            ts_col = ', preparing_at = NOW()'
        elif status == 'DISPATCHED':
            ts_col = ', dispatched_at = NOW()'
        elif status in ('CANCELLED', 'CLOSED', 'UNPICKED'):
            ts_col = ', cancelled_at = NOW()'

        result = query_returning(
            f'UPDATE orders SET status = %s {ts_col} WHERE id = %s RETURNING *',
            (status, order_id),
        )
        if not result:
            return jsonify({'error': 'Order not found'}), 404

        order = result[0]
        # Never leak OTP
        order['raw_otp'] = None
        order['otp_hash'] = None
        log_audit(None, 'STATUS_UPDATED', f"Order {order['order_number']} status updated to {status} by {actor}")
        return jsonify(_serialize({'success': True, 'order': order}))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>/verify-otp', methods=['POST'])
def api_verify_otp(order_id):
    data = request.get_json(force=True)
    otp = data.get('otp', '').strip()
    actor = data.get('actor', 'Delivery Partner')

    if not otp or len(otp) != 4:
        return jsonify({'error': 'Please enter the 4-digit OTP provided by the customer'}), 400

    try:
        order_row = query('SELECT * FROM orders WHERE id = %s', (order_id,), fetch='one')
        if not order_row:
            return jsonify({'error': 'Order not found'}), 404

        if order_row.get('status') == 'DELIVERED':
            return jsonify({'error': 'Order is already marked as Delivered.'}), 400

        input_hash = hashlib.sha256(otp.encode()).hexdigest()
        is_match = (order_row.get('raw_otp') == otp) or (order_row.get('otp_hash') == input_hash)

        if not is_match:
            execute('UPDATE orders SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = %s', (order_id,))
            return jsonify({'error': 'Incorrect OTP. Please ask the customer for the correct 4-digit code.'}), 400

        updated = query_returning(
            "UPDATE orders SET status = 'DELIVERED', delivered_at = NOW() WHERE id = %s RETURNING *",
            (order_id,),
        )
        order_res = updated[0]
        order_res['raw_otp'] = None
        order_res['otp_hash'] = None
        log_audit(None, 'OTP_VERIFIED_DELIVERED',
                  f"Order {order_row['order_number']} delivered successfully with OTP verification by {actor}")

        return jsonify(_serialize({
            'success': True,
            'message': 'OTP verified! Order successfully handed over and marked as Delivered.',
            'order': order_res,
        }))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# 9. ADMIN ANALYTICS & USERS
# =====================================================================
@app.route('/api/admin/analytics')
def api_admin_analytics():
    try:
        rev = query("SELECT COALESCE(SUM(total_amount), 0) as total_revenue, COUNT(*) as total_orders FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED'", fetch='one')
        today = query("SELECT COALESCE(SUM(total_amount), 0) as today_revenue, COUNT(*) as today_orders FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED' AND created_at >= CURRENT_DATE", fetch='one')
        active = query("SELECT COUNT(*) as active_orders FROM orders WHERE status IN ('CONFIRMED', 'PREPARING', 'DISPATCHED')", fetch='one')
        status_dist = query('SELECT status, COUNT(*) as count FROM orders GROUP BY status')
        top_items = query("""SELECT oi.item_name_snapshot as name, SUM(oi.quantity) as total_quantity, SUM(oi.subtotal) as total_sales
                            FROM order_items oi JOIN orders o ON oi.order_id = o.id
                            WHERE o.payment_status = 'PAID' AND o.status != 'CANCELLED'
                            GROUP BY oi.item_name_snapshot ORDER BY total_quantity DESC LIMIT 6""")

        recent_logs = []
        try:
            recent_logs = query("""SELECT o.id, o.user_id,
                    'ORDER_' || o.status as action,
                    'Order #' || o.order_number || ' (' || o.status || ') - ₹' || o.total_amount || ' at ' || o.location_name_snapshot as details,
                    u.name as user_name, u.email as user_email, o.created_at
                 FROM orders o JOIN users u ON o.user_id = u.id
                 ORDER BY o.created_at DESC LIMIT 20""")
        except Exception:
            pass

        users_count = query('SELECT COUNT(*) as count FROM users', fetch='one')

        return jsonify(_serialize({
            'total_revenue': float(rev['total_revenue']),
            'total_orders': int(rev['total_orders']),
            'today_revenue': float(today['today_revenue']),
            'today_orders': int(today['today_orders']),
            'active_orders': int(active['active_orders']),
            'total_users': int(users_count['count']),
            'status_distribution': status_dist,
            'top_items': top_items,
            'recent_logs': recent_logs,
        }))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/users')
def api_admin_users():
    try:
        result = query("""SELECT u.id, u.firebase_uid, u.email, u.name, u.phone, u.role, u.created_at, u.updated_at,
                         COUNT(o.id) as orders_count, COALESCE(SUM(o.total_amount), 0) as total_spent
                         FROM users u LEFT JOIN orders o ON u.id = o.user_id AND o.payment_status = 'PAID'
                         GROUP BY u.id ORDER BY u.created_at DESC""")
        return jsonify(_serialize(result))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/clear-orders', methods=['POST'])
def api_clear_orders():
    data = request.get_json(force=True)
    mode = data.get('mode')
    try:
        if mode == 'COMPLETED_ONLY':
            ids_rows = query("SELECT id FROM orders WHERE status IN ('DELIVERED', 'CANCELLED')")
            ids = [r['id'] for r in ids_rows]
            if ids:
                placeholders = ','.join(['%s'] * len(ids))
                execute(f'DELETE FROM order_items WHERE order_id IN ({placeholders})', tuple(ids))
                execute(f'DELETE FROM orders WHERE id IN ({placeholders})', tuple(ids))
            return jsonify({'success': True, 'count': len(ids), 'message': f'Successfully cleared {len(ids)} completed orders.'})
        elif mode == 'ALL':
            execute('DELETE FROM order_items')
            count = execute('DELETE FROM orders')
            return jsonify({'success': True, 'count': count if isinstance(count, int) else 0, 'message': 'All orders cleared successfully.'})
        else:
            return jsonify({'error': "Invalid mode. Use 'COMPLETED_ONLY' or 'ALL'"}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
