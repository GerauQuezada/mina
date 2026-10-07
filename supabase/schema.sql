-- Ejecutar en el proyecto Supabase gratuito. No contiene contraseñas.
create table if not exists public.mine_workspace (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.mine_workspace enable row level security;
revoke all on public.mine_workspace from anon, authenticated;
grant select on public.mine_workspace to authenticated;
drop policy if exists "owner_read" on public.mine_workspace;
create policy "owner_read" on public.mine_workspace for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->>'email') = 'madfaygoo@gmail.com');
create or replace function public.save_mine_workspace(data jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'email','') <> 'madfaygoo@gmail.com' then
    raise exception 'Acceso no autorizado';
  end if;
  if jsonb_typeof(data) <> 'object' or octet_length(data::text)>40000000 then raise exception 'Respaldo inválido o demasiado grande'; end if;
  if expected_revision=0 then
    insert into public.mine_workspace(owner_id,payload,revision) values(auth.uid(),data,1)
    on conflict do nothing returning revision into new_revision;
  else
    update public.mine_workspace set payload=data,revision=revision+1,updated_at=now()
    where owner_id=auth.uid() and revision=expected_revision returning revision into new_revision;
  end if;
  if new_revision is null then raise exception 'Otro dispositivo modificó los datos. Actualiza y vuelve a intentarlo.'; end if;
  return new_revision;
end; $$;
revoke all on function public.save_mine_workspace(jsonb,bigint) from public;
grant execute on function public.save_mine_workspace(jsonb,bigint) to authenticated;

-- Portales privados para que cada socio registre únicamente su propia labor.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.partner_portals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  labor_id bigint not null,
  share_token uuid not null default gen_random_uuid() unique,
  password_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,labor_id)
);
alter table public.partner_portals enable row level security;
revoke all on public.partner_portals from anon, authenticated;

create or replace function public.list_partner_portals()
returns table(labor_id bigint,share_token uuid,enabled boolean,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'email','') <> 'madfaygoo@gmail.com' then raise exception 'Acceso no autorizado'; end if;
  return query select p.labor_id,p.share_token,p.enabled,p.updated_at from public.partner_portals p where p.owner_id=auth.uid() order by p.created_at;
end; $$;

create or replace function public.set_partner_portal(p_labor_id bigint,p_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token uuid;v_updated timestamptz;v_exists boolean;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'email','') <> 'madfaygoo@gmail.com' then raise exception 'Acceso no autorizado'; end if;
  if length(p_password)<10 or length(p_password)>100 then raise exception 'La contraseña debe tener al menos 10 caracteres'; end if;
  select exists(select 1 from public.mine_workspace w cross join lateral jsonb_array_elements(coalesce(w.payload->'labors','[]'::jsonb)) l where w.owner_id=auth.uid() and (l->>'id')::bigint=p_labor_id) into v_exists;
  if not v_exists then raise exception 'Labor no encontrada'; end if;
  insert into public.partner_portals(owner_id,labor_id,password_hash,enabled)
  values(auth.uid(),p_labor_id,extensions.crypt(p_password,extensions.gen_salt('bf',10)),true)
  on conflict(owner_id,labor_id) do update set password_hash=excluded.password_hash,enabled=true,updated_at=now()
  returning share_token,updated_at into v_token,v_updated;
  return jsonb_build_object('labor_id',p_labor_id,'share_token',v_token,'enabled',true,'updated_at',v_updated);
end; $$;

create or replace function public.disable_partner_portal(p_labor_id bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'email','') <> 'madfaygoo@gmail.com' then raise exception 'Acceso no autorizado'; end if;
  update public.partner_portals set enabled=false,updated_at=now() where owner_id=auth.uid() and labor_id=p_labor_id;
  return found;
end; $$;

