const CONFIG_STORAGE_KEY = 'bakely-supabase-config';
function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY)) || { url: '', key: '' }; }
  catch { return { url: '', key: '' }; }
}
const state = {
  config: readConfig(),
  sales: [], salesSummary: { total: 0, count: 0 }, materials: [], products: [], productions: [], productionSummary: { total: 0, count: 0 }, usages: []
};
const $ = (selector) => document.querySelector(selector);
const rupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const quantity = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value || 0));
const dateId = (value) => new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
async function api(path, options = {}) {
  if (!state.config.url || !state.config.key) throw new Error('Masukkan URL dan key Supabase terlebih dahulu.');
  const baseUrl = state.config.url.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: state.config.key,
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || body.error || 'Permintaan gagal.');
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}
async function rpc(name, payload) { return api(`rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
async function loadData() {
  if (!state.config.url || !state.config.key) {
    $('#connection-label').textContent = 'Supabase belum diatur';
    $('.status-dot').style.background = '#cf9361';
    openModal('#settings-modal');
    return;
  }
  try {
    const results = await Promise.allSettled([
      api('penjualan?select=*&order=tanggal.desc&limit=30'), api('bahan_baku?select=*&order=nama.asc'), api('produk?select=*&order=nama.asc'),
      api('produksi?select=*,produk(nama)&order=tanggal.desc&limit=30'), api('pemakaian_bb?select=*,bahan_baku(nama,satuan),produksi(nomor_produksi,tanggal)&order=created_at.desc&limit=50'),
      rpc('ringkasan_penjualan', {}), rpc('ringkasan_produksi', {})
    ]);
    const [sales, materials, products, productions, usages, salesSummary, productionSummary] = results.map((result) => result.status === 'fulfilled' ? result.value : []);
    state.sales = sales; state.salesSummary = salesSummary || { total: 0, count: 0 }; state.materials = materials; state.products = products; state.productions = productions; state.productionSummary = productionSummary || { total: 0, count: 0 }; state.usages = usages;
    const failures = results.filter((result) => result.status === 'rejected');
    const migrationNeeded = failures.some((result) => result.reason?.status === 404);
    if (failures.length === results.length) {
      $('#connection-label').textContent = migrationNeeded ? 'Migrasi diperlukan' : 'Koneksi gagal';
      $('.status-dot').style.background = '#c86e7b';
    } else if (failures.length) {
      $('#connection-label').textContent = migrationNeeded ? 'Migrasi diperlukan' : 'Koneksi sebagian';
      $('.status-dot').style.background = '#cf9361';
    } else {
      $('#connection-label').textContent = 'Supabase terhubung';
      $('.status-dot').style.background = '#91bd7f';
    }
    render();
    if (failures.length) showToast(migrationNeeded ? 'Jalankan supabase/migration_public_access.sql di Supabase SQL Editor.' : failures[0].reason?.message || 'Sebagian data gagal dimuat.');
  } catch (error) {
    const migrationNeeded = error.status === 404;
    $('#connection-label').textContent = migrationNeeded ? 'Migrasi diperlukan' : 'Koneksi gagal';
    $('.status-dot').style.background = '#c86e7b';
    showToast(migrationNeeded ? 'Jalankan supabase/migration_public_access.sql di Supabase SQL Editor.' : error.message);
    render();
  }
}
function emptyRow(columns, text = 'Belum ada data.') { return `<tr><td colspan="${columns}" class="empty-state">${text}</td></tr>`; }
function render() {
  const salesTotal = Number(state.salesSummary.total || 0);
  const finishedTotal = state.products.reduce((sum, product) => sum + Number(product.stok || 0), 0);
  const inventoryValue = state.materials.reduce((sum, item) => sum + Number(item.stok || 0) * Number(item.harga_satuan || 0), 0);
  const lowStock = state.materials.filter((item) => Number(item.stok) <= Number(item.stok_minimum));
  $('#sales-total').textContent = rupiah(salesTotal); $('#sales-count').textContent = `${state.salesSummary.count || 0} transaksi`;
  $('#finished-total').textContent = `${finishedTotal} pcs`; $('#product-count').textContent = `${state.products.filter((item) => item.aktif).length} produk aktif`;
  $('#inventory-total').textContent = rupiah(inventoryValue); $('#low-stock-count').textContent = `${lowStock.length} bahan`;
  $('#low-stock-list').innerHTML = lowStock.length ? lowStock.map((item) => `<div class="stock-item"><div><div class="stock-name">${item.nama}</div><div class="stock-meta">${item.stok} ${item.satuan} tersisa</div></div><div class="stock-warning">MIN ${item.stok_minimum}</div></div>`).join('') : '<p class="empty-state">Semua stok aman.</p>';
  $('#recent-sales').innerHTML = state.sales.length ? state.sales.slice(0, 5).map((sale) => `<tr><td><button class="table-link" data-sale-detail="${sale.id}">${sale.nomor_nota}</button></td><td>${sale.pelanggan}</td><td class="align-right">${rupiah(sale.total)}</td></tr>`).join('') : emptyRow(3);
  $('#sales-table').innerHTML = state.sales.length ? state.sales.map((sale) => `<tr><td><button class="table-link" data-sale-detail="${sale.id}">${sale.nomor_nota}</button></td><td>${sale.pelanggan}</td><td>${dateId(sale.tanggal)}</td><td><span class="tag">${sale.status}</span></td><td class="align-right">${rupiah(sale.total)}</td></tr>`).join('') : emptyRow(5);
  $('#recent-production').innerHTML = state.productions.length ? state.productions.slice(0, 5).map((item) => productionRow(item, false)).join('') : emptyRow(4);
  $('#production-table').innerHTML = state.productions.length ? state.productions.map((item) => productionRow(item, true)).join('') : emptyRow(5);
  $('#usage-table').innerHTML = state.usages.length ? state.usages.map((item) => `<tr><td>${item.produksi?.nomor_produksi || 'Produksi lama'}</td><td>${item.bahan_baku?.nama || '-'}</td><td>${quantity(item.jumlah)} ${item.bahan_baku?.satuan || ''}</td><td>${dateId(item.produksi?.tanggal || item.created_at)}</td></tr>`).join('') : emptyRow(4);
  $('#material-table').innerHTML = state.materials.length ? state.materials.map((item) => { const status = Number(item.stok) < Number(item.stok_minimum) ? '<span class="stock-warning">di bawah minimum</span>' : Number(item.stok) === Number(item.stok_minimum) ? '<span class="stock-minimum">stok minimum</span>' : '<span class="stock-ok">aman</span>'; return `<tr><td>${item.nama}</td><td>${item.satuan}</td><td>${item.stok}</td><td>${item.stok_minimum}</td><td>${rupiah(item.harga_satuan)}</td><td>${status}</td><td class="row-actions"><button data-edit-material="${item.id}">Edit</button><button data-delete-material="${item.id}">Hapus</button></td></tr>`; }).join('') : emptyRow(7);
  $('#product-table').innerHTML = state.products.length ? state.products.map((item) => `<tr><td>${item.kode_produk || '-'}</td><td>${item.nama}</td><td>${rupiah(item.harga_jual)}</td><td>${item.stok} ${item.satuan}</td><td><span class="tag ${Number(item.stok) ? '' : 'tag-muted'}">${Number(item.stok) ? 'tersedia' : 'habis'}</span></td><td class="row-actions"><button data-edit-product="${item.id}">Edit</button><button data-delete-product="${item.id}">Hapus</button></td></tr>`).join('') : emptyRow(6);
  $('#sales-chart').innerHTML = renderChart();
  renderReports();
  refreshSelects();
}

function renderReports() {
  const recentSales = [...state.sales].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
  const reportSalesTotal = Number(state.salesSummary.total || 0);
  const productionTotal = Number(state.productionSummary.total || 0);
  const lowStock = state.materials.filter((item) => Number(item.stok) <= Number(item.stok_minimum));
  const readyProducts = state.products.filter((item) => Number(item.stok) > 0).reduce((sum, item) => sum + Number(item.stok || 0), 0);

  $('#report-sales-total').textContent = rupiah(reportSalesTotal);
  $('#report-sales-count-detail').textContent = `${state.salesSummary.count || 0} transaksi`;
  $('#report-production-total').textContent = `${productionTotal} pcs`;
  $('#report-production-count').textContent = `${state.productionSummary.count || 0} batch`;
  $('#report-low-stock-total').textContent = `${lowStock.length} bahan`;
  $('#report-ready-product-total').textContent = `${readyProducts} pcs`;
  $('#report-ready-product-label').textContent = `${state.products.filter((item) => Number(item.stok) > 0).length} produk siap jual`;

  $('#report-sales-table').innerHTML = recentSales.length ? recentSales.slice(0, 6).map((sale) => `<tr><td><button class="table-link" data-sale-detail="${sale.id}">${sale.nomor_nota}</button></td><td>${sale.pelanggan}</td><td>${dateId(sale.tanggal)}</td><td class="align-right">${rupiah(sale.total)}</td></tr>`).join('') : emptyRow(4);
  $('#report-stock-table').innerHTML = lowStock.length ? lowStock.slice(0, 6).map((item) => `<tr><td>${item.nama}</td><td>${item.stok} ${item.satuan}</td><td>${item.stok_minimum}</td><td><span class="stock-warning">Urgent</span></td></tr>`).join('') : '<tr><td colspan="4"><p class="empty-state">Semua stok aman.</p></td></tr>';
}
function productionRow(item, full) { const productionNumber = item.nomor_produksi || item.nomor || item.kode_produksi || '-'; return `<tr><td>${productionNumber}</td><td>${item.produk?.nama || '-'}</td><td>${item.jumlah} pcs</td><td>${dateId(item.tanggal)}</td>${full ? `<td>${item.catatan || '-'}</td>` : ''}</tr>`; }
function renderChart() { const items = state.sales.slice(0, 7).reverse(); const max = Math.max(...items.map((item) => Number(item.total)), 1); return items.length ? items.map((item) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(8, Number(item.total) / max * 100)}%" title="${rupiah(item.total)}"></div><small>${dateId(item.tanggal)}<br>${rupiah(item.total)}</small></div>`).join('') : '<p class="empty-state">Belum ada transaksi untuk grafik.</p>'; }
function refreshSelects() { const products = state.products.map((item) => `<option value="${item.id}">${item.nama} (${item.stok} ${item.satuan})</option>`).join(''); $('#production-product').innerHTML = products; document.querySelectorAll('.usage-material').forEach((select) => { const current = select.value; select.innerHTML = state.materials.map((item) => `<option value="${item.id}">${item.nama}</option>`).join(''); select.value = current; }); document.querySelectorAll('.sale-product').forEach((select) => { const current = select.value; select.innerHTML = state.products.map((item) => `<option value="${item.id}">${item.nama} (${rupiah(item.harga_jual)})</option>`).join(''); select.value = current; }); }
function addUsageRow() { $('#usage-fields').insertAdjacentHTML('beforeend', '<div class="dynamic-row"><select class="usage-material"></select><input class="usage-amount" type="number" min="0.01" step="0.01" placeholder="Jumlah"><button type="button" class="remove-row">×</button></div>'); refreshSelects(); }
function addSaleRow() { $('#sale-fields').insertAdjacentHTML('beforeend', '<div class="dynamic-row"><select class="sale-product"></select><input class="sale-amount" type="number" min="1" step="1" placeholder="Jumlah"><button type="button" class="remove-row">×</button></div>'); refreshSelects(); }
function openModal(id) { $(id).classList.add('visible'); if (id === '#production-modal' && !$('#usage-fields').children.length) addUsageRow(); if (id === '#sale-modal' && !$('#sale-fields').children.length) addSaleRow(); }
function closeModal(modal) { modal.classList.remove('visible'); const message = modal.querySelector('.form-message'); if (message) message.textContent = ''; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); setTimeout(() => toast.classList.remove('visible'), 3500); }
function showSettings() {
  $('#supabase-url').value = state.config.url;
  $('#supabase-key').value = state.config.key;
  $('#settings-form .form-message').textContent = '';
  openModal('#settings-modal');
}
function goToView(view) { document.querySelectorAll('.view').forEach((section) => section.classList.remove('active-view')); $(`#${view}-view`).classList.add('active-view'); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view)); const titles = { dashboard: ['Ringkasan usaha', 'Sistem Akuntansi Bakely'], bahan: ['Master data', 'Bahan baku'], produk: ['Master data', 'Barang jadi'], pemakaian: ['Transaksi', 'Pemakaian bahan baku'], produksi: ['Transaksi', 'Produksi'], penjualan: ['Transaksi', 'Penjualan'], laporan: ['Analisis usaha', 'Laporan bakery'] }; $('#page-kicker').textContent = titles[view][0]; $('#page-title').textContent = titles[view][1]; }

