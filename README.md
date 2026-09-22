# SRM Good Foods — Isolated Flask Application

A fully self-contained, standalone Flask application for the SRM Good Foods ordering platform.

## Features
- **Frontend**: Responsive HTML5, Vanilla CSS (`style.css`), Vanilla JS, Lucide icons, and Google Fonts (*Outfit* & *Playfair Display*).
- **Authentication**: Firebase Google Sign-In for customers + passcode protected staff portals (Admin, Kitchen, Delivery).
- **Payments**: Razorpay Order Creation & HMAC-SHA256 signature verification.
- **Database**: PostgreSQL (Supabase / Neon / local) with connection pooling, auto-migration, and auto-seeding.
- **Portals**:
  - Customer Storefront & Cart (`/`)
  - Real-Time Order Tracking with 4-Digit Delivery OTP (`/tracking`)
  - Kitchen Prep Dashboard (`/kitchen`)
  - Delivery Courier Dashboard with OTP Verification (`/delivery`)
  - Full Admin Command Console (`/admin`)

---

## Standalone Setup & Execution

1. **Navigate to the Flask application directory**:
   ```bash
   cd flask_app
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` (or edit the included `.env`):
   ```bash
   # Add your PostgreSQL connection string
   DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/[DB_NAME]
   ```

4. **Run the Flask App**:
   ```bash
   python app.py
   ```

5. **Access in browser**:
   - Storefront: [http://localhost:5000/](http://localhost:5000/)
   - Order Tracking: [http://localhost:5000/tracking](http://localhost:5000/tracking)
   - Kitchen Command: [http://localhost:5000/kitchen](http://localhost:5000/kitchen)
   - Delivery Partner: [http://localhost:5000/delivery](http://localhost:5000/delivery)
   - Admin Console: [http://localhost:5000/admin](http://localhost:5000/admin)
