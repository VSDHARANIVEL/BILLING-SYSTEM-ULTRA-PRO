/* =========================================================
   BillPro — Frontend JavaScript
   ========================================================= */
'use strict';

/* ─ CLOCK ─ */
function updateClock() {
  var now = new Date();
  var d = document.getElementById('clDate');
  var t = document.getElementById('clTime');
  if (d) d.textContent = now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  if (t) t.textContent = now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
}
setInterval(updateClock,1000); updateClock();

/* ─ PAGE TITLES ─ */
var PAGE_TITLES = {
  'bill':       'Create New Bill',
  'stock':      'Stock Manager',
  'customer':   'Customer Lookup',
  'incentives': 'Worker Incentives',
  'reports':    'Reports & Analytics',
  'account':    'Login / Account'
};

/* ─ AUTH STATE ─ */
var AUTH = { logged_in:false, is_supervisor:false, is_manager:false, username:'' };

/* ─ NAV ─ */
function navTo(page) {
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.ni').forEach(function(n){ n.classList.remove('active'); });
  var pg = document.getElementById('page-'+page);
  if (pg) pg.classList.add('active');
  var ni = document.querySelector('[data-page="'+page+'"]');
  if (ni) ni.classList.add('active');
  var tt = document.getElementById('topTitle');
  if (tt) tt.textContent = PAGE_TITLES[page] || '';

  if (page === 'stock')       loadStock();
  if (page === 'incentives')  { checkSupStatus(); loadIncentives(); }
  if (page === 'reports')     { showReportTab('sales'); loadReports(); }
  if (page === 'bill')        loadNextBillId();
  if (page === 'account')     refreshAccountPage();
}

/* ─ API — handles non-JSON (HTML) responses gracefully ─ */
function api(method, path, body) {
  var opts = { method:method, headers:{'Content-Type':'application/json'}, credentials:'include' };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
  return fetch(path, opts).then(function(res) {
    var ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(
        'Server returned a non-JSON response (HTTP ' + res.status + '). ' +
        'Is the Flask backend running on http://localhost:5000?'
      );
    }
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Server error ('+res.status+')');
      return data;
    });
  });
}

/* ─ TOAST / HELPERS ─ */
function toast(msg, type) {
  type = type || 'info';
  var icons = {ok:'✅', err:'❌', info:'ℹ️'};
  var el = document.createElement('div');
  el.className = 'toast t-' + type;
  el.innerHTML = '<span>'+(icons[type]||'ℹ️')+'</span><span>'+escHtml(msg)+'</span>';
  var c = document.getElementById('toast-container');
  if (c) c.appendChild(el);
  setTimeout(function(){ try{el.remove();}catch(e){} }, 3500);
}
function ek(e, nextId) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (typeof nextId === 'function') { nextId(); return; }
  var el = document.getElementById(nextId);
  if (el) el.focus();
}
function setMsg(id,msg,type){ var el=document.getElementById(id); if(!el)return; el.textContent=msg; el.className='msg-box'+(msg?' msg-'+type:''); }
function setLookup(msg,type){ var el=document.getElementById('lstatus'); if(!el)return; el.textContent=msg; el.className='lookup-status'+(msg?' ls-'+type:''); }
function money(n){ return '₹'+parseFloat(n||0).toFixed(2); }
function escHtml(s){ var d=document.createElement('div'); d.textContent=String(s==null?'':s); return d.innerHTML; }
function fmtDate(s){ if(!s)return '—'; try{ return new Date(s).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){return s;} }
function getVal(id){ var el=document.getElementById(id); return el?el.value.trim():''; }
function setVal(id,v){ var el=document.getElementById(id); if(el) el.value=v; }
function clearVals(ids){ ids.forEach(function(id){ setVal(id,''); }); }
function todayISO(){ var d=new Date(); var z=function(n){return n<10?'0'+n:n;}; return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }

/* ─ AUTH STATUS ─ */
function refreshAuth() {
  return api('GET','/api/supervisor/status').then(function(r){
    AUTH = r;
    var tr = document.getElementById('topRight');
    if (tr) {
      if (r.logged_in) {
        tr.textContent = (r.is_manager ? '🛡 Manager: ' : '👨‍💼 Supervisor: ') + r.username;
      } else {
        tr.textContent = 'Not signed in';
      }
    }
  }).catch(function(){});
}

/* =========================================================
   BILL
========================================================= */
var billItems = []; var productCache = {};