document.querySelectorAll('.nav-item, [data-view-link]').forEach((button) => button.addEventListener('click', () => goToView(button.dataset.view || button.dataset.viewLink)));
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openModal(`#${button.dataset.open}`)));
document.querySelectorAll('.modal-backdrop').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal || event.target.matches('[data-close-modal]')) closeModal(modal); }));
document.addEventListener('click', async (event) => { const materialId = event.target.dataset.deleteMaterial; const productId = event.target.dataset.deleteProduct; if (event.target.classList.contains('remove-row')) event.target.closest('.dynamic-row').remove(); if (materialId && confirm('Hapus bahan baku ini?')) { try { await api(`bahan_baku?id=eq.${materialId}`, { method: 'DELETE' }); await loadData(); } catch (error) { showToast(error.message); } } if (productId && confirm('Hapus produk ini?')) { try { await api(`produk?id=eq.${productId}`, { method: 'DELETE' }); await loadData(); } catch (error) { showToast(error.message); } } if (event.target.dataset.editMaterial) { const item = state.materials.find((material) => material.id === event.target.dataset.editMaterial); if (item) { $('#material-id').value = item.id; $('#material-name').value = item.nama; $('#material-unit').value = item.satuan; $('#material-stock').value = item.stok; $('#material-minimum').value = item.stok_minimum; $('#material-price').value = item.harga_satuan; $('#material-modal-title').textContent = 'Edit bahan baku'; openModal('#material-modal'); } } });
document.addEventListener('click', (event) => { const id = event.target.dataset.editProduct; if (!id) return; const item = state.products.find((product) => product.id === id); if (!item) return; $('#product-id').value = item.id; $('#product-code').value = item.kode_produk || ''; $('#product-name').value = item.nama; $('#product-price').value = item.harga_jual; $('#product-stock').value = item.stok; $('#product-unit').value = item.satuan; $('#product-modal-title').textContent = 'Edit barang jadi'; openModal('#product-modal'); });
document.addEventListener('click', async (event) => { const id = event.target.dataset.saleDetail; if (!id) return; const sale = state.sales.find((item) => item.id === id); if (!sale) return; try { const details = await api(`detail_penjualan?select=*,produk(nama)&penjualan_id=eq.${id}`); $('#detail-sale-number').textContent = sale.nomor_nota; $('#detail-sale-meta').textContent = `${sale.pelanggan} · ${dateId(sale.tanggal)} · ${sale.status}`; $('#detail-sale-total').textContent = rupiah(sale.total); $('#sale-detail-table').innerHTML = details.length ? details.map((item) => `<tr><td>${item.produk?.nama || '-'}</td><td>${item.jumlah}</td><td>${rupiah(item.harga_satuan)}</td><td class="align-right">${rupiah(item.subtotal)}</td></tr>`).join('') : emptyRow(4, 'Detail belum tersedia.'); openModal('#sale-detail-modal'); } catch (error) { showToast(error.message); } });
$('#add-usage').addEventListener('click', addUsageRow); $('#add-sale-item').addEventListener('click', addSaleRow);
$('#material-modal form').addEventListener('submit', async (event) => { event.preventDefault(); const id = $('#material-id').value; const payload = { nama: $('#material-name').value, satuan: $('#material-unit').value, stok: Number($('#material-stock').value), stok_minimum: Number($('#material-minimum').value), harga_satuan: Number($('#material-price').value) }; try { await api(id ? `bahan_baku?id=eq.${id}` : 'bahan_baku', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); closeModal($('#material-modal')); event.currentTarget.reset(); $('#material-id').value = ''; $('#material-modal-title').textContent = 'Tambah bahan baku'; await loadData(); showToast('Bahan baku disimpan.'); } catch (error) { event.currentTarget.querySelector('.form-message').textContent = error.message; } });
$('#product-modal form').addEventListener('submit', async (event) => { event.preventDefault(); const id = $('#product-id').value; const payload = { kode_produk: $('#product-code').value, nama: $('#product-name').value, harga_jual: Number($('#product-price').value), stok: Number($('#product-stock').value), satuan: $('#product-unit').value, aktif: true }; try { await api(id ? `produk?id=eq.${id}` : 'produk', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); closeModal($('#product-modal')); event.currentTarget.reset(); $('#product-id').value = ''; $('#product-modal-title').textContent = 'Tambah barang jadi'; await loadData(); showToast('Produk disimpan.'); } catch (error) { event.currentTarget.querySelector('.form-message').textContent = error.message; } });
$('#production-modal form').addEventListener('submit', async (event) => { event.preventDefault(); const usage = [...document.querySelectorAll('#usage-fields .dynamic-row')].map((row) => ({ bahan_baku_id: row.querySelector('.usage-material').value, jumlah: Number(row.querySelector('.usage-amount').value) })).filter((item) => item.bahan_baku_id && item.jumlah > 0); try { await rpc('catat_produksi', { p_nomor_produksi: $('#production-number').value, p_produk_id: $('#production-product').value, p_jumlah: Number($('#production-amount').value), p_catatan: $('#production-note').value || null, p_pemakaian: usage }); closeModal($('#production-modal')); event.currentTarget.reset(); $('#usage-fields').innerHTML = ''; await loadData(); showToast('Produksi dicatat dan stok diperbarui.'); } catch (error) { event.currentTarget.querySelector('.form-message').textContent = error.message; } });
$('#sale-modal form').addEventListener('submit', async (event) => { event.preventDefault(); const items = [...document.querySelectorAll('#sale-fields .dynamic-row')].map((row) => ({ produk_id: row.querySelector('.sale-product').value, jumlah: Number(row.querySelector('.sale-amount').value) })).filter((item) => item.produk_id && item.jumlah > 0); try { await rpc('catat_penjualan', { p_nomor_nota: $('#sale-number').value, p_pelanggan: $('#sale-customer').value, p_items: items, p_status: $('#sale-status').value }); closeModal($('#sale-modal')); event.currentTarget.reset(); $('#sale-fields').innerHTML = ''; await loadData(); showToast('Penjualan dicatat dan stok barang jadi berkurang.'); } catch (error) { event.currentTarget.querySelector('.form-message').textContent = error.message; } });
$('#settings-button').addEventListener('click', showSettings);
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = $('#supabase-url').value.trim().replace(/\/+$/, '');
  const key = $('#supabase-key').value.trim();
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('URL Supabase harus menggunakan HTTP atau HTTPS.');
    state.config = { url, key };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(state.config));
    closeModal($('#settings-modal'));
    $('#connection-label').textContent = 'Menghubungkan...';
    await loadData();
  } catch (error) {
    event.currentTarget.querySelector('.form-message').textContent = error.message;
  }
});
$('#today').textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date()); loadData();