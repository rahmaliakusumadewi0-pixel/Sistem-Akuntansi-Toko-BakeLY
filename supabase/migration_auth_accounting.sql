-- Jalankan sekali di Supabase SQL Editor untuk project yang sudah berisi data.
-- Setelah membuat user di Authentication > Users, tambahkan ID-nya ke allowlist
-- dengan query contoh di bagian akhir file ini.

begin;

create table if not exists public.app_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_user_access enable row level security;
revoke all on table public.app_user_access from anon, authenticated;

create or replace function public.is_app_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_user_access where user_id = auth.uid());
$$;
revoke all on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated;

drop policy if exists "public read bahan baku" on public.bahan_baku;
drop policy if exists "public read produk" on public.produk;
drop policy if exists "public read penjualan" on public.penjualan;
drop policy if exists "public read detail penjualan" on public.detail_penjualan;
drop policy if exists "public read produksi" on public.produksi;
drop policy if exists "public read pemakaian bb" on public.pemakaian_bb;
drop policy if exists "public read mutasi stok" on public.mutasi_stok;
drop policy if exists "public insert bahan baku" on public.bahan_baku;
drop policy if exists "public insert penjualan" on public.penjualan;
drop policy if exists "public insert produk" on public.produk;
drop policy if exists "public update bahan baku" on public.bahan_baku;
drop policy if exists "public delete bahan baku" on public.bahan_baku;
drop policy if exists "public update produk" on public.produk;
drop policy if exists "public delete produk" on public.produk;
drop policy if exists "app access bahan baku" on public.bahan_baku;
drop policy if exists "app access produk" on public.produk;
drop policy if exists "app read penjualan" on public.penjualan;
drop policy if exists "app read detail penjualan" on public.detail_penjualan;
drop policy if exists "app read produksi" on public.produksi;
drop policy if exists "app read pemakaian bb" on public.pemakaian_bb;
drop policy if exists "app read mutasi stok" on public.mutasi_stok;
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

create policy "app access bahan baku" on public.bahan_baku for all to authenticated
  using (public.is_app_user()) with check (public.is_app_user());
create policy "app access produk" on public.produk for all to authenticated
  using (public.is_app_user()) with check (public.is_app_user());
create policy "app read penjualan" on public.penjualan for select to authenticated using (public.is_app_user());
create policy "app read detail penjualan" on public.detail_penjualan for select to authenticated using (public.is_app_user());
create policy "app read produksi" on public.produksi for select to authenticated using (public.is_app_user());
create policy "app read pemakaian bb" on public.pemakaian_bb for select to authenticated using (public.is_app_user());
create policy "app read mutasi stok" on public.mutasi_stok for select to authenticated using (public.is_app_user());

revoke all on table public.bahan_baku, public.produk, public.penjualan, public.detail_penjualan,
  public.produksi, public.pemakaian_bb, public.mutasi_stok from public, anon, authenticated;
grant select, insert, update, delete on table public.bahan_baku, public.produk to authenticated;
grant select on table public.penjualan, public.detail_penjualan, public.produksi,
  public.pemakaian_bb, public.mutasi_stok to authenticated;

create or replace function public.log_mutasi_bahan_baku()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  movement_type text := coalesce(nullif(current_setting('bakely.stock_movement_type', true), ''), 'koreksi');
  reference_id uuid := nullif(current_setting('bakely.stock_reference_id', true), '')::uuid;
  movement_note text := coalesce(nullif(current_setting('bakely.stock_note', true), ''), 'Perubahan stok manual');
begin
  if new.stok <> old.stok then
    insert into public.mutasi_stok (tipe, bahan_baku_id, jumlah, stok_sebelum, stok_sesudah, referensi_id, catatan)
    values (movement_type, new.id, new.stok - old.stok, old.stok, new.stok, reference_id, movement_note);
  end if;
  return new;
end;
$$;

create or replace function public.log_mutasi_produk()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  movement_type text := coalesce(nullif(current_setting('bakely.stock_movement_type', true), ''), 'koreksi');
  reference_id uuid := nullif(current_setting('bakely.stock_reference_id', true), '')::uuid;
  movement_note text := coalesce(nullif(current_setting('bakely.stock_note', true), ''), 'Perubahan stok manual');
begin
  if new.stok <> old.stok then
    insert into public.mutasi_stok (tipe, produk_id, jumlah, stok_sebelum, stok_sesudah, referensi_id, catatan)
    values (movement_type, new.id, new.stok - old.stok, old.stok, new.stok, reference_id, movement_note);
  end if;
  return new;
end;
$$;

drop function if exists public.catat_penjualan(text, text, jsonb);

