-- Run once in the Supabase SQL Editor after restoring the paused project.
-- This migration is additive and preserves existing bakery data.
begin;

alter table public.produk add column if not exists hpp_per_unit numeric(14,2);
alter table public.detail_penjualan add column if not exists hpp_satuan numeric(14,2) check (hpp_satuan is null or hpp_satuan >= 0);
alter table public.produksi add column if not exists biaya_bahan_baku numeric(14,2);
alter table public.produksi add column if not exists biaya_tenaga_kerja numeric(14,2);
alter table public.produksi add column if not exists biaya_overhead numeric(14,2);
alter table public.produksi add column if not exists hpp_per_unit numeric(14,2);

create table if not exists public.resep_produk (
  id uuid primary key default gen_random_uuid(),
  produk_id uuid not null references public.produk(id) on delete cascade,
  bahan_baku_id uuid not null references public.bahan_baku(id) on delete cascade,
  jumlah_per_produk numeric(12,4) not null check (jumlah_per_produk > 0),
  created_at timestamptz not null default now(),
  unique (produk_id, bahan_baku_id)
);

alter table public.resep_produk enable row level security;
drop policy if exists "public read resep produk" on public.resep_produk;
create policy "public read resep produk" on public.resep_produk for select to anon using (true);
revoke all on table public.resep_produk from public, anon, authenticated;
grant select on table public.resep_produk to anon;

alter table public.mutasi_stok drop constraint if exists mutasi_stok_tipe_check;
alter table public.mutasi_stok add constraint mutasi_stok_tipe_check
  check (tipe in ('produksi', 'penjualan', 'koreksi', 'pemakaian_bb', 'pembatalan', 'pembelian'));

