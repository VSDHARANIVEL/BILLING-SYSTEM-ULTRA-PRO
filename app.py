"""
=============================================================
  BillPro — Flask Backend
  Database  : Supabase (PostgreSQL)
  Deploy    : Railway / Render / any VPS
  Local run : python app.py
=============================================================
  ENV VARIABLES  (set in Railway / Render dashboard):
    DATABASE_URL   — Supabase connection string
                     postgresql://user:pass@host:5432/dbname
    SECRET_KEY     — any long random string
    MGR_USERNAME   — manager login username  (default: manager)
    MGR_PASSWORD   — manager login password  (default: manager123)
    ALLOWED_ORIGINS— comma-separated allowed domains
                     e.g. https://mybillpro.com,https://www.mybillpro.com
=============================================================
"""

import os, io, hashlib
from datetime import datetime, date
from contextlib import contextmanager

from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
import psycopg2
import psycopg2.extras          # RealDictCursor
import psycopg2.pool

try:
    import openpyxl
    OPENPYXL_OK = True
except ImportError:
    OPENPYXL_OK = False

# ══════════════════════════════════════════════════════════════
#  CONFIG  — all from environment variables
# ══════════════════════════════════════════════════════════════
DATABASE_URL    = os.environ.get('DATABASE_URL', '')
SECRET_KEY      = os.environ.get('SECRET_KEY',   'billpro-change-this-in-production')
MGR_USER        = os.environ.get('MGR_USERNAME',  'manager')
MGR_PASS        = os.environ.get('MGR_PASSWORD',  'manager123')
PORT            = int(os.environ.get('PORT', 5000))

_raw_origins    = os.environ.get('ALLOWED_ORIGINS', 'http://localhost:5000,http://127.0.0.1:5000')
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(',') if o.strip()]

# ══════════════════════════════════════════════════════════════
#  FLASK APP
# ══════════════════════════════════════════════════════════════
app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = SECRET_KEY
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE']   = os.environ.get('HTTPS', 'false').lower() == 'true'

CORS(app, supports_credentials=True, origins=ALLOWED_ORIGINS)

# ══════════════════════════════════════════════════════════════
#  DATABASE — connection pool
# ══════════════════════════════════════════════════════════════
_pool = None

def get_pool():
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError(
                "DATABASE_URL environment variable is not set.\n"
                "Add it in your Railway/Render dashboard:\n"
                "  postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
            )
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=DATABASE_URL,
            cursor_factory=psycopg2.extras.RealDictCursor
        )
    return _pool

@contextmanager
def get_db():
    pool = get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

def q(conn, sql, params=()):
    """Execute and return all rows as list of dicts."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        try:
            return [dict(r) for r in cur.fetchall()]
        except Exception:
            return []

def q1(conn, sql, params=()):
    """Execute and return one row as dict, or None."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None

def qrun(conn, sql, params=()):
    """Execute with no return."""
    with conn.cursor() as cur:
        cur.execute(sql, params)