function loadNextBillId() {
  api('GET','/api/bills/next-id').then(function(r){
    setVal('billNo', String(r.next_id).padStart(3,'0'));
  }).catch(function(){ setVal('billNo','???'); });
  api('GET','/api/products').then(function(prods){
    productCache={}; prods.forEach(function(p){ productCache[p.code]=p; });
  }).catch(function(){});
}

function addrEnterNext(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  var el = document.getElementById('bCode');
  if (el) { el.focus(); toast('Enter Stock Code to add items','info'); }
}

function lookupProduct() {
  var code = getVal('bCode');
  setVal('bPN',''); setVal('bPr',''); setLookup('','');
  var badge = document.getElementById('lookupBadge');
  if (badge) badge.style.display = 'none';
  if (code.length < 3) return;
  var p = productCache[code];
  if (p) {
    setVal('bPN',p.name); setVal('bPr',p.price);
    if (badge){ badge.textContent=p.name; badge.style.display='block'; }
    setLookup('✔ '+p.name+' — Stock: '+p.stock,'ok');
    var q = document.getElementById('bQty'); if (q) q.focus();
  } else {
    setLookup('✘ Code "'+code+'" not found. Add it in Stock Manager.','err');
  }
}

function qtyEnterAdd(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  addItem();
}

function addItem() {
  var code  = getVal('bCode'), name = getVal('bPN');
  var price = parseFloat(getVal('bPr'));
  var qty   = parseInt(document.getElementById('bQty').value) || 1;
  if (!code||!name||isNaN(price)){
    toast('Enter a valid 3-digit product code first','err');
    document.getElementById('bCode').focus(); return;
  }
  if (qty < 1){ toast('Quantity must be at least 1','err'); return; }
  var p = productCache[code];
  if (p) {
    var already = billItems.filter(function(i){return i.code===code;})
                           .reduce(function(s,i){return s+i.quantity;},0);
    if (p.stock < qty+already){ toast('Not enough stock! Available: '+(p.stock-already),'err'); return; }
  }
  var idx = billItems.findIndex(function(i){return i.code===code;});
  if (idx >= 0){ billItems[idx].quantity+=qty; billItems[idx].subtotal=billItems[idx].price*billItems[idx].quantity; }
  else { billItems.push({code:code,name:name,price:price,quantity:qty,subtotal:price*qty}); }
  renderBillItems();
  clearVals(['bCode','bPN','bPr']); setVal('bQty',1); setLookup('','');
  var badge = document.getElementById('lookupBadge');
  if (badge) badge.style.display = 'none';
  document.getElementById('bCode').focus();
  toast(name+' × '+qty+' added','ok');
}

function removeItem(idx){ billItems.splice(idx,1); renderBillItems(); }

function renderBillItems() {
  var tb = document.getElementById('billTbody'); if (!tb) return;
  if (!billItems.length){
    tb.innerHTML='<tr><td colspan="7" class="empty-td">No items added</td></tr>';
    document.getElementById('bSubtotal').textContent='₹0.00';
    document.getElementById('bTotal').textContent='₹0.00';
    return;
  }
  var total=0, html='';
  billItems.forEach(function(it,i){
    total+=it.subtotal;
    html+='<tr>'
      +'<td>'+(i+1)+'</td>'
      +'<td><strong>'+escHtml(it.name)+'</strong><br><span class="code-pill">'+escHtml(it.code)+'</span></td>'
      +'<td>'+it.quantity+'</td>'
      +'<td>'+money(it.price)+'</td>'
      +'<td>—</td>'
      +'<td><strong>'+money(it.subtotal)+'</strong></td>'
      +'<td><button class="del-btn" onclick="removeItem('+i+')">Remove</button></td>'
      +'</tr>';
  });
  tb.innerHTML=html;
  document.getElementById('bSubtotal').textContent=money(total);
  document.getElementById('bTotal').textContent=money(total);
}

function submitBill() {
  var cname=getVal('bCN'), cphone=getVal('bCP'), cemail=getVal('bEmail'), caddr=getVal('bAddr');
  var wnum=getVal('bWorker'), wname=getVal('bWorkerName');
  if (!cname){ toast('Customer name is required','err'); document.getElementById('bCN').focus(); return; }
  if (!cphone||cphone.length!==10||!/^\d+$/.test(cphone)){ toast('Phone must be 10 digits','err'); document.getElementById('bCP').focus(); return; }
  if (!billItems.length){ toast('Add at least one item','err'); return; }
  var items = billItems.map(function(i){return {code:i.code,quantity:i.quantity};});
  api('POST','/api/bills',{
    customer_name:cname,customer_phone:cphone,customer_email:cemail,customer_addr:caddr,
    worker_number:wnum,worker_name:wname,items:items
  }).then(function(r){
    showReceipt(r.bill_id,cname,cphone,wnum,wname,billItems,r.total);
    billItems=[]; renderBillItems();
    clearVals(['bCN','bCP','bEmail','bAddr','bWorker','bWorkerName']);
    var badge=document.getElementById('workerBadge'); if(badge) badge.style.display='none';
    loadNextBillId(); toast('Bill #'+r.bill_id+' created! Total: '+money(r.total),'ok');
  }).catch(function(e){ toast(e.message,'err'); });
}