drop function if exists public.catat_produksi(text, uuid, numeric, text, jsonb);
create function public.catat_produksi(
  p_nomor_produksi text,
  p_produk_id uuid,
  p_jumlah numeric,
  p_catatan text default null,
  p_pemakaian jsonb default '[]'::jsonb,
  p_biaya_tenaga_kerja numeric default 0,
  p_biaya_overhead numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  production_id uuid;
  recipe_item record;
  usage_item jsonb;
  material_id uuid;
  usage_amount numeric;
  unit_cost numeric;
  material_cost numeric := 0;
  production_hpp numeric;
  recipe_count integer;
begin
  if nullif(trim(p_nomor_produksi), '') is null or p_jumlah is null or p_jumlah <= 0
     or p_biaya_tenaga_kerja is null or p_biaya_tenaga_kerja < 0
     or p_biaya_overhead is null or p_biaya_overhead < 0 then
    raise exception 'Nomor dan jumlah produksi wajib diisi';
  end if;
  select count(*) into recipe_count from resep_produk where produk_id = p_produk_id;
  if recipe_count = 0 and (p_pemakaian is null or jsonb_typeof(p_pemakaian) <> 'array' or jsonb_array_length(p_pemakaian) = 0) then
    raise exception 'Minimal satu bahan baku harus dicatat';
  end if;
  insert into produksi (nomor_produksi, produk_id, jumlah, catatan, biaya_tenaga_kerja, biaya_overhead)
  values (p_nomor_produksi, p_produk_id, p_jumlah, p_catatan, p_biaya_tenaga_kerja, p_biaya_overhead)
  returning id into production_id;

  perform set_config('bakely.stock_movement_type', 'produksi', true);
  perform set_config('bakely.stock_reference_id', production_id::text, true);
  perform set_config('bakely.stock_note', 'Penambahan stok dari produksi', true);
  update produk set stok = stok + p_jumlah where id = p_produk_id;
  if not found then raise exception 'Produk tidak ditemukan'; end if;

  if recipe_count > 0 then
    for recipe_item in select bahan_baku_id, jumlah_per_produk from resep_produk where produk_id = p_produk_id loop
      material_id := recipe_item.bahan_baku_id;
      usage_amount := recipe_item.jumlah_per_produk * p_jumlah;
      perform set_config('bakely.stock_movement_type', 'pemakaian_bb', true);
      perform set_config('bakely.stock_reference_id', production_id::text, true);
      perform set_config('bakely.stock_note', 'Pemakaian bahan sesuai resep', true);
      update bahan_baku set stok = stok - usage_amount
      where id = material_id and stok >= usage_amount
      returning harga_satuan into unit_cost;
      if not found then raise exception 'Stok bahan baku tidak mencukupi'; end if;
      material_cost := material_cost + usage_amount * unit_cost;
      insert into pemakaian_bb (produksi_id, bahan_baku_id, jumlah) values (production_id, material_id, usage_amount);
    end loop;
  else
    for usage_item in select * from jsonb_array_elements(p_pemakaian) loop
      material_id := (usage_item->>'bahan_baku_id')::uuid;
      usage_amount := (usage_item->>'jumlah')::numeric;
      if usage_amount <= 0 then raise exception 'Jumlah bahan harus lebih dari nol'; end if;
      perform set_config('bakely.stock_movement_type', 'pemakaian_bb', true);
      perform set_config('bakely.stock_reference_id', production_id::text, true);
      perform set_config('bakely.stock_note', 'Pemakaian bahan pada produksi', true);
      update bahan_baku set stok = stok - usage_amount
      where id = material_id and stok >= usage_amount
      returning harga_satuan into unit_cost;
      if not found then raise exception 'Stok bahan baku tidak mencukupi'; end if;
      material_cost := material_cost + usage_amount * unit_cost;
      insert into pemakaian_bb (produksi_id, bahan_baku_id, jumlah) values (production_id, material_id, usage_amount);
    end loop;
  end if;

  production_hpp := (material_cost + p_biaya_tenaga_kerja + p_biaya_overhead) / p_jumlah;
  update produksi set biaya_bahan_baku = material_cost, hpp_per_unit = production_hpp where id = production_id;
  update produk set hpp_per_unit = case
    when hpp_per_unit is null then production_hpp
    when stok <= p_jumlah then production_hpp
    else ((hpp_per_unit * (stok - p_jumlah)) + (production_hpp * p_jumlah)) / stok
  end where id = p_produk_id;
  return jsonb_build_object('id', production_id, 'biaya_bahan_baku', material_cost, 'hpp_per_unit', production_hpp);
end;
$$;

create or replace function public.set_resep_produk(p_produk_id uuid, p_bahan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  recipe_item jsonb;
  item_amount numeric;
begin
  if not exists (select 1 from produk where id = p_produk_id) then raise exception 'Produk tidak ditemukan'; end if;
  if p_bahan is null or jsonb_typeof(p_bahan) <> 'array' or jsonb_array_length(p_bahan) = 0 then
    raise exception 'Resep minimal berisi satu bahan baku';
  end if;
  delete from resep_produk where produk_id = p_produk_id;
  for recipe_item in select * from jsonb_array_elements(p_bahan) loop
    item_amount := (recipe_item->>'jumlah_per_produk')::numeric;
    if item_amount <= 0 then raise exception 'Jumlah bahan per produk harus lebih dari nol'; end if;
    insert into resep_produk (produk_id, bahan_baku_id, jumlah_per_produk)
    values (p_produk_id, (recipe_item->>'bahan_baku_id')::uuid, item_amount);
  end loop;
  return jsonb_build_object('produk_id', p_produk_id);
end;
$$;

create or replace function public.tambah_stok_bahan(p_bahan_baku_id uuid, p_jumlah numeric, p_catatan text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_jumlah is null or p_jumlah <= 0 then raise exception 'Jumlah stok masuk harus lebih dari nol'; end if;
  perform set_config('bakely.stock_movement_type', 'pembelian', true);
  perform set_config('bakely.stock_note', coalesce(nullif(trim(p_catatan), ''), 'Stok bahan baku masuk'), true);
  update bahan_baku set stok = stok + p_jumlah where id = p_bahan_baku_id;
  if not found then raise exception 'Bahan baku tidak ditemukan'; end if;
  return jsonb_build_object('id', p_bahan_baku_id);
end;
$$;

create or replace function public.catat_penjualan(
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
  item_hpp numeric;
begin
  if p_status not in ('lunas', 'piutang') then raise exception 'Status pembayaran tidak valid'; end if;
  if nullif(trim(p_nomor_nota), '') is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nomor nota dan minimal satu barang wajib diisi';
  end if;
  insert into penjualan (nomor_nota, pelanggan, total, status)
  values (p_nomor_nota, coalesce(nullif(trim(p_pelanggan), ''), 'Umum'), 0, p_status) returning id into sale_id;
  for item in select * from jsonb_array_elements(p_items) loop
    product_id := (item->>'produk_id')::uuid;
    item_amount := (item->>'jumlah')::numeric;
    if item_amount <= 0 then raise exception 'Jumlah barang harus lebih dari nol'; end if;
    select harga_jual, hpp_per_unit into item_price, item_hpp
    from produk where id = product_id and stok >= item_amount for update;
    if not found then raise exception 'Stok barang jadi tidak mencukupi'; end if;
    perform set_config('bakely.stock_movement_type', 'penjualan', true);
    perform set_config('bakely.stock_reference_id', sale_id::text, true);
    perform set_config('bakely.stock_note', 'Pengurangan stok dari penjualan', true);
    update produk set stok = stok - item_amount where id = product_id;
    sale_total := sale_total + item_amount * item_price;
    insert into detail_penjualan (penjualan_id, produk_id, jumlah, harga_satuan, hpp_satuan)
    values (sale_id, product_id, item_amount, item_price, item_hpp);
  end loop;
  update penjualan set total = sale_total where id = sale_id;
  return jsonb_build_object('id', sale_id, 'total', sale_total);
end;
$$;

create or replace function public.batal_penjualan(p_penjualan_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sale_record record;
  sale_item record;
begin
  select id, status into sale_record from penjualan where id = p_penjualan_id for update;
  if not found then raise exception 'Transaksi penjualan tidak ditemukan'; end if;
  if sale_record.status = 'batal' then raise exception 'Transaksi sudah dibatalkan'; end if;
  perform set_config('bakely.stock_movement_type', 'pembatalan', true);
  perform set_config('bakely.stock_reference_id', p_penjualan_id::text, true);
  for sale_item in select produk_id, jumlah from detail_penjualan where penjualan_id = p_penjualan_id loop
    perform set_config('bakely.stock_note', 'Pengembalian stok dari pembatalan penjualan', true);
    update produk set stok = stok + sale_item.jumlah where id = sale_item.produk_id;
  end loop;
  update penjualan set status = 'batal' where id = p_penjualan_id;
  return jsonb_build_object('id', p_penjualan_id, 'status', 'batal');
end;
$$;

revoke all on function public.catat_produksi(text, uuid, numeric, text, jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.set_resep_produk(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tambah_stok_bahan(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.catat_penjualan(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.batal_penjualan(uuid) from public, anon, authenticated;
grant execute on function public.catat_produksi(text, uuid, numeric, text, jsonb, numeric, numeric) to anon;
grant execute on function public.set_resep_produk(uuid, jsonb) to anon;
grant execute on function public.tambah_stok_bahan(uuid, numeric, text) to anon;
grant execute on function public.catat_penjualan(text, text, jsonb, text) to anon;
grant execute on function public.batal_penjualan(uuid) to anon;

commit;
