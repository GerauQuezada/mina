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