function clearBill() {
  if (!billItems.length) return;
  if (!confirm('Clear all items from this bill?')) return;
  billItems=[]; renderBillItems();
  clearVals(['bCN','bCP','bEmail','bAddr','bWorker','bWorkerName']);
  var badge=document.getElementById('workerBadge'); if(badge) badge.style.display='none';
  toast('Bill cleared','info');
}

function previewWorker() {
  var num=getVal('bWorker');
  var badge=document.getElementById('workerBadge'), nameEl=document.getElementById('bWorkerName');
  if (badge) badge.style.display='none'; if(nameEl) nameEl.value='';
  if (!num) return;
  api('GET','/api/workers/'+encodeURIComponent(num)).then(function(w){
    if(badge){badge.textContent=w.name;badge.style.display='block';}
    if(nameEl) nameEl.value=w.name;
  }).catch(function(){ if(badge) badge.style.display='none'; if(nameEl) nameEl.value=''; });
}

function showReceipt(id,cust,phone,wnum,wname,items,total) {
  function s(elId,v){var el=document.getElementById(elId);if(el)el.textContent=v;}
  s('rDate',new Date().toLocaleString('en-IN'));
  s('rNo',String(id).padStart(3,'0'));
  s('rCust',cust); s('rPhone',phone);
  s('rWorker',wnum?wnum+' — '+wname:'N/A');
  var c=document.getElementById('rItemsContainer');
  if(c) c.innerHTML=items.map(function(it){
    return '<div class="r-item-row"><span>'+escHtml(it.name)+' × '+it.quantity+'</span><span>'+money(it.subtotal)+'</span></div>';
  }).join('');
  s('rTotal',money(total));
  var ov=document.getElementById('receiptOverlay'); if(ov) ov.classList.remove('hidden');
}
function closeReceipt(){ var ov=document.getElementById('receiptOverlay'); if(ov) ov.classList.add('hidden'); }
function handleOverlayClick(e){ if(e.target.id==='receiptOverlay') closeReceipt(); }

