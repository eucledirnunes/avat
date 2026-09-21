-- Plataforma de avatares: schema inicial (multi-tenant por organization_id).
-- Sem login por enquanto: o acesso é feito só pelas Edge Functions (service role).
-- RLS fica LIGADO em todas as tabelas e sem policies, então anon/authenticated não leem nada.
-- Quando o login entrar, basta criar organization_members + policies.

create extension if not exists pgcrypto;

-- ---------- organizations ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  credits_balance integer not null default 0 check (credits_balance >= 0),
  created_at timestamptz not null default now()
);

-- ---------- avatares (heygen_* nunca sai do backend) ----------
create table public.avatars (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid,
  heygen_avatar_id text not null,
  heygen_group_id text,
  heygen_look_id text,
  name text not null,
  preview_image_url text,
  visibility text not null default 'team' check (visibility in ('private', 'team')),
  status text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  credits_used integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, heygen_avatar_id)
);
create index avatars_org_idx on public.avatars (organization_id);

-- ---------- vídeos ----------
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid,
  avatar_id uuid not null references public.avatars(id),
  heygen_video_id text,
  script text not null,
  ratio text not null default '9:16' check (ratio in ('9:16', '16:9')),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  video_url text,
  credits_used integer not null default 0,
  refunded boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);
create index videos_org_idx on public.videos (organization_id, created_at desc);

-- ---------- ledger de créditos ----------
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('purchase', 'video', 'avatar', 'refund', 'adjustment')),
  amount integer not null,                 -- positivo = entrada, negativo = saída
  description text,
  reference_id uuid,                       -- video.id / avatar.id relacionado
  created_at timestamptz not null default now()
);
create index credit_tx_org_idx on public.credit_transactions (organization_id, created_at desc);

-- ---------- tabela comercial (sua moeda interna) ----------
create table public.credit_costs (
  operation text primary key,
  credits integer not null check (credits >= 0)
);
insert into public.credit_costs (operation, credits) values
  ('video_30s', 80),
  ('video_60s', 150),
  ('video_extra_minute', 150),
  ('avatar_create', 200);

-- ---------- débito/crédito atômico ----------
-- Trava a linha da organização, valida saldo, grava no ledger e atualiza o saldo.
create or replace function public.apply_credit(
  p_org uuid,
  p_type text,
  p_amount integer,
  p_description text default null,
  p_reference uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  select credits_balance into v_balance
  from organizations where id = p_org for update;

  if not found then
    raise exception 'organization_not_found';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'insufficient_credits';
  end if;

  insert into credit_transactions (organization_id, type, amount, description, reference_id)
  values (p_org, p_type, p_amount, p_description, p_reference);

  update organizations set credits_balance = v_balance + p_amount where id = p_org
  returning credits_balance into v_balance;

  return v_balance;
end;
$$;

revoke all on function public.apply_credit(uuid, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_credit(uuid, text, integer, text, uuid) to service_role;

-- ---------- RLS: ligado, sem policies (só service role acessa) ----------
alter table public.organizations enable row level security;
alter table public.avatars enable row level security;
alter table public.videos enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.credit_costs enable row level security;

-- ---------- organização padrão (modo sem login) ----------
insert into public.organizations (id, name, plan, credits_balance)
values ('00000000-0000-0000-0000-000000000001', 'Organização padrão', 'free', 0);

insert into public.credit_transactions (organization_id, type, amount, description)
values ('00000000-0000-0000-0000-000000000001', 'adjustment', 0, 'Organização criada');
