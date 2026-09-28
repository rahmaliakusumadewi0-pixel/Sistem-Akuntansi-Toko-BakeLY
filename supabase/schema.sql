-- Jalankan seluruh file ini di Supabase SQL Editor.
create extension if not exists "pgcrypto";

create table if not exists bahan_baku (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  satuan text not null default 'kg',
  stok numeric(12,2) not null default 0 check (stok >= 0),
  stok_minimum numeric(12,2) not null default 0 check (stok_minimum >= 0),
  harga_satuan numeric(14,2) not null default 0 check (harga_satuan >= 0),
  created_at timestamptz not null default now()
);

create table if not exists produk (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  kode_produk text not null default '',
  harga_jual numeric(14,2) not null default 0 check (harga_jual >= 0),
  stok numeric(12,2) not null default 0 check (stok >= 0),
  satuan text not null default 'pcs',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

alter table produk add column if not exists kode_produk text not null default '';
alter table produk add column if not exists stok numeric(12,2) not null default 0 check (stok >= 0);
alter table produk add column if not exists satuan text not null default 'pcs';

create table if not exists penjualan (
  id uuid primary key default gen_random_uuid(),
  nomor_nota text not null unique,
  tanggal timestamptz not null default now(),
  pelanggan text not null default 'Umum',
  total numeric(14,2) not null default 0 check (total >= 0),
  status text not null default 'lunas' check (status in ('lunas', 'piutang', 'batal')),
  created_at timestamptz not null default now()
);

create table if not exists detail_penjualan (
  id uuid primary key default gen_random_uuid(),
  penjualan_id uuid not null references penjualan(id) on delete cascade,
  produk_id uuid not null references produk(id),
  jumlah numeric(12,2) not null check (jumlah > 0),
  harga_satuan numeric(14,2) not null check (harga_satuan >= 0),
  subtotal numeric(14,2) generated always as (jumlah * harga_satuan) stored
);

create table if not exists produksi (
  id uuid primary key default gen_random_uuid(),
  nomor_produksi text not null unique,
  produk_id uuid not null references produk(id),
  jumlah numeric(12,2) not null check (jumlah > 0),
  tanggal timestamptz not null default now(),
  catatan text,
  created_at timestamptz not null default now()
);

alter table produksi add column if not exists nomor_produksi text;
alter table produksi add column if not exists produk_id uuid;
alter table produksi add column if not exists jumlah numeric(12,2);
alter table produksi add column if not exists tanggal timestamptz default now();
alter table produksi add column if not exists catatan text;
alter table produksi add column if not exists created_at timestamptz default now();

create unique index if not exists produksi_nomor_produksi_idx on produksi (nomor_produksi);

create table if not exists pemakaian_bb (
  id uuid primary key default gen_random_uuid(),
  produksi_id uuid not null references produksi(id) on delete cascade,
  bahan_baku_id uuid not null references bahan_baku(id),
  jumlah numeric(12,2) not null check (jumlah > 0),
  created_at timestamptz not null default now()
);

create table if not exists mutasi_stok (
  id uuid primary key default gen_random_uuid(),
  tipe text not null check (tipe in ('produksi', 'penjualan', 'koreksi', 'pemakaian_bb')),
  bahan_baku_id uuid references bahan_baku(id),
  produk_id uuid references produk(id),
  jumlah numeric(12,2) not null,
  stok_sebelum numeric(12,2) not null,
  stok_sesudah numeric(12,2) not null,
  referensi_id uuid,
  catatan text,
  created_at timestamptz not null default now(),
  check ((bahan_baku_id is not null) <> (produk_id is not null))
);

alter table bahan_baku enable row level security;
alter table produk enable row level security;
alter table penjualan enable row level security;
alter table detail_penjualan enable row level security;
alter table produksi enable row level security;
alter table pemakaian_bb enable row level security;
alter table mutasi_stok enable row level security;

drop policy if exists "public read bahan baku" on bahan_baku;
drop policy if exists "public read produk" on produk;
drop policy if exists "public read penjualan" on penjualan;
drop policy if exists "public read detail penjualan" on detail_penjualan;
drop policy if exists "public read produksi" on produksi;
drop policy if exists "public read pemakaian bb" on pemakaian_bb;
drop policy if exists "public read mutasi stok" on mutasi_stok;
drop policy if exists "public insert bahan baku" on bahan_baku;
drop policy if exists "public insert penjualan" on penjualan;
drop policy if exists "public insert produk" on produk;
drop policy if exists "public update bahan baku" on bahan_baku;
drop policy if exists "public delete bahan baku" on bahan_baku;
drop policy if exists "public update produk" on produk;
drop policy if exists "public delete produk" on produk;
drop policy if exists "app access bahan baku" on bahan_baku;
drop policy if exists "app access produk" on produk;
drop policy if exists "app read penjualan" on penjualan;
drop policy if exists "app read detail penjualan" on detail_penjualan;
drop policy if exists "app read produksi" on produksi;
drop policy if exists "app read pemakaian bb" on pemakaian_bb;
drop policy if exists "app read mutasi stok" on mutasi_stok;
do $$
declare
  old_policy record;
begin
  for old_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array['bahan_baku', 'produk', 'penjualan', 'detail_penjualan', 'produksi', 'pemakaian_bb', 'mutasi_stok'])
  loop
    execute format('drop policy if exists %I on %I.%I', old_policy.policyname, old_policy.schemaname, old_policy.tablename);
  end loop;