create or replace function public.partner_portal_view(p_token text,p_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_labor_id bigint;v_payload jsonb;v_labor jsonb;v_production jsonb;v_expenses jsonb;
begin
  select p.labor_id,w.payload into v_labor_id,v_payload from public.partner_portals p join public.mine_workspace w on w.owner_id=p.owner_id
  where p.share_token::text=p_token and p.enabled and p.password_hash=extensions.crypt(p_password,p.password_hash);
  if not found then raise exception 'Enlace o contraseña incorrectos'; end if;
  select value into v_labor from jsonb_array_elements(coalesce(v_payload->'labors','[]'::jsonb)) where (value->>'id')::bigint=v_labor_id;
  if v_labor is null then raise exception 'La labor ya no está disponible'; end if;
  select coalesce(jsonb_agg(value order by value->>'date' desc,value->>'created_at' desc),'[]'::jsonb) into v_production from jsonb_array_elements(coalesce(v_payload->'production','[]'::jsonb)) where coalesce((value->>'deleted_at'),'')='' and (value->>'labor_id')::bigint=v_labor_id;
  select coalesce(jsonb_agg(value order by value->>'expense_date' desc,value->>'expense_time' desc),'[]'::jsonb) into v_expenses from jsonb_array_elements(coalesce(v_payload->'expenses','[]'::jsonb)) where coalesce((value->>'deleted_at'),'')='' and (value->>'labor_id')::bigint=v_labor_id;
  return jsonb_build_object('labor',v_labor,'production',v_production,'expenses',v_expenses);
end; $$;

create or replace function public.partner_portal_add_production(p_token text,p_password text,p_date text,p_sacks numeric,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_portal public.partner_portals%rowtype;v_payload jsonb;v_labor jsonb;v_id bigint;v_audit_id bigint;v_now text;v_record jsonb;v_audit jsonb;
begin
  if p_date!~'^\d{4}-\d{2}-\d{2}$' or to_char(p_date::date,'YYYY-MM-DD')<>p_date then raise exception 'Fecha inválida'; end if;
  if p_sacks is null or p_sacks<=0 or p_sacks>1000000 then raise exception 'Cantidad de sacos inválida'; end if;
  select p.* into v_portal from public.partner_portals p where p.share_token::text=p_token and p.enabled and p.password_hash=extensions.crypt(p_password,p.password_hash);
  if not found then raise exception 'Enlace o contraseña incorrectos'; end if;
  select payload into v_payload from public.mine_workspace where owner_id=v_portal.owner_id for update;
  select value into v_labor from jsonb_array_elements(coalesce(v_payload->'labors','[]'::jsonb)) where (value->>'id')::bigint=v_portal.labor_id and coalesce(value->>'status','active')='active';
  if v_labor is null then raise exception 'La labor no está activa'; end if;
  select coalesce(max((value->>'id')::bigint),0)+1 into v_id from jsonb_array_elements(coalesce(v_payload->'production','[]'::jsonb));
  select coalesce(max((value->>'id')::bigint),0)+1 into v_audit_id from jsonb_array_elements(coalesce(v_payload->'audit','[]'::jsonb));v_now=to_char(timezone('UTC',now()),'YYYY-MM-DD HH24:MI:SS');
  v_record=jsonb_build_object('id',v_id,'labor_id',v_portal.labor_id,'date',p_date,'sacks',p_sacks,'mine_percent',(v_labor->>'mine_percent')::numeric,'partner_percent',(v_labor->>'partner_percent')::numeric,'mine_sacks',p_sacks*(v_labor->>'mine_percent')::numeric/100,'partner_sacks',p_sacks*(v_labor->>'partner_percent')::numeric/100,'note',left(coalesce(p_note,''),1000),'created_by',null,'source','partner_portal','created_at',v_now);
  v_audit=jsonb_build_object('id',v_audit_id,'user_id',null,'user_name',coalesce(v_labor->>'partner_name','Socio'),'action','CREATE','entity','ProductionRecord','entity_id',v_id,'details',jsonb_build_object('source','partner_portal','labor_id',v_portal.labor_id)::text,'created_at',v_now);
  v_payload=jsonb_set(v_payload,'{production}',coalesce(v_payload->'production','[]'::jsonb)||jsonb_build_array(v_record),true);v_payload=jsonb_set(v_payload,'{audit}',jsonb_build_array(v_audit)||coalesce(v_payload->'audit','[]'::jsonb),true);
  update public.mine_workspace set payload=v_payload,revision=revision+1,updated_at=now() where owner_id=v_portal.owner_id;
  return jsonb_build_object('ok',true,'id',v_id);
end; $$;

create or replace function public.partner_portal_add_expense(p_token text,p_password text,p_name text,p_amount_cents bigint,p_date text,p_time text,p_category text,p_payment_method text,p_description text default '',p_observation text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_portal public.partner_portals%rowtype;v_payload jsonb;v_labor jsonb;v_id bigint;v_audit_id bigint;v_now text;v_record jsonb;v_audit jsonb;
begin
  if length(trim(coalesce(p_name,'')))<2 or length(p_name)>160 then raise exception 'Descripción del gasto inválida'; end if;
  if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>100000000000 then raise exception 'Monto inválido'; end if;
  if p_date!~'^\d{4}-\d{2}-\d{2}$' or to_char(p_date::date,'YYYY-MM-DD')<>p_date then raise exception 'Fecha inválida'; end if;
  if p_time!~'^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Hora inválida'; end if;
  select p.* into v_portal from public.partner_portals p where p.share_token::text=p_token and p.enabled and p.password_hash=extensions.crypt(p_password,p.password_hash);
  if not found then raise exception 'Enlace o contraseña incorrectos'; end if;
  select payload into v_payload from public.mine_workspace where owner_id=v_portal.owner_id for update;
  select value into v_labor from jsonb_array_elements(coalesce(v_payload->'labors','[]'::jsonb)) where (value->>'id')::bigint=v_portal.labor_id and coalesce(value->>'status','active')='active';
  if v_labor is null then raise exception 'La labor no está activa'; end if;
  select coalesce(max((value->>'id')::bigint),0)+1 into v_id from jsonb_array_elements(coalesce(v_payload->'expenses','[]'::jsonb));
  select coalesce(max((value->>'id')::bigint),0)+1 into v_audit_id from jsonb_array_elements(coalesce(v_payload->'audit','[]'::jsonb));v_now=to_char(timezone('UTC',now()),'YYYY-MM-DD HH24:MI:SS');
  v_record=jsonb_build_object('id',v_id,'labor_id',v_portal.labor_id,'name',trim(p_name),'amount_cents',p_amount_cents,'description',left(coalesce(p_description,''),2000),'expense_date',p_date,'expense_time',p_time,'category',left(coalesce(p_category,'Otros'),80),'payment_method',left(coalesce(p_payment_method,'Otro'),80),'observation',left(coalesce(p_observation,''),2000),'partner_percent',(v_labor->>'partner_percent')::numeric,'receipt_data_url',null,'created_by',null,'source','partner_portal','created_at',v_now);
  v_audit=jsonb_build_object('id',v_audit_id,'user_id',null,'user_name',coalesce(v_labor->>'partner_name','Socio'),'action','CREATE','entity','Expense','entity_id',v_id,'details',jsonb_build_object('source','partner_portal','labor_id',v_portal.labor_id)::text,'created_at',v_now);
  v_payload=jsonb_set(v_payload,'{expenses}',coalesce(v_payload->'expenses','[]'::jsonb)||jsonb_build_array(v_record),true);v_payload=jsonb_set(v_payload,'{audit}',jsonb_build_array(v_audit)||coalesce(v_payload->'audit','[]'::jsonb),true);
  update public.mine_workspace set payload=v_payload,revision=revision+1,updated_at=now() where owner_id=v_portal.owner_id;
  return jsonb_build_object('ok',true,'id',v_id);
end; $$;

revoke all on function public.list_partner_portals() from public;
revoke all on function public.set_partner_portal(bigint,text) from public;
revoke all on function public.disable_partner_portal(bigint) from public;
revoke all on function public.partner_portal_view(text,text) from public;
revoke all on function public.partner_portal_add_production(text,text,text,numeric,text) from public;
revoke all on function public.partner_portal_add_expense(text,text,text,bigint,text,text,text,text,text,text) from public;
grant execute on function public.list_partner_portals() to authenticated;
grant execute on function public.set_partner_portal(bigint,text) to authenticated;
grant execute on function public.disable_partner_portal(bigint) to authenticated;
grant execute on function public.partner_portal_view(text,text) to anon,authenticated;
grant execute on function public.partner_portal_add_production(text,text,text,numeric,text) to anon,authenticated;
grant execute on function public.partner_portal_add_expense(text,text,text,bigint,text,text,text,text,text,text) to anon,authenticated;

-- Archivos privados del editor modular 3D. Los modelos nunca son públicos.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mine-models','mine-models',false,52428800,array['model/gltf-binary','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "owner_editor_models_select" on storage.objects;
create policy "owner_editor_models_select" on storage.objects for select to authenticated
using(bucket_id='mine-models' and (storage.foldername(name))[1]=(select auth.uid())::text and (select auth.jwt()->>'email')='madfaygoo@gmail.com');
drop policy if exists "owner_editor_models_insert" on storage.objects;
create policy "owner_editor_models_insert" on storage.objects for insert to authenticated
with check(bucket_id='mine-models' and (storage.foldername(name))[1]=(select auth.uid())::text and (select auth.jwt()->>'email')='madfaygoo@gmail.com');
drop policy if exists "owner_editor_models_update" on storage.objects;
create policy "owner_editor_models_update" on storage.objects for update to authenticated
using(bucket_id='mine-models' and (storage.foldername(name))[1]=(select auth.uid())::text and (select auth.jwt()->>'email')='madfaygoo@gmail.com')
with check(bucket_id='mine-models' and (storage.foldername(name))[1]=(select auth.uid())::text and (select auth.jwt()->>'email')='madfaygoo@gmail.com');
drop policy if exists "owner_editor_models_delete" on storage.objects;
create policy "owner_editor_models_delete" on storage.objects for delete to authenticated
using(bucket_id='mine-models' and (storage.foldername(name))[1]=(select auth.uid())::text and (select auth.jwt()->>'email')='madfaygoo@gmail.com');

-- Bandeja técnica e idempotencia para el asistente oficial de WhatsApp.
create table if not exists public.whatsapp_messages(
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  labor_id bigint not null,
  meta_message_id text not null,
  from_phone text not null,
  message_type text not null,
  raw_text text not null,
  parsed jsonb not null default '{}'::jsonb,
  status text not null default 'auto_imported' check(status in('auto_imported','review','ignored','error')),
  created_at timestamptz not null default now(),
  unique(owner_id,meta_message_id)
);
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon,authenticated;
grant select on public.whatsapp_messages to authenticated;
drop policy if exists "owner_whatsapp_messages_read" on public.whatsapp_messages;
create policy "owner_whatsapp_messages_read" on public.whatsapp_messages for select to authenticated
using(owner_id=(select auth.uid()) and (select auth.jwt()->>'email')='madfaygoo@gmail.com');

create table if not exists public.whatsapp_daily_deliveries(
  owner_id uuid not null references auth.users(id) on delete cascade,
  labor_id bigint not null,
  report_date date not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,labor_id,report_date)
);
alter table public.whatsapp_daily_deliveries enable row level security;
revoke all on public.whatsapp_daily_deliveries from anon,authenticated;

create or replace function public.claim_whatsapp_daily(p_owner_id uuid,p_labor_id bigint,p_report_date date)
returns boolean language plpgsql security definer set search_path='' as $$
declare inserted boolean;
begin
  if auth.role()<>'service_role' then raise exception 'Acceso no autorizado'; end if;
  insert into public.whatsapp_daily_deliveries(owner_id,labor_id,report_date) values(p_owner_id,p_labor_id,p_report_date)
  on conflict do nothing returning true into inserted;
  return coalesce(inserted,false);
end; $$;
revoke all on function public.claim_whatsapp_daily(uuid,bigint,date) from public;
grant execute on function public.claim_whatsapp_daily(uuid,bigint,date) to service_role;

create or replace function public.ingest_whatsapp_report(p_phone text,p_message_id text,p_message_type text,p_raw_text text,p_parsed jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid;v_labor_id bigint;v_payload jsonb;v_labor jsonb;v_now text;v_date text;v_time text;
  v_report_id bigint;v_prod_id bigint;v_expense_id bigint;v_audit_id bigint;v_expense jsonb;v_sacks numeric;v_amount bigint;
begin
  if auth.role()<>'service_role' then raise exception 'Acceso no autorizado'; end if;
  if length(p_message_id)<4 or length(p_message_id)>240 or length(p_raw_text)>10000 then raise exception 'Mensaje inválido'; end if;
  select w.owner_id,w.payload,(contact->>'labor_id')::bigint into v_owner,v_payload,v_labor_id
  from public.mine_workspace w cross join lateral jsonb_array_elements(coalesce(w.payload->'whatsappContacts','[]'::jsonb)) contact
  where coalesce((contact->>'enabled')::boolean,true) and regexp_replace(contact->>'phone','\D','','g')=regexp_replace(p_phone,'\D','','g')
  limit 1 for update of w;
  if v_owner is null then raise exception 'Teléfono no vinculado'; end if;
  select value into v_labor from jsonb_array_elements(coalesce(v_payload->'labors','[]'::jsonb)) where (value->>'id')::bigint=v_labor_id;
  if v_labor is null then raise exception 'Labor no encontrada'; end if;
  insert into public.whatsapp_messages(owner_id,labor_id,meta_message_id,from_phone,message_type,raw_text,parsed)
  values(v_owner,v_labor_id,p_message_id,regexp_replace(p_phone,'\D','','g'),left(p_message_type,30),p_raw_text,p_parsed)
  on conflict(owner_id,meta_message_id) do nothing;
  if not found then return false; end if;
  v_now=to_char(timezone('America/Lima',now()),'YYYY-MM-DD HH24:MI:SS');v_date=left(v_now,10);v_time=substring(v_now from 12 for 5);
  select coalesce(max((value->>'id')::bigint),0)+1 into v_report_id from jsonb_array_elements(coalesce(v_payload->'fieldReports','[]'::jsonb));
  v_payload=jsonb_set(v_payload,'{fieldReports}',coalesce(v_payload->'fieldReports','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',v_report_id,'labor_id',v_labor_id,'date',v_date,'status',coalesce(p_parsed->>'status','worked'),'raw_text',left(p_raw_text,5000),'source','whatsapp_ai','created_at',v_now)),true);
  v_sacks=case when jsonb_typeof(p_parsed->'sacks')='number' then (p_parsed->>'sacks')::numeric else null end;
  if v_sacks>0 then
    select coalesce(max((value->>'id')::bigint),0)+1 into v_prod_id from jsonb_array_elements(coalesce(v_payload->'production','[]'::jsonb));
    v_payload=jsonb_set(v_payload,'{production}',coalesce(v_payload->'production','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',v_prod_id,'labor_id',v_labor_id,'date',v_date,'sacks',v_sacks,'mine_percent',(v_labor->>'mine_percent')::numeric,'partner_percent',(v_labor->>'partner_percent')::numeric,'mine_sacks',v_sacks*(v_labor->>'mine_percent')::numeric/100,'partner_sacks',v_sacks*(v_labor->>'partner_percent')::numeric/100,'note','Importado automáticamente desde WhatsApp','created_by',null,'source','whatsapp_ai','created_at',v_now)),true);
  end if;
  for v_expense in select value from jsonb_array_elements(coalesce(p_parsed->'expenses','[]'::jsonb)) loop
    v_amount=round(greatest(0,coalesce((v_expense->>'amount')::numeric,0))*100);
    if v_amount>0 then
      select coalesce(max((value->>'id')::bigint),0)+1 into v_expense_id from jsonb_array_elements(coalesce(v_payload->'expenses','[]'::jsonb));
      v_payload=jsonb_set(v_payload,'{expenses}',coalesce(v_payload->'expenses','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',v_expense_id,'labor_id',v_labor_id,'name',left(coalesce(v_expense->>'name','Gasto informado por WhatsApp'),160),'amount_cents',v_amount,'description','','expense_date',v_date,'expense_time',v_time,'category',left(coalesce(v_expense->>'category','Otros'),80),'payment_method','Por confirmar','observation','Importado automáticamente desde WhatsApp','partner_percent',(v_labor->>'partner_percent')::numeric,'receipt_data_url',null,'created_by',null,'source','whatsapp_ai','created_at',v_now)),true);
    end if;
  end loop;
  select coalesce(max((value->>'id')::bigint),0)+1 into v_audit_id from jsonb_array_elements(coalesce(v_payload->'audit','[]'::jsonb));
  v_payload=jsonb_set(v_payload,'{audit}',jsonb_build_array(jsonb_build_object('id',v_audit_id,'user_id',null,'user_name',coalesce(v_labor->>'partner_name','WhatsApp IA'),'action','CREATE','entity','WhatsAppFieldReport','entity_id',v_report_id,'details',jsonb_build_object('message_id',p_message_id,'confidence',p_parsed->'confidence')::text,'created_at',v_now))||coalesce(v_payload->'audit','[]'::jsonb),true);
  update public.mine_workspace set payload=v_payload,revision=revision+1,updated_at=now() where owner_id=v_owner;
  return true;
end; $$;
revoke all on function public.ingest_whatsapp_report(text,text,text,text,jsonb) from public;
grant execute on function public.ingest_whatsapp_report(text,text,text,text,jsonb) to service_role;