create or replace function public.catat_produksi(
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
  if not public.is_app_user() then raise exception using errcode = '42501', message = 'Akun ini belum diberi akses'; end if;
  if nullif(trim(p_nomor_produksi), '') is null or p_jumlah <= 0 then
    raise exception 'Nomor dan jumlah produksi wajib diisi';
  end if;
  if p_pemakaian is null or jsonb_array_length(p_pemakaian) = 0 then
    raise exception 'Minimal satu bahan baku harus dicatat';
  end if;

  insert into public.produksi (nomor_produksi, produk_id, jumlah, catatan)
  values (p_nomor_produksi, p_produk_id, p_jumlah, p_catatan)
  returning id into production_id;

  perform set_config('bakely.stock_movement_type', 'produksi', true);
  perform set_config('bakely.stock_reference_id', production_id::text, true);
  perform set_config('bakely.stock_note', 'Penambahan stok dari produksi', true);
  update public.produk set stok = stok + p_jumlah where id = p_produk_id;

  for usage_item in select * from jsonb_array_elements(p_pemakaian) loop
    material_id := (usage_item->>'bahan_baku_id')::uuid;
    usage_amount := (usage_item->>'jumlah')::numeric;
    perform set_config('bakely.stock_movement_type', 'pemakaian_bb', true);
    perform set_config('bakely.stock_note', 'Pemakaian bahan pada produksi', true);
    update public.bahan_baku set stok = stok - usage_amount
    where id = material_id and stok >= usage_amount;
    if not found then raise exception 'Stok bahan baku tidak mencukupi'; end if;
    insert into public.pemakaian_bb (produksi_id, bahan_baku_id, jumlah)
    values (production_id, material_id, usage_amount);
  end loop;
  return jsonb_build_object('id', production_id);
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
begin
  if not public.is_app_user() then raise exception using errcode = '42501', message = 'Akun ini belum diberi akses'; end if;
  if p_status is null or p_status not in ('lunas', 'piutang') then raise exception 'Status pembayaran tidak valid'; end if;
  if nullif(trim(p_nomor_nota), '') is null or p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Nomor nota dan minimal satu barang wajib diisi';
  end if;

  insert into public.penjualan (nomor_nota, pelanggan, total, status)
  values (p_nomor_nota, p_pelanggan, 0, p_status) returning id into sale_id;
  for item in select * from jsonb_array_elements(p_items) loop
    product_id := (item->>'produk_id')::uuid;
    item_amount := (item->>'jumlah')::numeric;
    select harga_jual into item_price from public.produk where id = product_id and stok >= item_amount;
    if not found then raise exception 'Stok barang jadi tidak mencukupi'; end if;
    perform set_config('bakely.stock_movement_type', 'penjualan', true);
    perform set_config('bakely.stock_reference_id', sale_id::text, true);
    perform set_config('bakely.stock_note', 'Pengurangan stok dari penjualan', true);
    update public.produk set stok = stok - item_amount where id = product_id;
    sale_total := sale_total + (item_amount * item_price);
    insert into public.detail_penjualan (penjualan_id, produk_id, jumlah, harga_satuan)
    values (sale_id, product_id, item_amount, item_price);
  end loop;
  update public.penjualan set total = sale_total where id = sale_id;
  return jsonb_build_object('id', sale_id, 'total', sale_total);
end;
$$;

create or replace function public.app_access_check() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_app_user();
$$;

create or replace function public.ringkasan_produksi() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not public.is_app_user() then raise exception using errcode = '42501', message = 'Akun ini belum diberi akses'; end if;
  select jsonb_build_object('total', coalesce(sum(jumlah), 0), 'count', count(*)) into result
  from public.produksi;
  return result;
end;
$$;

create or replace function public.ringkasan_penjualan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not public.is_app_user() then raise exception using errcode = '42501', message = 'Akun ini belum diberi akses'; end if;
  select jsonb_build_object('total', coalesce(sum(total), 0), 'count', count(*)) into result
  from public.penjualan where status <> 'batal';
  return result;
end;
$$;

revoke all on function public.catat_produksi(text, uuid, numeric, text, jsonb) from public, anon;
revoke all on function public.catat_penjualan(text, text, jsonb, text) from public, anon;
revoke all on function public.app_access_check() from public, anon;
revoke all on function public.ringkasan_produksi() from public, anon;
revoke all on function public.ringkasan_penjualan() from public, anon;
grant execute on function public.catat_produksi(text, uuid, numeric, text, jsonb) to authenticated;
grant execute on function public.catat_penjualan(text, text, jsonb, text) to authenticated;
grant execute on function public.app_access_check() to authenticated;
grant execute on function public.ringkasan_produksi() to authenticated;
grant execute on function public.ringkasan_penjualan() to authenticated;

commit;

-- Setelah membuat user di Supabase Authentication > Users, jalankan query ini
-- secara terpisah dengan mengganti email administrator:
-- insert into public.app_user_access (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict do nothing;