def qval(conn, sql, params=()):
    """Return single scalar value."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return list(row.values())[0] if row else None

def hash_pw(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

# ══════════════════════════════════════════════════════════════
#  DATABASE SETUP  — creates all tables if they don't exist
#  Safe to run on an existing Supabase DB — uses IF NOT EXISTS
# ══════════════════════════════════════════════════════════════
INIT_SQL = """
CREATE TABLE IF NOT EXISTS products (
    code    TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    price   NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bills (
    id              SERIAL PRIMARY KEY,
    customer_name   TEXT NOT NULL,
    customer_phone  TEXT NOT NULL,
    customer_email  TEXT,
    customer_addr   TEXT,
    worker_number   TEXT,
    worker_name     TEXT,
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    bill_date       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_items (
    id              SERIAL PRIMARY KEY,
    bill_id         INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    product_code    TEXT NOT NULL,
    product_name    TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    unit_price      NUMERIC(12,2) NOT NULL,
    subtotal        NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
    number      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    pieces      INTEGER NOT NULL DEFAULT 0,
    bills       INTEGER NOT NULL DEFAULT 0,
    incentive   NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supervisors (
    id          SERIAL PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supervisor_workers (
    supervisor_id   INTEGER REFERENCES supervisors(id) ON DELETE CASCADE,
    worker_number   TEXT    REFERENCES workers(number) ON DELETE CASCADE,
    PRIMARY KEY (supervisor_id, worker_number)
);

CREATE TABLE IF NOT EXISTS attendance (
    worker_number   TEXT NOT NULL REFERENCES workers(number) ON DELETE CASCADE,
    att_date        DATE NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('P','A','H','L')),
    PRIMARY KEY (worker_number, att_date)
);

CREATE TABLE IF NOT EXISTS incentive_adjustments (
    id              SERIAL PRIMARY KEY,
    worker_number   TEXT NOT NULL,
    adjustment      INTEGER NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

def init_db():
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(INIT_SQL)
        print("✅ Database tables ready (Supabase)")
    except Exception as e:
        print(f"⚠️  DB init warning: {e}")
        print("   Make sure DATABASE_URL is set correctly.")

# ══════════════════════════════════════════════════════════════
#  SERVE FRONTEND
# ══════════════════════════════════════════════════════════════
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

# ══════════════════════════════════════════════════════════════
#  DB STATUS
# ══════════════════════════════════════════════════════════════
@app.route('/api/db-status')
def db_status():
    try:
        with get_db() as conn:
            qrun(conn, 'SELECT 1')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})

# ══════════════════════════════════════════════════════════════
#  PRODUCTS / STOCK
# ══════════════════════════════════════════════════════════════
@app.route('/api/products', methods=['GET'])
def list_products():
    with get_db() as conn:
        rows = q(conn, 'SELECT * FROM products ORDER BY code')
    return jsonify(rows)

@app.route('/api/products', methods=['POST'])
def add_product():
    d     = request.json or {}
    code  = str(d.get('code','')).strip()
    name  = str(d.get('name','')).strip()
    price = float(d.get('price', 0))
    stock = int(d.get('stock', 0))
    if not code or len(code) != 3:
        return jsonify({'error': 'Code must be exactly 3 digits'}), 400
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    try:
        with get_db() as conn:
            qrun(conn,
                'INSERT INTO products(code,name,price,stock) VALUES(%s,%s,%s,%s)',
                (code, name, price, stock))
    except psycopg2.errors.UniqueViolation:
        return jsonify({'error': f'Product code {code} already exists'}), 409
    return jsonify({'message': f'Product {name} added'}), 201

@app.route('/api/products/<code>', methods=['PUT'])
def update_product(code):
    d = request.json or {}
    with get_db() as conn:
        qrun(conn,
            'UPDATE products SET name=%s, price=%s, stock=%s WHERE code=%s',
            (d.get('name'), d.get('price'), d.get('stock'), code))
    return jsonify({'message': 'Updated'})

@app.route('/api/products/<code>', methods=['DELETE'])
def delete_product(code):
    with get_db() as conn:
        qrun(conn, 'DELETE FROM products WHERE code=%s', (code,))
    return jsonify({'message': 'Deleted'})

# ══════════════════════════════════════════════════════════════
#  BILLS
# ══════════════════════════════════════════════════════════════
@app.route('/api/bills/next-id')
def next_bill_id():
    with get_db() as conn:
        val = qval(conn, 'SELECT COALESCE(MAX(id),0)+1 FROM bills')
    return jsonify({'next_id': val})

@app.route('/api/bills', methods=['POST'])
def create_bill():
    d      = request.json or {}
    cname  = str(d.get('customer_name','')).strip()
    cphone = str(d.get('customer_phone','')).strip()
    cemail = d.get('customer_email','')
    caddr  = d.get('customer_addr','')
    wnum   = d.get('worker_number','')
    wname  = d.get('worker_name','')
    items  = d.get('items', [])

    if not cname:  return jsonify({'error': 'Customer name required'}), 400
    if not cphone: return jsonify({'error': 'Phone required'}), 400
    if not items:  return jsonify({'error': 'No items'}), 400

    total    = 0
    enriched = []

    with get_db() as conn:
        for it in items:
            code = str(it.get('code','')).strip()
            qty  = int(it.get('quantity', 1))
            prod = q1(conn, 'SELECT * FROM products WHERE code=%s', (code,))
            if not prod:
                return jsonify({'error': f'Product {code} not found'}), 404
            if prod['stock'] < qty:
                return jsonify({'error': f'Not enough stock for {code}'}), 400
            sub    = float(prod['price']) * qty
            total += sub
            enriched.append({
                'code': code, 'name': prod['name'],
                'price': float(prod['price']), 'qty': qty, 'sub': sub
            })

        bill = q1(conn,
            """INSERT INTO bills
               (customer_name,customer_phone,customer_email,
                customer_addr,worker_number,worker_name,total_amount,bill_date)
               VALUES(%s,%s,%s,%s,%s,%s,%s,NOW())
               RETURNING id""",
            (cname,cphone,cemail,caddr,wnum,wname,total))
        bill_id = bill['id']

        for it in enriched:
            qrun(conn,
                """INSERT INTO bill_items
                   (bill_id,product_code,product_name,quantity,unit_price,subtotal)
                   VALUES(%s,%s,%s,%s,%s,%s)""",
                (bill_id,it['code'],it['name'],it['qty'],it['price'],it['sub']))
            qrun(conn,
                'UPDATE products SET stock=stock-%s WHERE code=%s',
                (it['qty'], it['code']))

        if wnum:
            total_pieces = sum(i['qty'] for i in enriched)
            inc = total_pieces * 2   # ₹2 per piece — change as needed
            qrun(conn,
                """INSERT INTO workers(number,name,pieces,bills,incentive)
                   VALUES(%s,%s,%s,1,%s)
                   ON CONFLICT(number) DO UPDATE SET
                     pieces=workers.pieces+EXCLUDED.pieces,
                     bills=workers.bills+1,
                     incentive=workers.incentive+EXCLUDED.incentive""",
                (wnum, wname, total_pieces, inc))

    return jsonify({'bill_id': bill_id, 'total': total}), 201

@app.route('/api/bills', methods=['GET'])
def list_bills():
    with get_db() as conn:
        rows = q(conn, 'SELECT * FROM bills ORDER BY id DESC LIMIT 100')
    # Make dates JSON-serialisable
    for r in rows:
        if 'bill_date' in r and r['bill_date']:
            r['bill_date'] = str(r['bill_date'])
    return jsonify(rows)

# ══════════════════════════════════════════════════════════════
#  CUSTOMER LOOKUP
# ══════════════════════════════════════════════════════════════
@app.route('/api/customers/lookup')
def customer_lookup():
    phone = request.args.get('phone','').strip()
    if not phone:
        return jsonify({'error': 'Phone required'}), 400
    with get_db() as conn:
        bill = q1(conn,
            'SELECT * FROM bills WHERE customer_phone=%s ORDER BY id DESC LIMIT 1',
            (phone,))
        if not bill:
            return jsonify({'error': 'No bills found for this phone number'}), 404
        items = q(conn, 'SELECT * FROM bill_items WHERE bill_id=%s', (bill['id'],))
        count = qval(conn,
            'SELECT COUNT(*) FROM bills WHERE customer_phone=%s', (phone,))
    bill['bill_date']    = str(bill.get('bill_date',''))
    bill['items']        = items
    bill['total_count']  = count
    bill['total_pieces'] = sum(i['quantity'] for i in items)
    return jsonify(bill)

# ══════════════════════════════════════════════════════════════
#  WORKERS & INCENTIVES
# ══════════════════════════════════════════════════════════════
@app.route('/api/workers', methods=['POST'])
def add_worker():
    d    = request.json or {}
    num  = str(d.get('number','')).strip()
    name = str(d.get('name','')).strip()
    if not num:  return jsonify({'error': 'Worker number required'}), 400
    if not name: return jsonify({'error': 'Worker name required'}), 400
    try:
        with get_db() as conn:
            qrun(conn, 'INSERT INTO workers(number,name) VALUES(%s,%s)', (num,name))
    except psycopg2.errors.UniqueViolation:
        return jsonify({'error': f'Worker {num} already exists'}), 409
    return jsonify({'message': f'Worker {name} added'}), 201

@app.route('/api/workers/<number>', methods=['GET'])
def get_worker(number):
    with get_db() as conn:
        row = q1(conn, 'SELECT * FROM workers WHERE number=%s', (number,))
    if not row: return jsonify({'error': 'Worker not found'}), 404
    return jsonify(row)

@app.route('/api/workers/<number>', methods=['DELETE'])
def delete_worker(number):
    with get_db() as conn:
        qrun(conn, 'DELETE FROM workers WHERE number=%s', (number,))
    return jsonify({'message': 'Worker deleted'})

@app.route('/api/incentives')
def list_incentives():
    with get_db() as conn:
        rows = q(conn, 'SELECT * FROM workers ORDER BY number')
    return jsonify(rows)

@app.route('/api/incentives/adjust', methods=['POST'])
def adjust_incentive():
    if not session.get('supervisor_id') and not session.get('is_manager'):
        return jsonify({'error': 'Login required'}), 401
    d    = request.json or {}
    wnum = str(d.get('worker_number','')).strip()
    adj  = int(d.get('adjustment', 0))
    note = d.get('note','')
    if not wnum: return jsonify({'error': 'Worker number required'}), 400
    if adj == 0: return jsonify({'error': 'Adjustment cannot be zero'}), 400
    with get_db() as conn:
        qrun(conn,
            'UPDATE workers SET incentive=incentive+%s, pieces=pieces+%s WHERE number=%s',
            (adj, adj, wnum))
        qrun(conn,
            'INSERT INTO incentive_adjustments(worker_number,adjustment,note,created_at)'
            ' VALUES(%s,%s,%s,NOW())',
            (wnum, adj, note))
    return jsonify({'message': f'Incentive adjusted by {adj} for worker {wnum}'})

@app.route('/api/incentives/clear', methods=['POST'])
def clear_incentives():
    if not session.get('is_manager'):
        return jsonify({'error': 'Manager access required'}), 403
    with get_db() as conn:
        qrun(conn, 'UPDATE workers SET pieces=0, bills=0, incentive=0')
        qrun(conn, 'DELETE FROM incentive_adjustments')
    return jsonify({'message': 'All incentives cleared'})

# ══════════════════════════════════════════════════════════════
#  SUPERVISOR AUTH
# ══════════════════════════════════════════════════════════════
@app.route('/api/supervisor/register', methods=['POST'])
def sup_register():
    d = request.json or {}
    u = str(d.get('username','')).strip()
    p = str(d.get('password','')).strip()
    if not u or not p: return jsonify({'error': 'Username and password required'}), 400
    try:
        with get_db() as conn:
            qrun(conn,
                'INSERT INTO supervisors(username,password) VALUES(%s,%s)',
                (u, hash_pw(p)))
    except psycopg2.errors.UniqueViolation:
        return jsonify({'error': 'Username already exists'}), 409
    return jsonify({'message': f'Supervisor "{u}" created'}), 201

@app.route('/api/supervisor/login', methods=['POST'])
def sup_login():
    d = request.json or {}
    u = str(d.get('username','')).strip()
    p = str(d.get('password','')).strip()
    with get_db() as conn:
        row = q1(conn,
            'SELECT * FROM supervisors WHERE username=%s AND password=%s',
            (u, hash_pw(p)))
    if not row: return jsonify({'error': 'Invalid credentials'}), 401
    session['supervisor_id']   = row['id']
    session['supervisor_name'] = row['username']
    session.pop('is_manager', None)
    return jsonify({'message': 'Logged in', 'username': row['username']})

@app.route('/api/supervisor/logout', methods=['POST'])
def sup_logout():
    session.pop('supervisor_id', None)
    session.pop('supervisor_name', None)
    return jsonify({'message': 'Logged out'})

@app.route('/api/supervisor/status')
def sup_status():
    if session.get('is_manager'):
        return jsonify({'logged_in':True,'is_supervisor':True,
                        'is_manager':True,'username':MGR_USER})
    if session.get('supervisor_id'):
        return jsonify({'logged_in':True,'is_supervisor':True,
                        'is_manager':False,'username':session.get('supervisor_name','')})
    return jsonify({'logged_in':False,'is_supervisor':False,
                    'is_manager':False,'username':''})

# ══════════════════════════════════════════════════════════════
#  MANAGER AUTH
# ══════════════════════════════════════════════════════════════
@app.route('/api/manager/login', methods=['POST'])
def mgr_login():
    d = request.json or {}
    u = str(d.get('username','')).strip()
    p = str(d.get('password','')).strip()
    if u != MGR_USER or p != MGR_PASS:
        return jsonify({'error': 'Invalid manager credentials'}), 401
    session['is_manager'] = True
    session.pop('supervisor_id', None)
    return jsonify({'message': 'Manager logged in'})

@app.route('/api/manager/logout', methods=['POST'])
def mgr_logout():
    session.pop('is_manager', None)
    return jsonify({'message': 'Logged out'})

@app.route('/api/manager/supervisors')
def mgr_supervisors():
    if not session.get('is_manager'):
        return jsonify({'error': 'Manager access required'}), 403
    with get_db() as conn:
        sups = q(conn, 'SELECT * FROM supervisors ORDER BY username')
        result = []
        for s in sups:
            workers = q(conn,
                'SELECT w.* FROM workers w'
                ' JOIN supervisor_workers sw ON sw.worker_number=w.number'
                ' WHERE sw.supervisor_id=%s ORDER BY w.number',
                (s['id'],))
            result.append({**s, 'workers': workers})
    return jsonify(result)

@app.route('/api/manager/unassigned-workers')
def unassigned_workers():
    if not session.get('is_manager'):
        return jsonify({'error': 'Manager access required'}), 403
    with get_db() as conn:
        rows = q(conn,
            'SELECT * FROM workers WHERE number NOT IN'
            ' (SELECT worker_number FROM supervisor_workers) ORDER BY number')
    return jsonify(rows)

@app.route('/api/manager/assign', methods=['POST'])
def assign_worker():
    if not session.get('is_manager'):
        return jsonify({'error': 'Manager access required'}), 403
    d   = request.json or {}
    sid = int(d.get('supervisor_id', 0))
    wn  = str(d.get('worker_number','')).strip()
    try:
        with get_db() as conn:
            qrun(conn,
                'INSERT INTO supervisor_workers(supervisor_id,worker_number) VALUES(%s,%s)',
                (sid, wn))
    except psycopg2.errors.UniqueViolation:
        return jsonify({'error': 'Worker already assigned'}), 409
    return jsonify({'message': f'Worker {wn} assigned'})

@app.route('/api/manager/unassign', methods=['POST'])
def unassign_worker():
    if not session.get('is_manager'):
        return jsonify({'error': 'Manager access required'}), 403
    wn = str((request.json or {}).get('worker_number','')).strip()
    with get_db() as conn:
        qrun(conn,
            'DELETE FROM supervisor_workers WHERE worker_number=%s', (wn,))
    return jsonify({'message': f'Worker {wn} unassigned'})

# ══════════════════════════════════════════════════════════════
#  ATTENDANCE
# ══════════════════════════════════════════════════════════════
@app.route('/api/attendance')
def get_attendance():
    if not session.get('supervisor_id') and not session.get('is_manager'):
        return jsonify({'error': 'Login required'}), 401
    att_date = request.args.get('date', date.today().isoformat())
    with get_db() as conn:
        if session.get('is_manager'):
            rows = q(conn,
                """SELECT w.number, w.name,
                     (SELECT s.username FROM supervisors s
                      JOIN supervisor_workers sw ON sw.supervisor_id=s.id
                      WHERE sw.worker_number=w.number LIMIT 1) AS supervisor,
                     a.status
                   FROM workers w
                   LEFT JOIN attendance a
                     ON a.worker_number=w.number AND a.att_date=%s
                   ORDER BY w.number""",
                (att_date,))
        else:
            sid = session['supervisor_id']
            rows = q(conn,
                """SELECT w.number, w.name, NULL AS supervisor, a.status
                   FROM workers w
                   JOIN supervisor_workers sw ON sw.worker_number=w.number
                   LEFT JOIN attendance a
                     ON a.worker_number=w.number AND a.att_date=%s
                   WHERE sw.supervisor_id=%s
                   ORDER BY w.number""",
                (att_date, sid))
    return jsonify({'rows': rows})

@app.route('/api/attendance/mark', methods=['POST'])
def mark_attendance():
    if not session.get('supervisor_id') and not session.get('is_manager'):
        return jsonify({'error': 'Login required'}), 401
    d      = request.json or {}
    wnum   = str(d.get('worker_number','')).strip()
    status = str(d.get('status','')).strip().upper()
    att_dt = str(d.get('date', date.today().isoformat()))
    if status not in ('P','A','H','L'):
        return jsonify({'error': 'Invalid status'}), 400
    with get_db() as conn:
        qrun(conn,
            """INSERT INTO attendance(worker_number,att_date,status) VALUES(%s,%s,%s)
               ON CONFLICT(worker_number,att_date)
               DO UPDATE SET status=EXCLUDED.status""",
            (wnum, att_dt, status))
    return jsonify({'message': f'Marked {wnum} as {status} on {att_dt}'})

@app.route('/api/attendance/daily')
def daily_report():
    att_date = request.args.get('date', date.today().isoformat())
    with get_db() as conn:
        rows = q(conn,
            """SELECT w.number, w.name, COALESCE(a.status,'U') AS status
               FROM workers w
               LEFT JOIN attendance a
                 ON a.worker_number=w.number AND a.att_date=%s
               ORDER BY w.number""",
            (att_date,))
    summary = {'P':0,'A':0,'H':0,'L':0,'U':0}
    for r in rows:
        summary[r['status']] = summary.get(r['status'],0) + 1
    return jsonify({'rows': rows, 'summary': summary})

@app.route('/api/attendance/monthly')
def monthly_report():
    if not session.get('supervisor_id') and not session.get('is_manager'):
        return jsonify({'error': 'Login required'}), 401
    year  = int(request.args.get('year',  date.today().year))
    month = int(request.args.get('month', date.today().month))
    with get_db() as conn:
        workers = q(conn, 'SELECT number, name FROM workers ORDER BY number')
        rows = []
        for w in workers:
            recs = q(conn,
                """SELECT status FROM attendance
                   WHERE worker_number=%s
                     AND EXTRACT(YEAR  FROM att_date)=%s
                     AND EXTRACT(MONTH FROM att_date)=%s""",
                (w['number'], year, month))
            P = sum(1 for r in recs if r['status']=='P')
            A = sum(1 for r in recs if r['status']=='A')
            H = sum(1 for r in recs if r['status']=='H')
            L = sum(1 for r in recs if r['status']=='L')
            rows.append({'number':w['number'],'name':w['name'],
                         'present':P,'absent':A,'half':H,'leave':L,
                         'total_present': P + H*0.5})
    return jsonify({'rows': rows})

@app.route('/api/attendance/download')
def download_attendance():
    if not session.get('supervisor_id') and not session.get('is_manager'):
        return jsonify({'error': 'Login required'}), 401
    if not OPENPYXL_OK:
        return jsonify({'error': 'openpyxl not installed'}), 500
    year  = int(request.args.get('year',  date.today().year))
    month = int(request.args.get('month', date.today().month))
    with get_db() as conn:
        workers = q(conn, 'SELECT number, name FROM workers ORDER BY number')
        data = []
        for w in workers:
            recs = q(conn,
                """SELECT status FROM attendance
                   WHERE worker_number=%s
                     AND EXTRACT(YEAR  FROM att_date)=%s
                     AND EXTRACT(MONTH FROM att_date)=%s""",
                (w['number'], year, month))
            P = sum(1 for r in recs if r['status']=='P')
            A = sum(1 for r in recs if r['status']=='A')
            H = sum(1 for r in recs if r['status']=='H')
            L = sum(1 for r in recs if r['status']=='L')
            data.append([w['number'],w['name'],P,A,H,L, P+H*0.5])
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{year}-{month:02d}"
    ws.append(['Worker #','Name','Present','Absent','Half-day','Leave','Total Present'])
    for row in data:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf); buf.seek(0)
    from flask import send_file
    return send_file(buf, as_attachment=True,
                     download_name=f'attendance_{year}_{month:02d}.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

# ══════════════════════════════════════════════════════════════
#  REPORTS
# ══════════════════════════════════════════════════════════════
@app.route('/api/reports')
def reports():
    with get_db() as conn:
        total_sales  = qval(conn, 'SELECT COALESCE(SUM(total_amount),0) FROM bills')
        total_bills  = qval(conn, 'SELECT COUNT(*) FROM bills')
        total_custs  = qval(conn, 'SELECT COUNT(DISTINCT customer_phone) FROM bills')
        total_inc    = qval(conn, 'SELECT COALESCE(SUM(incentive),0) FROM workers')
        recent_bills = q(conn, 'SELECT * FROM bills ORDER BY id DESC LIMIT 20')
        top_prods    = q(conn,
            """SELECT product_name,
                      SUM(quantity) AS units,
                      SUM(subtotal) AS revenue
               FROM bill_items
               GROUP BY product_name
               ORDER BY units DESC LIMIT 10""")
    for r in recent_bills:
        if r.get('bill_date'): r['bill_date'] = str(r['bill_date'])
    return jsonify({
        'total_sales':      float(total_sales or 0),
        'total_bills':      total_bills,
        'total_customers':  total_custs,
        'total_incentives': float(total_inc or 0),
        'recent_bills':     recent_bills,
        'top_products':     top_prods,
    })

# ══════════════════════════════════════════════════════════════
#  BOOT
# ══════════════════════════════════════════════════════════════
if __name__ == '__main__':
    init_db()
    print("=" * 56)
    print("  BillPro  —  Supabase Edition")
    print(f"  Open  →  http://localhost:{PORT}")
    print(f"  Manager login: {MGR_USER} / {MGR_PASS}")
    print("=" * 56)
    app.run(debug=False, host='0.0.0.0', port=PORT)