/* =========================================================
   STOCK
========================================================= */
function addProduct() {
  var code=getVal('pCode'), name=getVal('pName'), price=getVal('pPrice'), stock=getVal('pStock');
  if (!code||code.length!==3||!/^\d{3}$/.test(code)){ setMsg('pMsg','✘ Code must be exactly 3 digits','err'); return; }
  if (!name){ setMsg('pMsg','✘ Product name required','err'); return; }
  if (price===''||isNaN(parseFloat(price))||parseFloat(price)<0){ setMsg('pMsg','✘ Enter a valid price','err'); return; }
  if (stock===''||isNaN(parseInt(stock))||parseInt(stock)<0){ setMsg('pMsg','✘ Enter a valid stock','err'); return; }
  api('POST','/api/products',{code:code,name:name,price:parseFloat(price),stock:parseInt(stock)})
    .then(function(){
      setMsg('pMsg','✔ Product "'+name+'" added!','ok');
      clearVals(['pCode','pName','pPrice','pStock']);
      document.getElementById('pCode').focus(); loadStock(); toast('"'+name+'" added','ok');
    }).catch(function(e){ setMsg('pMsg','✘ '+e.message,'err'); });
}
function deleteProduct(code) {
  if (!confirm('Delete product "'+code+'"?')) return;
  api('DELETE','/api/products/'+encodeURIComponent(code))
    .then(function(){ loadStock(); toast('Product deleted','info'); })
    .catch(function(e){ toast(e.message,'err'); });
}
function loadStock() {
  var tb=document.getElementById('stockTbody'); if(!tb) return;
  tb.innerHTML='<tr><td colspan="6" class="empty-td">Loading...</td></tr>';
  api('GET','/api/products').then(function(prods){
    productCache={}; prods.forEach(function(p){ productCache[p.code]=p; });
    if (!prods.length){ tb.innerHTML='<tr><td colspan="6" class="empty-td">No products yet</td></tr>'; return; }
    tb.innerHTML=prods.map(function(p){
      return '<tr>'
        +'<td><span class="code-pill">'+escHtml(p.code)+'</span></td>'
        +'<td><strong>'+escHtml(p.name)+'</strong></td>'
        +'<td>'+money(p.price)+'</td>'
        +'<td><strong>'+p.stock+'</strong></td>'
        +'<td>'+money(p.price*p.stock)+'</td>'
        +'<td><button class="del-btn" onclick="deleteProduct(\''+p.code+'\')">Delete</button></td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ tb.innerHTML='<tr><td colspan="6" class="empty-td">✘ '+escHtml(e.message)+'</td></tr>'; });
}

/* =========================================================
   CUSTOMER LOOKUP
========================================================= */
function lookupCustomer() {
  var phone=getVal('cPhone');
  var resBox=document.getElementById('custResultBox'); if(!resBox) return;
  resBox.innerHTML=''; resBox.classList.add('hidden');
  if (!phone||phone.length!==10){ toast('Enter a valid 10-digit phone','err'); return; }
  api('GET','/api/customers/lookup?phone='+encodeURIComponent(phone))
    .then(function(bill){
      var itemsHtml=(bill.items||[]).map(function(it){
        return escHtml(it.product_code)+' | '+escHtml(it.product_name)+' × '+it.quantity+' = '+money(it.subtotal);
      }).join('<br>');
      var note=bill.total_count>1?'<p style="margin-top:8px;">📌 This customer has '+bill.total_count+' bill(s).</p>':'';
      resBox.innerHTML=
        '<div class="cust-result">'
        +'<div class="cust-result-title">📋 Last Bill — #'+String(bill.id).padStart(3,'0')+'</div>'
        +'<div class="cr-grid">'
        +'<div><div class="cr-label">Customer</div><div class="cr-value">'+escHtml(bill.customer_name)+'</div></div>'
        +'<div><div class="cr-label">Phone</div><div class="cr-value">'+escHtml(bill.customer_phone)+'</div></div>'
        +'<div><div class="cr-label">Date</div><div class="cr-value">'+fmtDate(bill.bill_date)+'</div></div>'
        +'<div><div class="cr-label">Amount</div><div class="cr-value">'+money(bill.total_amount)+'</div></div>'
        +'<div><div class="cr-label">Pieces</div><div class="cr-value">'+bill.total_pieces+'</div></div>'
        +'<div><div class="cr-label">Worker</div><div class="cr-value">'+(bill.worker_number?escHtml(bill.worker_number)+' — '+escHtml(bill.worker_name):'N/A')+'</div></div>'
        +'</div>'
        +'<div class="cr-items-box"><strong>Items:</strong><br>'+itemsHtml+'</div>'
        +note+'</div>';
      resBox.classList.remove('hidden');
    }).catch(function(e){
      resBox.innerHTML='<p class="msg-err">✘ '+escHtml(e.message)+'</p>';
      resBox.classList.remove('hidden');
    });
}

/* =========================================================
   WORKERS & INCENTIVES
========================================================= */
function addWorker() {
  var num=getVal('wNum'), name=getVal('wName');
  if (!num){ setMsg('wMsg','✘ Worker number required','err'); return; }
  if (!name){ setMsg('wMsg','✘ Worker name required','err'); return; }
  api('POST','/api/workers',{number:num,name:name}).then(function(){
    setMsg('wMsg','✔ Worker "'+name+'" ('+num+') added!','ok');
    clearVals(['wNum','wName']); document.getElementById('wNum').focus();
    loadIncentives(); toast('Worker "'+name+'" added','ok');
  }).catch(function(e){ setMsg('wMsg','✘ '+e.message,'err'); });
}
function deleteWorker(num) {
  if (!confirm('Delete worker #'+num+'?')) return;
  api('DELETE','/api/workers/'+encodeURIComponent(num))
    .then(function(){ loadIncentives(); toast('Worker deleted','info'); })
    .catch(function(e){ toast(e.message,'err'); });
}
function loadIncentives() {
  var tb=document.getElementById('incTbody'); if(!tb) return;
  tb.innerHTML='<tr><td colspan="6" class="empty-td">Loading...</td></tr>';
  api('GET','/api/incentives').then(function(data){
    if (!data.length){ tb.innerHTML='<tr><td colspan="6" class="empty-td">No workers added yet</td></tr>'; return; }
    tb.innerHTML=data.map(function(w){
      return '<tr>'
        +'<td><span class="code-pill">'+escHtml(w.number)+'</span></td>'
        +'<td><strong>'+escHtml(w.name)+'</strong></td>'
        +'<td>'+w.pieces+'</td>'
        +'<td>'+w.bills+'</td>'
        +'<td><strong>₹'+w.incentive+'</strong></td>'
        +'<td><button class="del-btn" onclick="deleteWorker(\''+w.number+'\')">Delete</button></td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ tb.innerHTML='<tr><td colspan="6" class="empty-td">✘ '+escHtml(e.message)+'</td></tr>'; });
}

/* =========================================================
   SUPERVISOR (incentives card)
========================================================= */
function checkSupStatus() {
  api('GET','/api/supervisor/status').then(function(r){
    AUTH=r;
    if (r.logged_in) showSupPanel(r.username); else showSupForm();
  }).catch(function(){ showSupForm(); });
}
function showSupPanel(who){
  var lb=document.getElementById('supLoginBlock'), ab=document.getElementById('supActiveBlock'), w=document.getElementById('supWho');
  if(lb) lb.classList.add('hidden'); if(ab) ab.classList.remove('hidden'); if(w) w.textContent=who;
}
function showSupForm(){
  var lb=document.getElementById('supLoginBlock'), ab=document.getElementById('supActiveBlock');
  if(lb) lb.classList.remove('hidden'); if(ab) ab.classList.add('hidden');
}
function supervisorLogin() {
  var u=getVal('supU'), p=getVal('supP');
  if (!u||!p){ setMsg('supMsg','✘ Enter both username and password','err'); return; }
  api('POST','/api/supervisor/login',{username:u,password:p}).then(function(r){
    showSupPanel(r.username); setMsg('supMsg','',''); clearVals(['supU','supP']);
    refreshAuth(); toast('Supervisor logged in as '+r.username,'ok');
  }).catch(function(e){ setMsg('supMsg','✘ '+e.message,'err'); toast(e.message,'err'); });
}
function supervisorLogout() {
  api('POST','/api/supervisor/logout').then(function(){
    showSupForm(); clearVals(['supU','supP']); refreshAuth(); toast('Logged out','info');
  }).catch(function(){ showSupForm(); });
}
function clearIncentives() {
  if (!confirm('⚠ MONTH-END CLEAR\n\nThis removes all incentive data.\n\nProceed?')) return;
  api('POST','/api/incentives/clear').then(function(r){ toast(r.message,'ok'); loadIncentives(); })
    .catch(function(e){ toast(e.message,'err'); });
}
function supervisorEditIncentive() {
  var wnum=getVal('supEW'), adj=parseInt(getVal('supEA')), note=getVal('supEN');
  if (!wnum){ setMsg('supEditMsg','✘ Enter worker number','err'); return; }
  if (isNaN(adj)||adj===0){ setMsg('supEditMsg','✘ Enter a non-zero number','err'); return; }
  api('POST','/api/incentives/adjust',{worker_number:wnum,adjustment:adj,note:note}).then(function(r){
    setMsg('supEditMsg','✔ '+r.message,'ok');
    clearVals(['supEW','supEA','supEN']); loadIncentives(); toast(r.message,'ok');
  }).catch(function(e){ setMsg('supEditMsg','✘ '+e.message,'err'); });
}

/* =========================================================
   ATTENDANCE  — now lives inside Account page
   Supervisor → sees own workers only
   Manager    → sees ALL workers + supervisor column
========================================================= */
function loadAttendance() {
  var d = getVal('attDate') || todayISO();
  var tb = document.getElementById('attTbody');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="5" class="empty-td">Loading...</td></tr>';
  api('GET','/api/attendance?date='+encodeURIComponent(d)).then(function(r){
    if (!r.rows.length){
      tb.innerHTML = '<tr><td colspan="5" class="empty-td">'
        + (AUTH.is_manager ? 'No workers yet.' : 'No workers assigned to you. Ask the Manager.')
        + '</td></tr>';
      return;
    }
    var html = r.rows.map(function(row){
      function mk(s,label){
        var on = row.status===s ? ' on' : '';
        return '<button class="att-btn '+s.toLowerCase()+on+'" onclick="markAtt(\''+row.number+'\',\''+s+'\')">'+label+'</button>';
      }
      var supCell = AUTH.is_manager ? '<td>'+escHtml(row.supervisor||'—')+'</td>' : '';
      var curr = row.status
        ? '<span class="status-pill '+row.status.toLowerCase()+'">'+row.status+'</span>'
        : '<span class="status-pill u">—</span>';
      return '<tr>'
        +'<td><span class="code-pill">'+escHtml(row.number)+'</span></td>'
        +'<td><strong>'+escHtml(row.name)+'</strong></td>'
        +supCell
        +'<td>'+curr+'</td>'
        +'<td>'+mk('P','Present')+mk('A','Absent')+mk('H','Half')+mk('L','Leave')+'</td>'
        +'</tr>';
    }).join('');
    tb.innerHTML = html;
  }).catch(function(e){
    tb.innerHTML = '<tr><td colspan="5" class="empty-td">✘ '+escHtml(e.message)+'</td></tr>';
  });
}

function markAtt(num, status) {
  var d = getVal('attDate') || todayISO();
  api('POST','/api/attendance/mark',{worker_number:num,date:d,status:status})
    .then(function(r){ toast(r.message,'ok'); loadAttendance(); })
    .catch(function(e){ toast(e.message,'err'); });
}

/* =========================================================
   REPORTS — Tabs: Sales | Daily (no login) | Monthly (login)
========================================================= */
function showReportTab(tab) {
  document.querySelectorAll('.rtab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.report-subpage').forEach(function(p){ p.classList.remove('active'); });
  var btn = document.getElementById('rtab-'+tab);
  var pg  = document.getElementById('rpage-'+tab);
  if (btn) btn.classList.add('active');
  if (pg)  pg.classList.add('active');

  if (tab === 'sales')   loadReports();
  if (tab === 'daily')   initDailyReport();
  if (tab === 'monthly') initMonthlyReport();
}

/* SALES */
function loadReports() {
  ['rSales','rBills','rCusts','rInc'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.textContent='...';
  });
  api('GET','/api/reports').then(function(d){
    function s(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
    s('rSales',money(d.total_sales)); s('rBills',d.total_bills);
    s('rCusts',d.total_customers);   s('rInc',money(d.total_incentives));
    var rBT=document.getElementById('repBillsTb');
    if (rBT){
      rBT.innerHTML=(!d.recent_bills||!d.recent_bills.length)
        ? '<tr><td colspan="6" class="empty-td">No bills yet</td></tr>'
        : d.recent_bills.map(function(b){
            return '<tr>'
              +'<td><strong>#'+String(b.id).padStart(3,'0')+'</strong></td>'
              +'<td>'+fmtDate(b.bill_date)+'</td>'
              +'<td>'+escHtml(b.customer_name)+'</td>'
              +'<td>'+escHtml(b.customer_phone)+'</td>'
              +'<td><strong>'+money(b.total_amount)+'</strong></td>'
              +'<td>'+escHtml(b.worker_number||'—')+'</td>'
              +'</tr>';
          }).join('');
    }
    var rPT=document.getElementById('repProdTb');
    if (rPT){
      rPT.innerHTML=(!d.top_products||!d.top_products.length)
        ? '<tr><td colspan="3" class="empty-td">No sales data yet</td></tr>'
        : d.top_products.map(function(p){
            return '<tr>'
              +'<td><strong>'+escHtml(p.product_name)+'</strong></td>'
              +'<td>'+p.units+'</td>'
              +'<td><strong>'+money(p.revenue)+'</strong></td>'
              +'</tr>';
          }).join('');
    }
  }).catch(function(e){
    ['rSales','rBills','rCusts','rInc'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.textContent='ERR';
    });
    toast('Reports error: '+e.message,'err');
  });
}

/* DAILY — no login needed, just load */
function initDailyReport() {
  if (!getVal('dlyDate')) setVal('dlyDate', todayISO());
  loadDaily();
}
function loadDaily() {
  var d = getVal('dlyDate') || todayISO();
  api('GET','/api/attendance/daily?date='+encodeURIComponent(d)).then(function(r){
    document.getElementById('dlyP').textContent = r.summary.P;
    document.getElementById('dlyA').textContent = r.summary.A;
    document.getElementById('dlyH').textContent = r.summary.H;
    document.getElementById('dlyL').textContent = r.summary.L;
    var tb = document.getElementById('dlyTbody');
    if (!r.rows.length){ tb.innerHTML='<tr><td colspan="3" class="empty-td">No data for this date</td></tr>'; return; }
    tb.innerHTML = r.rows.map(function(row){
      var label={P:'Present',A:'Absent',H:'Half-day',L:'Leave',U:'Not marked'}[row.status]||row.status;
      return '<tr>'
        +'<td><span class="code-pill">'+escHtml(row.number)+'</span></td>'
        +'<td><strong>'+escHtml(row.name)+'</strong></td>'
        +'<td><span class="status-pill '+row.status.toLowerCase()+'">'+label+'</span></td>'
        +'</tr>';
    }).join('');
  }).catch(function(e){ toast(e.message,'err'); });
}

/* MONTHLY — login required */
function initMonthlyReport() {
  var gate = document.getElementById('monLoginGate');
  var body = document.getElementById('monBody');
  refreshAuth().then(function(){
    if (!AUTH.logged_in) {
      if (gate) gate.classList.remove('hidden');
      if (body) body.classList.add('hidden');
    } else {
      if (gate) gate.classList.add('hidden');
      if (body) body.classList.remove('hidden');
      if (!getVal('monYear')){
        var n=new Date();
        setVal('monYear', n.getFullYear());
        document.getElementById('monMonth').value = n.getMonth()+1;
      }
      loadMonthly();
    }
  });
}
function loadMonthly() {
  var y=getVal('monYear'), m=document.getElementById('monMonth').value;
  api('GET','/api/attendance/monthly?year='+encodeURIComponent(y)+'&month='+encodeURIComponent(m))
    .then(function(r){
      var tb=document.getElementById('monTbody');
      if (!r.rows.length){ tb.innerHTML='<tr><td colspan="7" class="empty-td">No data for this month</td></tr>'; return; }
      tb.innerHTML=r.rows.map(function(row){
        return '<tr>'
          +'<td><span class="code-pill">'+escHtml(row.number)+'</span></td>'
          +'<td><strong>'+escHtml(row.name)+'</strong></td>'
          +'<td>'+row.present+'</td>'
          +'<td>'+row.half+'</td>'
          +'<td>'+row.leave+'</td>'
          +'<td>'+row.absent+'</td>'
          +'<td><strong style="color:var(--primary)">'+row.total_present+'</strong></td>'
          +'</tr>';
      }).join('');
    }).catch(function(e){ toast(e.message,'err'); });
}
function downloadExcel() {
  var y=getVal('monYear'), m=document.getElementById('monMonth').value;
  if (!y||!m){ toast('Pick year and month','err'); return; }
  window.location='/api/attendance/download?year='+encodeURIComponent(y)+'&month='+encodeURIComponent(m);
}

/* =========================================================
   ACCOUNT PAGE
   • Supervisor login → shows Attendance panel (own workers)
   • Manager login   → shows Attendance (ALL) + Assign panel
========================================================= */
function refreshAccountPage() {
  refreshAuth().then(function(){
    var signed  = document.getElementById('accSignedIn');
    var forms   = document.getElementById('accForms');
    var attPanel= document.getElementById('accAttPanel');
    var mgrPanel= document.getElementById('accMgrPanel');
    var badge   = document.getElementById('attRoleBadge');
    var supCol  = document.getElementById('attSupCol');

    if (AUTH.logged_in) {
      /* ── signed-in banner ── */
      signed.classList.remove('hidden');
      forms.classList.add('hidden');
      document.getElementById('accRole').textContent = AUTH.is_manager ? 'Manager' : 'Supervisor';
      document.getElementById('accUser').textContent = AUTH.username;

      /* ── attendance panel — visible for both roles ── */
      attPanel.classList.remove('hidden');
      if (!getVal('attDate')) setVal('attDate', todayISO());

      if (AUTH.is_manager) {
        /* Manager: show supervisor column, all workers */
        if (supCol) supCol.classList.remove('hidden');
        if (badge){
          badge.textContent = '🛡 Manager — seeing all workers';
          badge.style.cssText = 'background:#e3f2fd;color:#1565c0;border-radius:12px;padding:2px 10px;';
        }
        mgrPanel.classList.remove('hidden');
        loadSupervisors();
      } else {
        /* Supervisor: hide supervisor column, own workers only */
        if (supCol) supCol.classList.add('hidden');
        if (badge){
          badge.textContent = '👨‍💼 Supervisor — your assigned workers';
          badge.style.cssText = 'background:var(--amber-bg);color:var(--amber);border-radius:12px;padding:2px 10px;';
        }
        mgrPanel.classList.add('hidden');
      }

      loadAttendance();

    } else {
      signed.classList.add('hidden');
      forms.classList.remove('hidden');
      attPanel.classList.add('hidden');
      mgrPanel.classList.add('hidden');
    }
  });
}

function supervisorLoginFull() {
  var u=getVal('accSupU'), p=getVal('accSupP');
  if (!u||!p){ setMsg('accSupMsg','✘ Username & password required','err'); return; }
  api('POST','/api/supervisor/login',{username:u,password:p}).then(function(r){
    clearVals(['accSupU','accSupP']); setMsg('accSupMsg','✔ Logged in as '+r.username,'ok');
    toast('Welcome '+r.username,'ok'); refreshAccountPage();
  }).catch(function(e){ setMsg('accSupMsg','✘ '+e.message,'err'); });
}
function supervisorRegister() {
  var u=getVal('accRegU'), p=getVal('accRegP');
  if (!u||!p){ setMsg('accRegMsg','✘ Username & password required','err'); return; }
  api('POST','/api/supervisor/register',{username:u,password:p}).then(function(r){
    setMsg('accRegMsg','✔ '+r.message,'ok'); clearVals(['accRegU','accRegP']); toast(r.message,'ok');
  }).catch(function(e){ setMsg('accRegMsg','✘ '+e.message,'err'); });
}
function managerLogin() {
  var u=getVal('accMgrU'), p=getVal('accMgrP');
  if (!u||!p){ setMsg('accMgrMsg','✘ Username & password required','err'); return; }
  api('POST','/api/manager/login',{username:u,password:p}).then(function(r){
    clearVals(['accMgrU','accMgrP']); setMsg('accMgrMsg','✔ Logged in as Manager','ok');
    toast('Manager logged in','ok'); refreshAccountPage();
  }).catch(function(e){ setMsg('accMgrMsg','✘ '+e.message,'err'); });
}
function anyLogout() {
  var url = AUTH.is_manager ? '/api/manager/logout' : '/api/supervisor/logout';
  api('POST',url).then(function(){ toast('Logged out','info'); refreshAccountPage(); })
    .catch(function(){ refreshAccountPage(); });
}

/* Manager: assign workers */
function loadSupervisors() {
  Promise.all([
    api('GET','/api/manager/supervisors'),
    api('GET','/api/manager/unassigned-workers')
  ]).then(function(results){
    var sups=results[0], unas=results[1];
    var sSel=document.getElementById('asSup');
    sSel.innerHTML=sups.length
      ? sups.map(function(s){return '<option value="'+s.id+'">'+escHtml(s.username)+'</option>';}).join('')
      : '<option value="">— no supervisors —</option>';
    var wSel=document.getElementById('asWk');
    wSel.innerHTML=unas.length
      ? unas.map(function(w){return '<option value="'+escHtml(w.number)+'">'+escHtml(w.number)+' — '+escHtml(w.name)+'</option>';}).join('')
      : '<option value="">— all workers assigned —</option>';
    var list=document.getElementById('supList');
    if (!sups.length){ list.innerHTML='<p class="text-muted">No supervisors yet.</p>'; return; }
    list.innerHTML=sups.map(function(s){
      var chips=(s.workers||[]).map(function(w){
        return '<span class="sup-worker-row">'+escHtml(w.number)+' — '+escHtml(w.name)
          +' <button title="Unassign" onclick="unassignWorker(\''+w.number+'\')">✕</button></span>';
      }).join('')||'<span class="text-muted" style="font-size:12px;">No workers assigned</span>';
      return '<div class="sup-block">'
        +'<div class="sup-block-head"><strong>'+escHtml(s.username)+'</strong>'
        +'<span class="text-muted" style="font-size:11px;">id: '+s.id+'</span></div>'
        +'<div>'+chips+'</div>'
        +'</div>';
    }).join('');
  }).catch(function(e){ toast(e.message,'err'); });
}
function assignWorker() {
  var sid=document.getElementById('asSup').value;
  var wnum=document.getElementById('asWk').value;
  if (!sid||!wnum){ toast('Choose supervisor and worker','err'); return; }
  api('POST','/api/manager/assign',{supervisor_id:parseInt(sid),worker_number:wnum})
    .then(function(r){ toast(r.message,'ok'); loadSupervisors(); })
    .catch(function(e){ toast(e.message,'err'); });
}
function unassignWorker(wnum) {
  if (!confirm('Unassign worker '+wnum+'?')) return;
  api('POST','/api/manager/unassign',{worker_number:wnum})
    .then(function(r){ toast(r.message,'ok'); loadSupervisors(); })
    .catch(function(e){ toast(e.message,'err'); });
}

/* =========================================================
   INIT
========================================================= */
document.addEventListener('DOMContentLoaded', function() {
  /* Check backend health */
  api('GET','/api/db-status').then(function(r){
    if (!r.ok){
      var bn=document.getElementById('dbBanner');
      var err=document.getElementById('dbBannerErr');
      if (bn) bn.classList.remove('hidden');
      if (err) err.textContent = 'DB Error: '+(r.error||'unknown');
    }
  }).catch(function(e){
    var bn=document.getElementById('dbBanner');
    var err=document.getElementById('dbBannerErr');
    if (bn) bn.classList.remove('hidden');
    if (err) err.textContent = e.message;
  });

  refreshAuth();
  loadNextBillId();
});
