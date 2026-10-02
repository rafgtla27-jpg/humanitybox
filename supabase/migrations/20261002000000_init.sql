-- WORLD_SIM : schéma initial
-- Les runs sont écrits uniquement par la CI (clé service_role, qui contourne RLS).
-- Le viewer public lit avec la clé anon : lecture seule.

create table if not exists experiments (
  id          text primary key,
  title       text not null,
  question    text,
  created_at  timestamptz not null default now()
);

create table if not exists runs (
  id                uuid primary key default gen_random_uuid(),
  experiment_id     text not null references experiments(id),
  scenario          text not null,
  label             text not null,
  seed              integer not null,
  params            jsonb not null,
  climate_provider  text not null,
  engine_version    text not null,
  git_sha           text,
  start_year        integer not null,
  end_year          integer not null,
  has_frames        boolean not null default false,
  storage_prefix    text,
  created_at        timestamptz not null default now()
);
create index if not exists runs_experiment_idx on runs (experiment_id, scenario, created_at desc);

create table if not exists region_results (
  run_id              uuid not null references runs(id) on delete cascade,
  region              text not null,
  model_bp            integer,             -- null = jamais atteint
  target_oldest_bp    integer not null,
  target_youngest_bp  integer not null,
  verdict             text not null,
  primary key (run_id, region)
);

create table if not exists events (
  id      bigint generated always as identity primary key,
  run_id  uuid not null references runs(id) on delete cascade,
  year    integer not null,
  kind    text not null,
  region  text not null,
  data    jsonb not null default '{}'
);
create index if not exists events_run_idx on events (run_id, year);

-- Vue d'ensemble : une ligne par scénario et région, toutes seeds confondues.
-- C'est ici que se lit P(arrivée dans la fourchette | scénario).
create or replace view scenario_summary with (security_invoker = on) as
select r.experiment_id, r.scenario, r.engine_version, rr.region,
       count(*)                                              as runs,
       count(rr.model_bp)                                    as reached,
       round(avg(rr.model_bp))                               as mean_arrival_bp,
       min(rr.model_bp)                                      as earliest_bp,
       max(rr.model_bp)                                      as latest_bp,
       round(avg((rr.verdict = 'OK')::int)::numeric, 2)      as p_in_range
from runs r join region_results rr on rr.run_id = r.id
group by 1, 2, 3, 4;

alter table experiments    enable row level security;
alter table runs           enable row level security;
alter table region_results enable row level security;
alter table events         enable row level security;

create policy "lecture publique" on experiments    for select using (true);
create policy "lecture publique" on runs           for select using (true);
create policy "lecture publique" on region_results for select using (true);
create policy "lecture publique" on events         for select using (true);

-- Stockage des frames et manifests : bucket public en lecture
insert into storage.buckets (id, name, public)
values ('runs', 'runs', true)
on conflict (id) do nothing;

insert into experiments (id, title, question) values
  ('exp-001-dispersal', 'Dispersion d''Homo sapiens, 120 000 → 10 000 BP',
   'Des humains sans technologie explicite se déplacent-ils de façon crédible sur une Terre qui change ?')
on conflict (id) do nothing;