end;
$$;
drop function if exists app_access_check();
drop function if exists is_app_user();
drop table if exists app_user_access;
create policy "public access bahan baku" on bahan_baku for all to anon using (true) with check (true);
create policy "public access produk" on produk for all to anon using (true) with check (true);
create policy "public read penjualan" on penjualan for select to anon using (true);
create policy "public read detail penjualan" on detail_penjualan for select to anon using (true);
create policy "public read produksi" on produksi for select to anon using (true);
create policy "public read pemakaian bb" on pemakaian_bb for select to anon using (true);
create policy "public read mutasi stok" on mutasi_stok for select to anon using (true);

revoke all on table bahan_baku, produk, penjualan, detail_penjualan, produksi, pemakaian_bb, mutasi_stok from public, anon, authenticated;
grant select, insert, update, delete on table bahan_baku, produk to anon;
grant select on table penjualan, detail_penjualan, produksi, pemakaian_bb, mutasi_stok to anon;

create or replace function log_mutasi_bahan_baku() returns trigger language plpgsql security definer set search_path = public as $$
declare
  movement_type text := coalesce(nullif(current_setting('bakely.stock_movement_type', true), ''), 'koreksi');
  reference_id uuid := nullif(current_setting('bakely.stock_reference_id', true), '')::uuid;
  movement_note text := coalesce(nullif(current_setting('bakely.stock_note', true), ''), 'Perubahan stok manual');
begin
  if new.stok <> old.stok then
    insert into mutasi_stok (tipe, bahan_baku_id, jumlah, stok_sebelum, stok_sesudah, referensi_id, catatan)
    values (movement_type, new.id, new.stok - old.stok, old.stok, new.stok, reference_id, movement_note);
  end if;
  return new;
end;
$$;

create or replace function log_mutasi_produk() returns trigger language plpgsql security definer set search_path = public as $$
declare
  movement_type text := coalesce(nullif(current_setting('bakely.stock_movement_type', true), ''), 'koreksi');
  reference_id uuid := nullif(current_setting('bakely.stock_reference_id', true), '')::uuid;
  movement_note text := coalesce(nullif(current_setting('bakely.stock_note', true), ''), 'Perubahan stok manual');
begin
  if new.stok <> old.stok then
    insert into mutasi_stok (tipe, produk_id, jumlah, stok_sebelum, stok_sesudah, referensi_id, catatan)
    values (movement_type, new.id, new.stok - old.stok, old.stok, new.stok, reference_id, movement_note);
  end if;
  return new;
end;
$$;

drop trigger if exists bahan_baku_stock_audit on bahan_baku;
drop trigger if exists produk_stock_audit on produk;
create trigger bahan_baku_stock_audit after update of stok on bahan_baku for each row execute function log_mutasi_bahan_baku();
create trigger produk_stock_audit after update of stok on produk for each row execute function log_mutasi_produk();

