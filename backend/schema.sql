create extension if not exists "uuid-ossp";

create table if not exists scenarios (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists locations (
  id uuid primary key default uuid_generate_v4(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  external_id text not null,
  name text not null,
  location_type text not null check (location_type in ('depot', 'store')),
  latitude double precision not null,
  longitude double precision not null,
  address text,
  unique (scenario_id, external_id)
);

create table if not exists vehicles (
  id uuid primary key default uuid_generate_v4(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  external_id text not null,
  name text not null,
  capacity_kg numeric not null,
  capacity_cbm numeric not null,
  max_stops integer not null,
  start_location_external_id text not null,
  end_location_external_id text not null,
  restricted_zones text[] not null default '{}',
  unique (scenario_id, external_id)
);

create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  external_id text not null,
  location_external_id text not null,
  weight_kg numeric not null,
  cbm numeric not null,
  service_minutes integer not null,
  time_window_start time not null,
  time_window_end time not null,
  priority text not null check (priority in ('normal', 'high')),
  unique (scenario_id, external_id)
);

create table if not exists route_results (
  id uuid primary key default uuid_generate_v4(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  vehicle_external_id text not null,
  distance_km numeric not null,
  duration_minutes integer not null,
  load_kg numeric not null,
  load_cbm numeric not null,
  warnings jsonb not null default '[]',
  geometry jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists route_stops (
  id uuid primary key default uuid_generate_v4(),
  route_result_id uuid not null references route_results(id) on delete cascade,
  sequence integer not null,
  location_external_id text not null,
  order_external_id text,
  arrival_minutes integer not null,
  load_kg numeric not null,
  load_cbm numeric not null,
  service_minutes integer not null,
  warnings jsonb not null default '[]',
  unique (route_result_id, sequence)
);
