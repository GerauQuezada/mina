-- Extensión AISLADA para el servicio QR. No reemplaza el webhook de Meta ni borra datos.
-- Ejecutar una vez en el SQL Editor de tu proyecto Supabase, después de schema.sql.

create or replace function public.ingest_whatsapp_qr_report(p_owner_id uuid,p_report_date date,p_phone text,p_message_id text,p_message_type text,p_raw_text text,p_parsed jsonb,p_expected_labor_id bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid;v_labor_id bigint;v_payload jsonb;v_labor jsonb;v_now text;v_date text;v_time text;
  v_report_id bigint;v_prod_id bigint;v_expense_id bigint;v_audit_id bigint;v_expense jsonb;v_sacks numeric;v_amount bigint;v_contact_count bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Acceso no autorizado'; end if;
  if p_owner_id is null or p_report_date is null or p_report_date>timezone('America/Lima',now())::date or p_report_date<'2000-01-01'::date then raise exception 'Propietario o fecha inválida'; end if;
  if p_message_id is null or length(p_message_id)<4 or length(p_message_id)>240 or p_raw_text is null or length(p_raw_text)>10000
    or p_message_type is null or p_message_type not in ('text','audio') or p_phone is null or regexp_replace(p_phone,'\D','','g')!~'^\d{9,15}$' then raise exception 'Mensaje inválido'; end if;
  if jsonb_typeof(p_parsed) is distinct from 'object' or coalesce(p_parsed->>'status','') not in ('worked','no_work','waste_only')
    or jsonb_typeof(p_parsed->'confidence') is distinct from 'number' or jsonb_typeof(p_parsed->'expenses') is distinct from 'array'
    or coalesce(jsonb_typeof(p_parsed->'sacks'),'') not in ('number','null') then raise exception 'Reporte inválido'; end if;
  if (p_parsed->>'confidence')::numeric<0.6 or (p_parsed->>'confidence')::numeric>1 then raise exception 'Confianza inválida'; end if;
  if jsonb_array_length(p_parsed->'expenses')>20 then raise exception 'Reporte inválido: demasiados gastos'; end if;
  v_sacks=case when jsonb_typeof(p_parsed->'sacks')='number' then (p_parsed->>'sacks')::numeric else null end;
  if v_sacks<0 or v_sacks>100000 then raise exception 'Cantidad de sacos inválida'; end if;
  if v_sacks>0 and p_parsed->>'status'<>'worked' then raise exception 'Reporte contradictorio'; end if;
  if v_sacks is null and jsonb_array_length(p_parsed->'expenses')=0 and p_parsed->>'status'='worked' then raise exception 'Reporte inválido: sin datos'; end if;
  for v_expense in select value from jsonb_array_elements(p_parsed->'expenses') loop
    if jsonb_typeof(v_expense) is distinct from 'object' or jsonb_typeof(v_expense->'amount') is distinct from 'number'
      or coalesce(btrim(v_expense->>'name'),'')='' or length(v_expense->>'name')>160
      or coalesce(v_expense->>'category','') not in ('Trabajadores','Herramientas','Alimentación','Gasolina','Materiales','Otros') then raise exception 'Gasto inválido'; end if;
    if (v_expense->>'amount')::numeric<0.01 or (v_expense->>'amount')::numeric>1000000 then raise exception 'Monto de gasto inválido'; end if;
  end loop;
  select w.owner_id,w.payload into v_owner,v_payload from public.mine_workspace w where w.owner_id=p_owner_id for update;
  if v_owner is null then raise exception 'Teléfono no vinculado'; end if;
  select count(*) into v_contact_count from jsonb_array_elements(coalesce(v_payload->'whatsappContacts','[]'::jsonb)) contact
    where coalesce((contact->>'enabled')::boolean,false) and regexp_replace(contact->>'phone','\D','','g')=regexp_replace(p_phone,'\D','','g');
  if v_contact_count<>1 then raise exception 'Teléfono no vinculado o asignación ambigua'; end if;
  select (contact->>'labor_id')::bigint into v_labor_id from jsonb_array_elements(v_payload->'whatsappContacts') contact
    where coalesce((contact->>'enabled')::boolean,false) and regexp_replace(contact->>'phone','\D','','g')=regexp_replace(p_phone,'\D','','g');
  if p_expected_labor_id is null or v_labor_id is distinct from p_expected_labor_id then raise exception 'La asignación de la labor cambió; requiere revisión'; end if;
  select value into v_labor from jsonb_array_elements(coalesce(v_payload->'labors','[]'::jsonb)) where (value->>'id')::bigint=v_labor_id;
  if v_labor is null or coalesce(v_labor->>'status','')<>'active' then raise exception 'Labor no activa'; end if;
  if v_labor->>'mine_percent' is null or v_labor->>'partner_percent' is null
    or (v_labor->>'mine_percent')::numeric not between 0 and 100 or (v_labor->>'partner_percent')::numeric not between 0 and 100
    or (v_labor->>'mine_percent')::numeric+(v_labor->>'partner_percent')::numeric<>100 then raise exception 'Porcentajes de labor inválidos'; end if;
  insert into public.whatsapp_messages(owner_id,labor_id,meta_message_id,from_phone,message_type,raw_text,parsed)
  values(v_owner,v_labor_id,p_message_id,regexp_replace(p_phone,'\D','','g'),left(p_message_type,30),p_raw_text,p_parsed)
  on conflict(owner_id,meta_message_id) do nothing;
  if not found then return false; end if;
  v_now=to_char(timezone('America/Lima',now()),'YYYY-MM-DD HH24:MI:SS');v_date=to_char(p_report_date,'YYYY-MM-DD');v_time=substring(v_now from 12 for 5);
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
revoke all on function public.ingest_whatsapp_qr_report(uuid,date,text,text,text,text,jsonb,bigint) from public;
grant execute on function public.ingest_whatsapp_qr_report(uuid,date,text,text,text,text,jsonb,bigint) to service_role;