create or replace function catat_produksi(
  p_nomor_produksi text,
  p_produk_id uuid,
  p_jumlah numeric,
  p_catatan text default null,
  p_pemakaian jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  production_id uuid;
  usage_item jsonb;
  material_id uuid;
  usage_amount numeric;
begin
  if nullif(trim(p_nomor_produksi), '') is null or p_jumlah <= 0 then
    raise exception 'Nomor dan jumlah produksi wajib diisi';
  end if;
  if p_pemakaian is null or jsonb_array_length(p_pemakaian) = 0 then
    raise exception 'Minimal satu bahan baku harus dicatat';
  end if;
  insert into produksi (nomor_produksi, produk_id, jumlah, catatan)
  values (p_nomor_produksi, p_produk_id, p_jumlah, p_catatan)
  returning id into production_id;

  perform set_config('bakely.stock_movement_type', 'produksi', true);
  perform set_config('bakely.stock_reference_id', production_id::text, true);
  perform set_config('bakely.stock_note', 'Penambahan stok dari produksi', true);
  update produk set stok = stok + p_jumlah where id = p_produk_id;

  for usage_item in select * from jsonb_array_elements(p_pemakaian) loop
    material_id := (usage_item->>'bahan_baku_id')::uuid;
    usage_amount := (usage_item->>'jumlah')::numeric;
    perform set_config('bakely.stock_movement_type', 'pemakaian_bb', true);
    perform set_config('bakely.stock_note', 'Pemakaian bahan pada produksi', true);
    update bahan_baku set stok = stok - usage_amount
    where id = material_id and stok >= usage_amount;
    if not found then raise exception 'Stok bahan baku tidak mencukupi'; end if;
    insert into pemakaian_bb (produksi_id, bahan_baku_id, jumlah)
    values (production_id, material_id, usage_amount);
  end loop;
  return jsonb_build_object('id', production_id);
end;
$$;

create or replace function catat_penjualan(
  p_nomor_nota text,
  p_pelanggan text,
  p_items jsonb,
  p_status text default 'lunas'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sale_id uuid;
  sale_total numeric := 0;
  item jsonb;
  product_id uuid;
  item_amount numeric;
  item_price numeric;
begin
  if p_status not in ('lunas', 'piutang') then raise exception 'Status pembayaran tidak valid'; end if;
  if nullif(trim(p_nomor_nota), '') is null or p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Nomor nota dan minimal satu barang wajib diisi';
  end if;
  insert into penjualan (nomor_nota, pelanggan, total, status)
  values (p_nomor_nota, p_pelanggan, 0, p_status) returning id into sale_id;
  for item in select * from jsonb_array_elements(p_items) loop
    product_id := (item->>'produk_id')::uuid;
    item_amount := (item->>'jumlah')::numeric;
    select harga_jual into item_price from produk where id = product_id and stok >= item_amount;
    if not found then raise exception 'Stok barang jadi tidak mencukupi'; end if;
    perform set_config('bakely.stock_movement_type', 'penjualan', true);
    perform set_config('bakely.stock_reference_id', sale_id::text, true);
    perform set_config('bakely.stock_note', 'Pengurangan stok dari penjualan', true);
    update produk set stok = stok - item_amount where id = product_id;
    sale_total := sale_total + (item_amount * item_price);
    insert into detail_penjualan (penjualan_id, produk_id, jumlah, harga_satuan)
    values (sale_id, product_id, item_amount, item_price);
  end loop;
  update penjualan set total = sale_total where id = sale_id;
  return jsonb_build_object('id', sale_id, 'total', sale_total);
end;
$$;

drop function if exists catat_penjualan(text, text, jsonb);
revoke all on function catat_produksi(text, uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function catat_penjualan(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function catat_produksi(text, uuid, numeric, text, jsonb) to anon;
grant execute on function catat_penjualan(text, text, jsonb, text) to anon;

create or replace function ringkasan_produksi() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  select jsonb_build_object('total', coalesce(sum(jumlah), 0), 'count', count(*)) into result
  from public.produksi;
  return result;
end;
$$;
revoke all on function ringkasan_produksi() from public, anon;
grant execute on function ringkasan_produksi() to anon;

create or replace function ringkasan_penjualan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  select jsonb_build_object('total', coalesce(sum(total), 0), 'count', count(*)) into result
  from public.penjualan where status <> 'batal';
  return result;
end;
$$;
revoke all on function ringkasan_penjualan() from public, anon;
grant execute on function ringkasan_penjualan() to anon;

-- Data awal demo bakery. Aman dijalankan ulang karena memakai id tetap.
insert into bahan_baku (id, nama, satuan, stok, stok_minimum, harga_satuan) values
  ('10000000-0000-0000-0000-000000000001', 'Tepung terigu protein tinggi', 'kg', 34, 15, 14500),
  ('10000000-0000-0000-0000-000000000002', 'Gula pasir', 'kg', 16, 8, 16500),
  ('10000000-0000-0000-0000-000000000003', 'Mentega premium', 'kg', 5, 5, 42000),
  ('10000000-0000-0000-0000-000000000004', 'Telur ayam', 'kg', 11, 8, 28000),
  ('10000000-0000-0000-0000-000000000005', 'Susu bubuk', 'kg', 3.5, 5, 78000),
  ('10000000-0000-0000-0000-000000000006', 'Cokelat compound', 'kg', 6, 3, 69000),
  ('10000000-0000-0000-0000-000000000007', 'Ragi instan', 'kg', 1.8, 2, 58000),
  ('10000000-0000-0000-0000-000000000008', 'Keju cheddar', 'kg', 3, 2, 91000)
on conflict (id) do nothing;

insert into produk (id, kode_produk, nama, harga_jual, stok, satuan, aktif) values
  ('20000000-0000-0000-0000-000000000001', 'CR-001', 'Croissant butter', 18000, 10, 'pcs', true),
  ('20000000-0000-0000-0000-000000000002', 'RS-001', 'Roti sobek cokelat', 22000, 21, 'pcs', true),
  ('20000000-0000-0000-0000-000000000003', 'CR-002', 'Cinnamon roll', 24000, 15, 'pcs', true),
  ('20000000-0000-0000-0000-000000000004', 'DN-001', 'Donat gula', 12000, 32, 'pcs', true),
  ('20000000-0000-0000-0000-000000000005', 'BB-001', 'Banana bread slice', 16000, 17, 'pcs', true),
  ('20000000-0000-0000-0000-000000000006', 'KC-001', 'Kue cokelat mini', 28000, 5, 'pcs', true)
on conflict (id) do update set
  kode_produk = excluded.kode_produk,
  nama = excluded.nama,
  harga_jual = excluded.harga_jual,
  stok = excluded.stok,
  satuan = excluded.satuan,
  aktif = excluded.aktif;

insert into produksi (id, nomor_produksi, produk_id, jumlah, tanggal, catatan) values
  ('40000000-0000-0000-0000-000000000001', 'PROD-260924-001', '20000000-0000-0000-0000-000000000002', 30, now() - interval '3 hours', 'Produksi pagi'),
  ('40000000-0000-0000-0000-000000000002', 'PROD-260924-002', '20000000-0000-0000-0000-000000000001', 24, now() - interval '6 hours', 'Batch pagi ke-2'),
  ('40000000-0000-0000-0000-000000000003', 'PROD-260923-015', '20000000-0000-0000-0000-000000000003', 18, now() - interval '1 day', 'Cinnamon roll hari sebelumnya'),
  ('40000000-0000-0000-0000-000000000004', 'PROD-260923-014', '20000000-0000-0000-0000-000000000004', 26, now() - interval '1 day 8 hours', 'Donat for market')
on conflict (id) do nothing;

insert into pemakaian_bb (id, produksi_id, bahan_baku_id, jumlah) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 8),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 2),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 1),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 0.2),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 0.5),
  ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 1),

  ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 6.5),
  ('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1.7),
  ('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 0.9),
  ('50000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 1.2),
  ('50000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 0.4),

  ('50000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 5),
  ('50000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 1.8),
  ('50000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 1.1),
  ('50000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006', 0.9),

  ('50000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 6.8),
  ('50000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 2.4),
  ('50000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 2.1),
  ('50000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000007', 0.3)
on conflict (id) do nothing;

insert into penjualan (id, nomor_nota, tanggal, pelanggan, total, status) values
  ('30000000-0000-0000-0000-000000000001', 'INV-260924-001', now() - interval '35 minutes', 'Nadia', 84000, 'lunas'),
  ('30000000-0000-0000-0000-000000000002', 'INV-260924-002', now() - interval '2 hours', 'Kantor Arunika', 156000, 'lunas'),
  ('30000000-0000-0000-0000-000000000003', 'INV-260923-014', now() - interval '1 day', 'Budi', 72000, 'lunas'),
  ('30000000-0000-0000-0000-000000000004', 'INV-260923-013', now() - interval '1 day 3 hours', 'Umum', 108000, 'lunas'),
  ('30000000-0000-0000-0000-000000000005', 'INV-260922-011', now() - interval '2 days', 'Kopi Senja', 224000, 'piutang')
on conflict (id) do nothing;

insert into detail_penjualan (penjualan_id, produk_id, jumlah, harga_satuan)
select sales.id, products.id, items.jumlah, products.harga_jual
from (values
  ('30000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid, 2::numeric),
  ('30000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000004'::uuid, 4::numeric),
  ('30000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000002'::uuid, 4::numeric),
  ('30000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000003'::uuid, 2::numeric),
  ('30000000-0000-0000-0000-000000000003'::uuid, '20000000-0000-0000-0000-000000000003'::uuid, 3::numeric),
  ('30000000-0000-0000-0000-000000000004'::uuid, '20000000-0000-0000-0000-000000000005'::uuid, 3::numeric),
  ('30000000-0000-0000-0000-000000000004'::uuid, '20000000-0000-0000-0000-000000000006'::uuid, 3::numeric),
  ('30000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000006'::uuid, 8::numeric)
) as items(penjualan_id, produk_id, jumlah)
join penjualan sales on sales.id = items.penjualan_id
join produk products on products.id = items.produk_id
where not exists (
  select 1 from detail_penjualan existing
  where existing.penjualan_id = items.penjualan_id and existing.produk_id = items.produk_id
);