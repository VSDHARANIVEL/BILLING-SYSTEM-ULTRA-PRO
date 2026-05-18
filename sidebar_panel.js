/* =============================================================
   sidebar_panel.js  —  BillPro New Features
   1.  Sidebar collapse / expand toggle
   2.  Last Bill slide-in panel (opens from sidebar button above clock)
   Load order: billing_app.js  →  sidebar_panel.js
   ============================================================= */
'use strict';

/* ─────────────────────────────────────────────
   1.  SIDEBAR COLLAPSE
   ───────────────────────────────────────────── */
var _sbCollapsed = false;

function toggleSidebar() {
  _sbCollapsed = !_sbCollapsed;
  var sidebar = document.getElementById('sidebar');
  var icon    = document.getElementById('toggleIcon');
  if (_sbCollapsed) {
    sidebar.classList.add('collapsed');
    icon.textContent = '▶';
  } else {
    sidebar.classList.remove('collapsed');
    icon.textContent = '◀';
  }
}

/* ─────────────────────────────────────────────
   2.  LAST BILL SLIDE-IN PANEL
   ───────────────────────────────────────────── */
var _lbpOpen = false;

function openLastBillPanel() {
  document.getElementById('lastBillPanel').classList.add('open');
  document.getElementById('lbpOverlay').classList.add('open');
  _lbpOpen = true;
  loadLastBillPanel();
}

function closeLastBillPanel() {
  document.getElementById('lastBillPanel').classList.remove('open');
  document.getElementById('lbpOverlay').classList.remove('open');
  _lbpOpen = false;
}

function loadLastBillPanel() {
  var body = document.getElementById('lbpBody');
  body.innerHTML = '<div class="lbp-empty">⏳ Loading…</div>';

  fetch('/api/bills', { credentials: 'include' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (bills) {
      if (!bills || !bills.length) {
        body.innerHTML = '<div class="lbp-empty">No bills created yet.<br>Generate your first bill!</div>';
        return;
      }
      var b = bills[0]; /* most recent — backend returns DESC */
      body.innerHTML =
        '<div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Most Recent Bill</div>' +

        '<div class="lbp-row"><span class="lbp-label">Bill #</span>' +
        '<span class="lbp-value">#' + String(b.id).padStart(3,'0') + '</span></div>' +

        '<div class="lbp-row"><span class="lbp-label">Date</span>' +
        '<span class="lbp-value">' + fmtDate(b.bill_date) + '</span></div>' +

        '<div class="lbp-row"><span class="lbp-label">Customer</span>' +
        '<span class="lbp-value">' + escHtml(b.customer_name) + '</span></div>' +

        '<div class="lbp-row"><span class="lbp-label">Phone</span>' +
        '<span class="lbp-value">' + escHtml(b.customer_phone) + '</span></div>' +

        (b.customer_addr
          ? '<div class="lbp-row"><span class="lbp-label">Address</span>' +
            '<span class="lbp-value">' + escHtml(b.customer_addr) + '</span></div>'
          : '') +

        (b.customer_email
          ? '<div class="lbp-row"><span class="lbp-label">Email</span>' +
            '<span class="lbp-value">' + escHtml(b.customer_email) + '</span></div>'
          : '') +

        '<div class="lbp-row"><span class="lbp-label">Worker</span>' +
        '<span class="lbp-value">' +
          (b.worker_number ? escHtml(b.worker_number) + ' — ' + escHtml(b.worker_name || '') : 'N/A') +
        '</span></div>' +

        '<div class="lbp-total"><span>TOTAL</span><span>' + money(b.total_amount) + '</span></div>' +

        '<p style="margin-top:14px;font-size:11px;color:#bbb;text-align:center;">' +
          'Use 🔍 Customer Lookup for full item details' +
        '</p>';
    })
    .catch(function () {
      body.innerHTML =
        '<div class="lbp-empty" style="color:#e53e3e;">⚠ Could not load.<br>' +
        'Make sure <strong>app.py</strong> is running and you opened<br>' +
        '<strong>http://localhost:5000</strong></div>';
    });
}

/* ─────────────────────────────────────────────
   3.  KEYBOARD SHORTCUTS
       Escape → close panel
       Alt+B  → toggle panel
   ───────────────────────────────────────────── */
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && _lbpOpen) {
    closeLastBillPanel();
  }
  if (e.altKey && e.key === 'b') {
    if (_lbpOpen) closeLastBillPanel();
    else openLastBillPanel();
  }
});
