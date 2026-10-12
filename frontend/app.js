const CONFIG_STORAGE_KEY = 'bakely-supabase-config';
function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY)) || { url: '', key: '' }; }
  catch { return { url: '', key: '' }; }
}
const state = {
  config: readConfig(), sales: [], salesReport: [], filteredSales: [], salesSummary: { total: 0, count: 0 },
  materials: [], products: [], productions: [], productionReport: [], filteredProductions: [], productionSummary: { total: 0, count: 0 },
  usages: [], recipes: [], recipeApplied: false, movements: [], filteredMovements: [], saleDetails: [], dataErrors: {}
};
const $ = (selector) => document.querySelector(selector);
const rupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const quantity = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value || 0));
const dateId = (value) => new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
async function api(path, options = {}) {
  return requestApi(state.config, path, options);
}
async function requestApi(config, path, options = {}) {
  if (!config.url || !config.key) throw new Error('Masukkan URL dan key Supabase terlebih dahulu.');
  const baseUrl = config.url.replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Prefer: 'return=representation',
        ...(options.headers || {})
      }
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`Tidak dapat menghubungi Supabase. Periksa Project URL, koneksi internet, dan pengaturan CORS. ${error.message}`);
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = body.message || body.error || 'Permintaan gagal.';
    if (response.status === 401) message = 'API key tidak valid atau bukan milik Project URL ini.';
    else if (response.status === 403 || body.code === '42501') message = 'Akses ditolak. Periksa Row Level Security (RLS) dan izin role anon pada schema.sql.';
    else if (['PGRST205', '42P01'].includes(body.code)) message = 'Tabel Supabase belum tersedia. Jalankan supabase/schema.sql untuk project baru atau supabase/upgrade_accounting.sql untuk database lama.';
    else if (body.code === 'PGRST202') message = 'Fungsi database belum tersedia. Jalankan supabase/schema.sql untuk project baru atau supabase/upgrade_accounting.sql untuk database lama.';
    else if (body.code) message = `${message} (${body.code})`;
    if (body.hint) message += ` Petunjuk: ${body.hint}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}
async function testConnection(config) {
  const tables = ['bahan_baku', 'produk', 'penjualan', 'detail_penjualan', 'produksi', 'pemakaian_bb', 'resep_produk', 'mutasi_stok'];
  await Promise.all(tables.map((table) => requestApi(config, `${table}?select=id&limit=1`)));
}
async function rpc(name, payload) { return api(`rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
async function apiAll(path, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await api(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += page.length;
  }
}
async function loadData() {
  if (!state.config.url || !state.config.key) {
    $('#connection-label').textContent = 'Supabase belum diatur';
    $('.status-dot').style.background = '#cf9361';
    renderUnavailable('Hubungkan Supabase untuk memuat data.');
    openModal('#settings-modal');
    return;
  }
  try {
    const names = ['sales', 'materials', 'products', 'productions', 'usages', 'recipes', 'movements', 'saleDetails'];
    const results = await Promise.allSettled([
      apiAll('penjualan?select=*&order=tanggal.desc'),
      apiAll('bahan_baku?select=*&order=nama.asc'),
      apiAll('produk?select=*&order=nama.asc'),
      apiAll('produksi?select=*,produk(nama)&order=tanggal.desc'),
      apiAll('pemakaian_bb?select=*,bahan_baku(nama,satuan,harga_satuan),produksi(nomor_produksi,tanggal)&order=created_at.desc'),
      apiAll('resep_produk?select=*,produk(nama),bahan_baku(nama,satuan,harga_satuan)&order=created_at.asc'),
      apiAll('mutasi_stok?select=*,bahan_baku(nama,satuan),produk(nama,satuan)&order=created_at.desc'),
      apiAll('detail_penjualan?select=penjualan_id,produk_id,jumlah,harga_satuan,subtotal,hpp_satuan,produk(nama)&order=penjualan_id.asc')
    ]);
    const data = Object.fromEntries(names.map((name, index) => [name, results[index].status === 'fulfilled' ? results[index].value : []]));
    state.dataErrors = Object.fromEntries(names.flatMap((name, index) => results[index].status === 'rejected' ? [[name, results[index].reason]] : []));
    state.salesReport = data.sales;
    state.sales = data.sales.slice(0, 30);
    state.salesSummary = data.sales.filter((sale) => sale.status !== 'batal' && isToday(sale.tanggal)).reduce((summary, sale) => ({ total: summary.total + Number(sale.total || 0), count: summary.count + 1 }), { total: 0, count: 0 });
    state.materials = data.materials;
    state.products = data.products;
    state.productionReport = data.productions;
    state.productions = data.productions.slice(0, 30);
    state.productionSummary = data.productions.filter((item) => isToday(item.tanggal)).reduce((summary, item) => ({ total: summary.total + Number(item.jumlah || 0), count: summary.count + 1 }), { total: 0, count: 0 });
    state.usages = data.usages;
    state.recipes = data.recipes;
    state.movements = data.movements;
    state.saleDetails = data.saleDetails;
    const coreNames = ['sales', 'materials', 'products', 'productions', 'usages'];
    const coreFailures = coreNames.filter((name) => state.dataErrors[name]);
    const failures = names.filter((name) => state.dataErrors[name]);
    if (coreFailures.length === coreNames.length) {
      $('#connection-label').textContent = 'Koneksi gagal';
      $('.status-dot').style.background = '#c86e7b';
    } else if (failures.length) {
      $('#connection-label').textContent = 'Koneksi sebagian';
      $('.status-dot').style.background = '#cf9361';
    } else {
      $('#connection-label').textContent = 'Supabase terhubung';
      $('.status-dot').style.background = '#91bd7f';
    }
    render();
    if (failures.length) showToast(`${failures[0]}: ${state.dataErrors[failures[0]].message}`);
  } catch (error) {
    $('#connection-label').textContent = 'Koneksi gagal';
    $('.status-dot').style.background = '#c86e7b';
    showToast(error.message);
    render();
  }
}
function emptyRow(columns, text = 'Belum ada data.') { return `<tr><td colspan="${columns}" class="empty-state">${text}</td></tr>`; }
function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function isToday(value) { return localDateKey(value) === localDateKey(new Date()); }
function dayOffset(offset) { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + offset); return date; }
function isWithinRange(value, start, end) {
  const date = new Date(value);
  return (!start || date >= start) && (!end || date < end);
}
function renderUnavailable(message) {
  ['sales-total', 'finished-total', 'inventory-total', 'low-stock-count', 'hero-sales-today', 'hero-production-today', 'today-sales-count', 'feature-low-stock', 'feature-production-count',
    'report-sales-total', 'report-sales-count-detail', 'report-production-total', 'report-production-count', 'report-low-stock-total',
    'report-ready-product-total', 'report-ready-product-label', 'report-cogs-total', 'report-gross-profit'].forEach((id) => { $(`#${id}`).textContent = '—'; });
  ['sales-chart', 'production-chart', 'low-stock-list'].forEach((id) => { $(`#${id}`).innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`; });
  const emptyTables = { 'recent-sales': 3, 'sales-table': 6, 'recent-production': 4, 'production-table': 5, 'usage-table': 4, 'material-table': 7, 'product-table': 6, 'recipe-table': 4, 'report-sales-table': 4, 'report-stock-table': 4, 'report-production-table': 5, 'report-movements-table': 5 };
  Object.entries(emptyTables).forEach(([id, columns]) => { $(`#${id}`).innerHTML = emptyRow(columns, escapeHtml(message)); });
}
function render() {
  const lowStock = state.materials.filter((item) => Number(item.stok) <= Number(item.stok_minimum));
  const finishedTotal = state.products.filter((product) => product.aktif).reduce((sum, product) => sum + Number(product.stok || 0), 0);
  const inventoryValue = state.materials.reduce((sum, item) => sum + Number(item.stok || 0) * Number(item.harga_satuan || 0), 0);
  const salesToday = state.salesSummary;
  $('#sales-total').textContent = metricValue('sales', rupiah(salesToday.total));
  $('#sales-count').textContent = state.dataErrors.sales ? 'Data gagal dimuat' : `${salesToday.count} transaksi hari ini`;
  $('#hero-sales-today').textContent = state.dataErrors.sales ? 'Data gagal dimuat' : rupiah(salesToday.total);
  $('#today-sales-count').textContent = state.dataErrors.sales ? 'Data gagal dimuat' : `${salesToday.count} transaksi`;
  $('#finished-total').textContent = metricValue('products', `${quantity(finishedTotal)} pcs`);
  $('#product-count').textContent = state.dataErrors.products ? 'Data gagal dimuat' : `${state.products.filter((item) => item.aktif).length} produk aktif`;
  $('#inventory-total').textContent = metricValue('materials', rupiah(inventoryValue));
  $('#low-stock-count').textContent = metricValue('materials', `${lowStock.length} bahan`);
  $('#feature-low-stock').textContent = metricValue('materials', `${lowStock.length} bahan perlu cek`);
  $('#hero-production-today').textContent = state.dataErrors.productions ? 'Data gagal dimuat' : `${quantity(state.productionSummary.total)} pcs`;
  $('#feature-production-count').textContent = state.dataErrors.productions ? 'Data gagal dimuat' : `${state.productionSummary.count} batch · ${quantity(state.productionSummary.total)} pcs`;
  $('#low-stock-list').innerHTML = state.dataErrors.materials ? `<p class="empty-state">${escapeHtml(state.dataErrors.materials.message)}</p>` : lowStock.length ? lowStock.map((item) => `<div class="stock-item"><div><div class="stock-name">${escapeHtml(item.nama)}</div><div class="stock-meta">${quantity(item.stok)} ${escapeHtml(item.satuan)} tersisa</div></div><div class="${Number(item.stok) === 0 ? 'stock-warning' : 'stock-minimum'}">${Number(item.stok) === 0 ? 'HABIS' : 'MENIPIS'} · MIN ${quantity(item.stok_minimum)}</div></div>`).join('') : '<p class="empty-state">Semua stok aman.</p>';
  const activeSales = state.sales.filter((sale) => sale.status !== 'batal');
  $('#recent-sales').innerHTML = activeSales.length ? activeSales.slice(0, 5).map((sale) => `<tr><td><button class="table-link" data-sale-detail="${sale.id}">${escapeHtml(sale.nomor_nota)}</button></td><td>${escapeHtml(sale.pelanggan)}</td><td class="align-right">${rupiah(sale.total)}</td></tr>`).join('') : emptyRow(3, state.dataErrors.sales ? 'Data penjualan gagal dimuat.' : 'Belum ada transaksi penjualan.');
  $('#sales-table').innerHTML = state.sales.length ? state.sales.map((sale) => `<tr><td><button class="table-link" data-sale-detail="${sale.id}">${escapeHtml(sale.nomor_nota)}</button></td><td>${escapeHtml(sale.pelanggan)}</td><td>${dateId(sale.tanggal)}</td><td><span class="tag ${sale.status === 'batal' ? 'tag-muted' : ''}">${escapeHtml(sale.status)}</span></td><td class="align-right">${rupiah(sale.total)}</td><td class="row-actions">${sale.status === 'batal' ? '' : `<button data-cancel-sale="${sale.id}">Batalkan</button>`}</td></tr>`).join('') : emptyRow(6, state.dataErrors.sales ? 'Data penjualan gagal dimuat.' : 'Belum ada transaksi penjualan.');
  $('#recent-production').innerHTML = state.productions.length ? state.productions.slice(0, 5).map((item) => productionRow(item, false)).join('') : emptyRow(4, state.dataErrors.productions ? 'Data produksi gagal dimuat.' : 'Belum ada produksi.');
  $('#production-table').innerHTML = state.productions.length ? state.productions.map((item) => productionRow(item, true)).join('') : emptyRow(5, state.dataErrors.productions ? 'Data produksi gagal dimuat.' : 'Belum ada produksi.');
  $('#usage-table').innerHTML = state.usages.length ? state.usages.map((item) => `<tr><td>${escapeHtml(item.produksi?.nomor_produksi || 'Produksi lama')}</td><td>${escapeHtml(item.bahan_baku?.nama || '-')}</td><td>${quantity(item.jumlah)} ${escapeHtml(item.bahan_baku?.satuan || '')}</td><td>${dateId(item.produksi?.tanggal || item.created_at)}</td></tr>`).join('') : emptyRow(4, state.dataErrors.usages ? 'Data pemakaian gagal dimuat.' : 'Belum ada catatan pemakaian.');
  $('#material-table').innerHTML = state.materials.length ? state.materials.map((item) => { const status = Number(item.stok) === 0 ? '<span class="stock-warning">habis</span>' : Number(item.stok) <= Number(item.stok_minimum) ? '<span class="stock-minimum">stok menipis</span>' : '<span class="stock-ok">aman</span>'; return `<tr><td>${escapeHtml(item.nama)}</td><td>${escapeHtml(item.satuan)}</td><td>${quantity(item.stok)}</td><td>${quantity(item.stok_minimum)}</td><td>${rupiah(item.harga_satuan)}</td><td>${status}</td><td class="row-actions"><button data-restock-material="${item.id}">Stok masuk</button><button data-edit-material="${item.id}">Edit</button><button data-delete-material="${item.id}">Hapus</button></td></tr>`; }).join('') : emptyRow(7, state.dataErrors.materials ? 'Data bahan baku gagal dimuat.' : 'Belum ada bahan baku.');
  $('#product-table').innerHTML = state.products.length ? state.products.map((item) => `<tr><td>${escapeHtml(item.kode_produk || '-')}</td><td>${escapeHtml(item.nama)}</td><td>${rupiah(item.harga_jual)}</td><td>${quantity(item.stok)} ${escapeHtml(item.satuan)}</td><td><span class="tag ${Number(item.stok) ? '' : 'tag-muted'}">${Number(item.stok) ? 'tersedia' : 'habis'}</span></td><td class="row-actions"><button data-edit-product="${item.id}">Edit</button><button data-delete-product="${item.id}">Hapus</button></td></tr>`).join('') : emptyRow(6, state.dataErrors.products ? 'Data produk gagal dimuat.' : 'Belum ada produk.');
  $('#sales-chart').innerHTML = renderChart('sales');
  $('#production-chart').innerHTML = renderChart('production');
  renderRecipes();
  renderReports();
  refreshSelects();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function metricValue(dataset, value) { return state.dataErrors[dataset] ? 'Gagal dimuat' : value; }
function renderReports() {
  const start = $('#report-start').value ? new Date(`${$('#report-start').value}T00:00:00`) : null;
  const end = $('#report-end').value ? new Date(`${$('#report-end').value}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  const search = $('#report-search').value.trim().toLocaleLowerCase('id-ID');
  const sales = state.salesReport.filter((sale) => sale.status !== 'batal' && isWithinRange(sale.tanggal, start, end) && (!search || `${sale.nomor_nota} ${sale.pelanggan}`.toLocaleLowerCase('id-ID').includes(search)));
  const saleIds = new Set(sales.map((sale) => sale.id));
  const productions = state.productionReport.filter((item) => isWithinRange(item.tanggal, start, end));
  const movements = state.movements.filter((item) => isWithinRange(item.created_at, start, end));
  const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const productionTotal = productions.reduce((sum, item) => sum + Number(item.jumlah || 0), 0);
  const lowStock = state.materials.filter((item) => Number(item.stok) <= Number(item.stok_minimum));
  const readyProducts = state.products.filter((item) => Number(item.stok) > 0).reduce((sum, item) => sum + Number(item.stok || 0), 0);
  const filteredDetails = state.saleDetails.filter((item) => saleIds.has(item.penjualan_id));
  const knownCostDetails = filteredDetails.filter((item) => item.hpp_satuan !== null && item.hpp_satuan !== undefined);
  const cogs = knownCostDetails.reduce((sum, item) => sum + Number(item.hpp_satuan) * Number(item.jumlah), 0);
  const hasCompleteCogs = filteredDetails.length > 0 && knownCostDetails.length === filteredDetails.length;

  $('#report-sales-total').textContent = state.dataErrors.sales ? 'Gagal dimuat' : rupiah(totalSales);
  $('#report-sales-count-detail').textContent = state.dataErrors.sales ? 'Data penjualan tidak tersedia' : `${sales.length} transaksi`;
  $('#report-production-total').textContent = state.dataErrors.productions ? 'Gagal dimuat' : `${productionTotal} pcs`;
  $('#report-production-count').textContent = state.dataErrors.productions ? 'Data produksi tidak tersedia' : `${productions.length} batch`;
  $('#report-low-stock-total').textContent = state.dataErrors.materials ? 'Gagal dimuat' : `${lowStock.length} bahan`;
  $('#report-ready-product-total').textContent = state.dataErrors.products ? 'Gagal dimuat' : `${readyProducts} pcs`;
  $('#report-ready-product-label').textContent = state.dataErrors.products ? 'Data produk tidak tersedia' : `${state.products.filter((item) => Number(item.stok) > 0).length} produk siap jual`;
  $('#report-cogs-total').textContent = state.dataErrors.saleDetails ? 'Gagal dimuat' : hasCompleteCogs ? rupiah(cogs) : 'Belum tersedia';
  $('#report-gross-profit').textContent = state.dataErrors.saleDetails ? 'Data HPP penjualan tidak tersedia' : hasCompleteCogs ? `Laba kotor estimasi ${rupiah(totalSales - cogs)}` : 'Buat resep & catat biaya produksi untuk menghitung HPP';
  $('#report-sales-table').innerHTML = sales.length ? sales.map((sale) => `<tr><td><button class="table-link" data-sale-detail="${sale.id}">${escapeHtml(sale.nomor_nota)}</button></td><td>${escapeHtml(sale.pelanggan)}</td><td>${dateId(sale.tanggal)}</td><td class="align-right">${rupiah(sale.total)}</td></tr>`).join('') : emptyRow(4, state.dataErrors.sales ? 'Data penjualan gagal dimuat.' : 'Tidak ada penjualan pada periode ini.');
  $('#report-stock-table').innerHTML = lowStock.length ? lowStock.map((item) => `<tr><td>${escapeHtml(item.nama)}</td><td>${quantity(item.stok)} ${escapeHtml(item.satuan)}</td><td>${quantity(item.stok_minimum)}</td><td><span class="${Number(item.stok) === 0 ? 'stock-warning' : 'stock-minimum'}">${Number(item.stok) === 0 ? 'Habis' : 'Menipis'}</span></td></tr>`).join('') : emptyRow(4, state.dataErrors.materials ? 'Data stok gagal dimuat.' : 'Semua stok aman.');
  $('#report-production-table').innerHTML = productions.length ? productions.map((item) => `<tr><td>${escapeHtml(item.nomor_produksi)}</td><td>${escapeHtml(item.produk?.nama || '-')}</td><td>${quantity(item.jumlah)}</td><td>${item.biaya_bahan_baku === null || item.biaya_bahan_baku === undefined ? 'Belum dihitung' : rupiah(Number(item.biaya_bahan_baku) + Number(item.biaya_tenaga_kerja || 0) + Number(item.biaya_overhead || 0))}</td><td>${item.hpp_per_unit == null ? 'Belum dihitung' : rupiah(item.hpp_per_unit)}</td></tr>`).join('') : emptyRow(5, state.dataErrors.productions ? 'Data produksi gagal dimuat.' : 'Belum ada produksi pada periode ini.');
  $('#report-movements-table').innerHTML = movements.length ? movements.slice(0, 100).map((item) => `<tr><td>${dateId(item.created_at)}</td><td>${escapeHtml(item.bahan_baku?.nama || item.produk?.nama || '-')}</td><td>${escapeHtml(item.tipe)}</td><td class="${Number(item.jumlah) < 0 ? 'stock-warning' : 'stock-ok'}">${Number(item.jumlah) > 0 ? '+' : ''}${quantity(item.jumlah)} ${escapeHtml(item.bahan_baku?.satuan || item.produk?.satuan || '')}</td><td>${escapeHtml(item.catatan || '-')}</td></tr>`).join('') : emptyRow(5, state.dataErrors.movements ? 'Jalankan migrasi database untuk memuat riwayat stok.' : 'Belum ada mutasi stok pada periode ini.');
  state.filteredSales = sales;
  state.filteredProductions = productions;
  state.filteredMovements = movements;
}
function exportCsv(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    const safeText = typeof value === 'string' && /^[\t\r\n=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportSalesCsv() {
  exportCsv(`laporan-penjualan-${localDateKey(new Date())}.csv`, [
    ['Nomor nota', 'Tanggal', 'Pelanggan', 'Status', 'Total (IDR)'],
    ...state.filteredSales.map((sale) => [sale.nomor_nota, new Date(sale.tanggal).toISOString(), sale.pelanggan, sale.status, Number(sale.total || 0)])
  ]);
}
function exportProductionCsv() {
  exportCsv(`laporan-produksi-${localDateKey(new Date())}.csv`, [
    ['Nomor produksi', 'Tanggal', 'Produk', 'Jumlah', 'Biaya bahan (IDR)', 'Tenaga kerja (IDR)', 'Overhead (IDR)', 'HPP per unit (IDR)'],
    ...state.filteredProductions.map((item) => [item.nomor_produksi, new Date(item.tanggal).toISOString(), item.produk?.nama || '', Number(item.jumlah || 0), item.biaya_bahan_baku ?? '', item.biaya_tenaga_kerja ?? '', item.biaya_overhead ?? '', item.hpp_per_unit ?? ''])
  ]);
}
function exportInventoryCsv() {
  exportCsv(`laporan-mutasi-stok-${localDateKey(new Date())}.csv`, [
    ['Tanggal', 'Item', 'Jenis', 'Perubahan', 'Stok sebelum', 'Stok sesudah', 'Catatan'],
    ...state.filteredMovements.map((item) => [new Date(item.created_at).toISOString(), item.bahan_baku?.nama || item.produk?.nama || '', item.tipe, item.jumlah, item.stok_sebelum, item.stok_sesudah, item.catatan || ''])
  ]);
}
function productionRow(item, full) { const productionNumber = item.nomor_produksi || item.nomor || item.kode_produksi || '-'; return `<tr><td>${escapeHtml(productionNumber)}</td><td>${escapeHtml(item.produk?.nama || '-')}</td><td>${quantity(item.jumlah)} pcs</td><td>${dateId(item.tanggal)}</td>${full ? `<td>${escapeHtml(item.catatan || '-')}</td>` : ''}</tr>`; }
function renderRecipes() {
  const groups = new Map();
  state.recipes.forEach((recipe) => {
    if (!groups.has(recipe.produk_id)) groups.set(recipe.produk_id, []);
    groups.get(recipe.produk_id).push(recipe);
  });
  $('#recipe-table').innerHTML = groups.size ? [...groups.entries()].map(([productId, items]) => {
    const first = items[0];
    return `<tr><td>${escapeHtml(first.produk?.nama || '-')}</td><td>${items.map((item) => escapeHtml(item.bahan_baku?.nama || '-')).join('<br>')}</td><td>${items.map((item) => `${quantity(item.jumlah_per_produk)} ${escapeHtml(item.bahan_baku?.satuan || '')}`).join('<br>')}</td><td class="row-actions"><button data-edit-recipe="${productId}">Edit resep</button></td></tr>`;
  }).join('') : emptyRow(4, state.dataErrors.recipes ? 'Jalankan migrasi database untuk mengaktifkan resep.' : 'Belum ada resep. Tambahkan resep agar pemakaian bahan dihitung otomatis.');
}
function renderChart(type) {
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = dayOffset(index - 6);
    const key = localDateKey(date);
    const rows = (type === 'sales' ? state.salesReport : state.productionReport).filter((item) => item.status !== 'batal' && localDateKey(item.tanggal) === key);
    const total = rows.reduce((sum, item) => sum + Number(type === 'sales' ? item.total || 0 : item.jumlah || 0), 0);
    return { label: date.toLocaleDateString('id-ID', { weekday: 'short' }), total };
  });
  const error = state.dataErrors[type === 'sales' ? 'sales' : 'productions'];
  if (error) return `<p class="empty-state">Grafik gagal dimuat: ${escapeHtml(error.message)}</p>`;
  if (!daily.some((item) => item.total > 0)) return '<p class="empty-state">Belum ada data untuk 7 hari terakhir.</p>';
  const max = Math.max(...daily.map((item) => item.total), 1);
  return daily.map((item) => `<div class="bar-wrap" title="${type === 'sales' ? rupiah(item.total) : `${quantity(item.total)} pcs`}"><div class="bar ${type === 'production' ? 'bar-production' : ''}" style="height:${Math.max(4, item.total / max * 100)}%"></div><small>${item.label}<br>${type === 'sales' ? rupiah(item.total) : `${quantity(item.total)} pcs`}</small></div>`).join('');
}
function refreshSelects() {
  const products = state.products.filter((item) => item.aktif);
  const productOptions = products.map((item) => `<option value="${item.id}">${escapeHtml(item.nama)} (${quantity(item.stok)} ${escapeHtml(item.satuan)})</option>`).join('');
  $('#production-product').innerHTML = productOptions;
  $('#recipe-product').innerHTML = productOptions;
  document.querySelectorAll('.usage-material, .recipe-material').forEach((select) => {
    const current = select.value;
    select.innerHTML = state.materials.map((item) => `<option value="${item.id}">${escapeHtml(item.nama)} (${escapeHtml(item.satuan)})</option>`).join('');
    select.value = current && [...select.options].some((option) => option.value === current) ? current : select.options[0]?.value || '';
  });
  document.querySelectorAll('.sale-product').forEach((select) => {
    const current = select.value;
    select.innerHTML = products.map((item) => `<option value="${item.id}" ${Number(item.stok) <= 0 ? 'disabled' : ''}>${escapeHtml(item.nama)} (${quantity(item.stok)} ${escapeHtml(item.satuan)} · ${rupiah(item.harga_jual)})</option>`).join('');
    select.value = current && [...select.options].some((option) => option.value === current && !option.disabled) ? current : select.querySelector('option:not(:disabled)')?.value || '';
  });
}
function addUsageRow() { $('#usage-fields').insertAdjacentHTML('beforeend', '<div class="dynamic-row"><select class="usage-material"></select><input class="usage-amount" type="number" min="0.01" step="0.01" placeholder="Jumlah"><button type="button" class="remove-row">×</button></div>'); refreshSelects(); }
function addSaleRow() { $('#sale-fields').insertAdjacentHTML('beforeend', '<div class="dynamic-row"><select class="sale-product"></select><input class="sale-amount" type="number" min="1" step="1" placeholder="Jumlah"><button type="button" class="remove-row">×</button></div>'); refreshSelects(); }
function addRecipeRow() { $('#recipe-fields').insertAdjacentHTML('beforeend', '<div class="dynamic-row"><select class="recipe-material"></select><input class="recipe-amount" type="number" min="0.0001" step="0.0001" placeholder="Per produk" required><button type="button" class="remove-row">×</button></div>'); refreshSelects(); }
function loadRecipeForm(productId) {
  const product = productId || $('#recipe-product').value || state.products.find((item) => item.aktif)?.id || '';
  $('#recipe-product').value = product;
  $('#recipe-fields').innerHTML = '';
  const recipes = state.recipes.filter((item) => item.produk_id === product);
  recipes.forEach((recipe) => {
    addRecipeRow();
    const row = $('#recipe-fields').lastElementChild;
    row.querySelector('.recipe-material').value = recipe.bahan_baku_id;
    row.querySelector('.recipe-amount').value = recipe.jumlah_per_produk;
  });
  if (!recipes.length) addRecipeRow();
}
function updateProductionRecipe() {
  const productId = $('#production-product').value;
  const recipes = state.recipes.filter((item) => item.produk_id === productId);
  if (!recipes.length) {
    if (state.recipeApplied) {
      $('#usage-fields').innerHTML = '';
      addUsageRow();
    }
    state.recipeApplied = false;
    $('#add-usage').hidden = false;
    $('#recipe-hint').textContent = state.dataErrors.recipes ? 'Jalankan migrasi schema terbaru; atau catat bahan secara manual.' : 'Produk ini belum memiliki resep. Masukkan bahan secara manual.';
    return;
  }
  state.recipeApplied = true;
  $('#add-usage').hidden = true;
  $('#usage-fields').innerHTML = '';
  const batchAmount = Number($('#production-amount').value) || 0;
  recipes.forEach((recipe) => {
    addUsageRow();
    const row = $('#usage-fields').lastElementChild;
    row.querySelector('.usage-material').value = recipe.bahan_baku_id;
    row.querySelector('.usage-material').disabled = true;
    row.querySelector('.usage-amount').value = String(recipe.jumlah_per_produk * batchAmount);
    row.querySelector('.usage-amount').readOnly = true;
  });
  $('#recipe-hint').textContent = `Takaran resep dikalikan ${quantity(batchAmount)} produk; stok dihitung otomatis oleh database.`;
}
function openModal(id) {
  $(id).classList.add('visible');
  if (id === '#production-modal') {
    if (!$('#usage-fields').children.length) addUsageRow();
    updateProductionRecipe();
  }
  if (id === '#sale-modal' && !$('#sale-fields').children.length) addSaleRow();
  if (id === '#recipe-modal') loadRecipeForm();
}
function closeModal(modal) { modal.classList.remove('visible'); const message = modal.querySelector('.form-message'); if (message) message.textContent = ''; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); setTimeout(() => toast.classList.remove('visible'), 3500); }
function showSettings() {
  $('#supabase-url').value = state.config.url;
  $('#supabase-key').value = state.config.key;
  $('#settings-form .form-message').textContent = '';
  openModal('#settings-modal');
}
function setMobileMenu(isOpen) {
  $('#sidebar').classList.toggle('sidebar-open', isOpen);
  $('#sidebar-backdrop').classList.toggle('visible', isOpen);
  $('#menu-toggle').setAttribute('aria-expanded', String(isOpen));
  $('#menu-toggle').setAttribute('aria-label', isOpen ? 'Tutup menu' : 'Buka menu');
  $('#menu-icon').textContent = isOpen ? '×' : '☰';
  document.body.classList.toggle('menu-open', isOpen);
}
function goToView(view) { document.querySelectorAll('.view').forEach((section) => section.classList.remove('active-view')); $(`#${view}-view`).classList.add('active-view'); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view)); const titles = { dashboard: ['Ringkasan usaha', 'Sistem Akuntansi Bakely'], bahan: ['Master data', 'Bahan baku'], produk: ['Master data', 'Barang jadi'], resep: ['Dapur', 'Resep produk'], pemakaian: ['Transaksi', 'Pemakaian bahan baku'], produksi: ['Transaksi', 'Produksi'], penjualan: ['Transaksi', 'Penjualan'], laporan: ['Analisis usaha', 'Laporan bakery'] }; $('#page-kicker').textContent = titles[view][0]; $('#page-title').textContent = titles[view][1]; }

$('#menu-toggle').addEventListener('click', () => setMobileMenu(!$('#sidebar').classList.contains('sidebar-open')));
$('#sidebar-backdrop').addEventListener('click', () => setMobileMenu(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMobileMenu(false); });
document.querySelectorAll('.nav-item, [data-view-link]').forEach((button) => button.addEventListener('click', () => { goToView(button.dataset.view || button.dataset.viewLink); setMobileMenu(false); }));
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openModal(`#${button.dataset.open}`)));
$('#export-sales').addEventListener('click', exportSalesCsv);
$('#export-production').addEventListener('click', exportProductionCsv);
$('#export-inventory').addEventListener('click', exportInventoryCsv);
$('#apply-report-filters').addEventListener('click', renderReports);
$('#report-search').addEventListener('input', renderReports);
$('#clear-report-filters').addEventListener('click', () => {
  const now = new Date();
  $('#report-start').value = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  $('#report-end').value = localDateKey(now);
  $('#report-search').value = '';
  renderReports();
});
document.querySelectorAll('.modal-backdrop').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal || event.target.matches('[data-close-modal]')) closeModal(modal); }));
document.addEventListener('click', async (event) => { const materialId = event.target.dataset.deleteMaterial; const productId = event.target.dataset.deleteProduct; const restockId = event.target.dataset.restockMaterial; const cancelSaleId = event.target.dataset.cancelSale; const recipeProductId = event.target.dataset.editRecipe; if (event.target.classList.contains('remove-row')) event.target.closest('.dynamic-row').remove(); if (materialId && confirm('Hapus bahan baku ini?')) { try { await api(`bahan_baku?id=eq.${materialId}`, { method: 'DELETE' }); await loadData(); } catch (error) { showToast(error.message); } } if (productId && confirm('Hapus produk ini?')) { try { await api(`produk?id=eq.${productId}`, { method: 'DELETE' }); await loadData(); } catch (error) { showToast(error.message); } } if (restockId) { const material = state.materials.find((item) => item.id === restockId); if (material) { $('#restock-material-id').value = material.id; $('#restock-material-name').textContent = material.nama; $('#restock-amount').value = ''; $('#restock-note').value = ''; openModal('#restock-modal'); } } if (cancelSaleId && confirm('Batalkan transaksi ini? Stok produk akan dikembalikan dan mutasi tercatat.')) { try { await rpc('batal_penjualan', { p_penjualan_id: cancelSaleId }); await loadData(); showToast('Penjualan dibatalkan dan stok dikembalikan.'); } catch (error) { showToast(error.message); } } if (recipeProductId) { loadRecipeForm(recipeProductId); openModal('#recipe-modal'); } if (event.target.dataset.editMaterial) { const item = state.materials.find((material) => material.id === event.target.dataset.editMaterial); if (item) { $('#material-id').value = item.id; $('#material-name').value = item.nama; $('#material-unit').value = item.satuan; $('#material-stock').value = item.stok; $('#material-minimum').value = item.stok_minimum; $('#material-price').value = item.harga_satuan; $('#material-modal-title').textContent = 'Edit bahan baku'; openModal('#material-modal'); } } });
document.addEventListener('click', (event) => { const id = event.target.dataset.editProduct; if (!id) return; const item = state.products.find((product) => product.id === id); if (!item) return; $('#product-id').value = item.id; $('#product-code').value = item.kode_produk || ''; $('#product-name').value = item.nama; $('#product-price').value = item.harga_jual; $('#product-stock').value = item.stok; $('#product-unit').value = item.satuan; $('#product-modal-title').textContent = 'Edit barang jadi'; openModal('#product-modal'); });
document.addEventListener('click', async (event) => {
  const id = event.target.dataset.saleDetail;
  if (!id) return;
  const sale = state.salesReport.find((item) => item.id === id);
  if (!sale) return;
  try {
    const details = await api(`detail_penjualan?select=*,produk(nama)&penjualan_id=eq.${id}`);
    $('#detail-sale-number').textContent = sale.nomor_nota;
    $('#detail-sale-meta').textContent = `${sale.pelanggan} · ${dateId(sale.tanggal)} · ${sale.status}`;
    $('#detail-sale-total').textContent = rupiah(sale.total);
    $('#sale-detail-table').innerHTML = details.length ? details.map((item) => `<tr><td>${escapeHtml(item.produk?.nama || '-')}</td><td>${quantity(item.jumlah)}</td><td>${rupiah(item.harga_satuan)}</td><td class="align-right">${rupiah(item.subtotal)}</td></tr>`).join('') : emptyRow(4, 'Detail belum tersedia.');
    openModal('#sale-detail-modal');
  } catch (error) { showToast(error.message); }
});
$('#add-usage').addEventListener('click', addUsageRow);
$('#add-sale-item').addEventListener('click', addSaleRow);
$('#add-recipe-item').addEventListener('click', addRecipeRow);
$('#production-product').addEventListener('change', updateProductionRecipe);
$('#production-amount').addEventListener('input', updateProductionRecipe);
$('#recipe-product').addEventListener('change', () => loadRecipeForm($('#recipe-product').value));
$('#report-start').addEventListener('change', renderReports);
$('#report-end').addEventListener('change', renderReports);
$('#material-modal form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = $('#material-id').value;
  const payload = { nama: $('#material-name').value, satuan: $('#material-unit').value, stok: Number($('#material-stock').value), stok_minimum: Number($('#material-minimum').value), harga_satuan: Number($('#material-price').value) };
  try {
    await api(id ? `bahan_baku?id=eq.${id}` : 'bahan_baku', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    closeModal($('#material-modal')); form.reset(); $('#material-id').value = ''; $('#material-modal-title').textContent = 'Tambah bahan baku';
    await loadData(); showToast(id ? 'Bahan baku diperbarui; perubahan stok tercatat.' : 'Bahan baku disimpan.');
  } catch (error) { form.querySelector('.form-message').textContent = error.message; }
});
$('#restock-modal form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await rpc('tambah_stok_bahan', {
      p_bahan_baku_id: $('#restock-material-id').value,
      p_jumlah: Number($('#restock-amount').value),
      p_catatan: $('#restock-note').value.trim() || null
    });
    closeModal($('#restock-modal'));
    form.reset();
    await loadData();
    showToast('Stok masuk tercatat pada riwayat mutasi.');
  } catch (error) { form.querySelector('.form-message').textContent = error.message; }
});
$('#product-modal form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = $('#product-id').value;
  const payload = { kode_produk: $('#product-code').value, nama: $('#product-name').value, harga_jual: Number($('#product-price').value), stok: Number($('#product-stock').value), satuan: $('#product-unit').value, aktif: true };
  try {
    await api(id ? `produk?id=eq.${id}` : 'produk', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    closeModal($('#product-modal')); form.reset(); $('#product-id').value = ''; $('#product-modal-title').textContent = 'Tambah barang jadi';
    await loadData(); showToast('Produk disimpan.');
  } catch (error) { form.querySelector('.form-message').textContent = error.message; }
});
$('#production-modal form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const rows = [...document.querySelectorAll('#usage-fields .dynamic-row')];
  const usage = rows.map((row) => ({ bahan_baku_id: row.querySelector('.usage-material').value, jumlah: Number(row.querySelector('.usage-amount').value) }));
  try {
    if (!state.recipeApplied && (!usage.length || usage.some((item) => !item.bahan_baku_id || !Number.isFinite(item.jumlah) || item.jumlah <= 0))) throw new Error('Isi bahan dan jumlah pemakaian pada setiap baris.');
    const result = await rpc('catat_produksi', {
      p_nomor_produksi: $('#production-number').value,
      p_produk_id: $('#production-product').value,
      p_jumlah: Number($('#production-amount').value),
      p_catatan: $('#production-note').value || null,
      p_pemakaian: usage,
      p_biaya_tenaga_kerja: Number($('#production-labor').value || 0),
      p_biaya_overhead: Number($('#production-overhead').value || 0)
    });
    closeModal($('#production-modal')); form.reset(); $('#usage-fields').innerHTML = ''; state.recipeApplied = false;
    await loadData(); showToast(`Produksi dicatat. HPP/unit ${rupiah(result.hpp_per_unit)}; stok bahan diperbarui.`);
  } catch (error) { form.querySelector('.form-message').textContent = error.message; }
});
$('#sale-modal form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const rows = [...document.querySelectorAll('#sale-fields .dynamic-row')];
  const items = rows.map((row) => ({ produk_id: row.querySelector('.sale-product').value, jumlah: Number(row.querySelector('.sale-amount').value) }));
  try {
    if (!items.length || items.some((item) => !item.produk_id || !Number.isFinite(item.jumlah) || item.jumlah <= 0)) throw new Error('Isi produk dan jumlah pada setiap baris penjualan.');
    const total = items.reduce((sum, item) => sum + Number(state.products.find((product) => product.id === item.produk_id)?.harga_jual || 0) * item.jumlah, 0);
    await rpc('catat_penjualan', { p_nomor_nota: $('#sale-number').value.trim(), p_pelanggan: $('#sale-customer').value.trim(), p_items: items });
    closeModal($('#sale-modal')); form.reset(); $('#sale-fields').innerHTML = '';
    await loadData(); showToast(`Penjualan dicatat sebesar ${rupiah(total)}; stok barang jadi berkurang.`);
  } catch (error) { form.querySelector('.form-message').textContent = error.message; }
});
$('#recipe-modal form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const rows = [...document.querySelectorAll('#recipe-fields .dynamic-row')];
  const ingredients = rows.map((row) => ({ bahan_baku_id: row.querySelector('.recipe-material').value, jumlah_per_produk: Number(row.querySelector('.recipe-amount').value) }));
  try {
    if (!ingredients.length || ingredients.some((item) => !item.bahan_baku_id || !Number.isFinite(item.jumlah_per_produk) || item.jumlah_per_produk <= 0)) throw new Error('Isi bahan dan jumlah per produk pada setiap baris.');
    if (new Set(ingredients.map((item) => item.bahan_baku_id)).size !== ingredients.length) throw new Error('Setiap bahan hanya boleh muncul satu kali dalam resep.');
    await rpc('set_resep_produk', { p_produk_id: $('#recipe-product').value, p_bahan: ingredients });
    closeModal($('#recipe-modal')); await loadData(); showToast('Resep disimpan. Produksi selanjutnya akan memakai takaran ini.');
  } catch (error) { form.querySelector('.form-message').textContent = error.message; }
});
$('#settings-button').addEventListener('click', showSettings);
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const url = $('#supabase-url').value.trim().replace(/\/+$/, '');
  const key = $('#supabase-key').value.trim();
  const submitButton = form.querySelector('[type="submit"]');
  const previousConnectionLabel = $('#connection-label').textContent;
  const previousStatusColor = $('.status-dot').style.background;
  submitButton.disabled = true;
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('URL Supabase harus menggunakan HTTP atau HTTPS.');
    if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) throw new Error('Masukkan Project URL saja, tanpa /rest/v1, path, atau query.');
    if (!key) throw new Error('Masukkan publishable key atau anon key Supabase.');
    const config = { url, key };
    $('#connection-label').textContent = 'Menguji koneksi...';
    await testConnection(config);
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    state.config = config;
    closeModal($('#settings-modal'));
    $('#connection-label').textContent = 'Menghubungkan...';
    await loadData();
    if ($('#connection-label').textContent === 'Supabase terhubung') showToast('Supabase berhasil terhubung.');
  } catch (error) {
    $('#connection-label').textContent = state.config.url && state.config.key ? previousConnectionLabel : 'Koneksi gagal';
    $('.status-dot').style.background = state.config.url && state.config.key ? previousStatusColor : '#c86e7b';
    form.querySelector('.form-message').textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
$('#today').textContent = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date()); loadData();