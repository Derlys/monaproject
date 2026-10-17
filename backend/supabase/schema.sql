-- MonPago Colombia · esquema de Supabase (Postgres)
-- Pégalo en Supabase → SQL Editor → Run. Es idempotente: puedes correrlo varias veces.

create table if not exists public.payment_requests (
  id            bigint primary key,            -- id de la solicitud en el contrato
  creator       text,                          -- dirección 0x en minúsculas
  payer         text,
  amount_wei    text,                          -- texto: los wei no caben en un number de JSON
  concept       text,
  status        text not null default 'pending' check (status in ('pending', 'paid')),
  client_name   text,                          -- off-chain
  category      text,                          -- off-chain
  created_tx    text,
  created_block bigint,
  created_at    timestamptz,                   -- timestamp del bloque de creación
  paid_tx       text,
  paid_block    bigint,
  paid_at       timestamptz,                   -- timestamp del bloque del pago
  updated_at    timestamptz not null default now()
);

create index if not exists payment_requests_creator_idx        on public.payment_requests (creator);
create index if not exists payment_requests_creator_status_idx on public.payment_requests (creator, status);
create index if not exists payment_requests_paid_at_idx        on public.payment_requests (paid_at);

-- Una sola fila (id = 1) con el último bloque indexado, para retomar tras un reinicio.
create table if not exists public.indexer_state (
  id         int primary key default 1 check (id = 1),
  last_block bigint not null,
  updated_at timestamptz not null default now()
);

-- Seguridad: RLS activado y SIN políticas => la anon key no puede leer ni escribir nada.
-- Solo el backend (service role key, que ignora RLS) accede a estas tablas.
alter table public.payment_requests enable row level security;
alter table public.indexer_state    enable row level security;
