-- TrailMate — trails catalog enrichment + semantic search
-- Run once in the Supabase SQL editor, AFTER schema.sql.
--
-- Adds the detailed attributes extracted from tiuli (geography, difficulty level,
-- distance, features) plus a pgvector embedding, and a match_trails() RPC that
-- filters on hard constraints (region / distance / difficulty / features) and ranks
-- the survivors by semantic similarity to a query embedding.
--
-- Idempotent: safe to re-run.

-- pgvector for embedding similarity search.
create extension if not exists vector;

-- ── New columns on the existing trails table ─────────────────────────────────
alter table trails add column if not exists difficulty_level smallint;   -- 1..5 (null = unknown)
alter table trails add column if not exists distance_km      numeric;     -- km  (null = unknown, e.g. jeep trips)
alter table trails add column if not exists area_he          text;        -- top-level area, Hebrew (e.g. צפון)
alter table trails add column if not exists area_en          text;        -- English gloss (e.g. North)
alter table trails add column if not exists region_he        text;        -- region, Hebrew (e.g. גליל מערבי)
alter table trails add column if not exists subregion_he     text;
alter table trails add column if not exists city_he          text;
alter table trails add column if not exists features         text[];      -- English slugs: water, loop, family, dog, bike…
alter table trails add column if not exists features_he      text[];      -- raw Hebrew feature labels (display only)
alter table trails add column if not exists author           text;
alter table trails add column if not exists date_modified    timestamptz;
alter table trails add column if not exists embedding        vector(1536);-- OpenAI text-embedding-3-small

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Feature containment (features @> ARRAY['water']).
create index if not exists trails_features_gin on trails using gin (features);
-- Hard-filter columns.
create index if not exists trails_difficulty on trails (difficulty_level);
create index if not exists trails_distance   on trails (distance_km);
-- Approximate-nearest-neighbour over embeddings (cosine).
create index if not exists trails_embedding_hnsw
    on trails using hnsw (embedding vector_cosine_ops);

-- ── match_trails: filtered semantic search ───────────────────────────────────
-- Called server-side (service_role). All filters are optional; pass null to skip.
-- Trails failing a *provided* hard filter are excluded — including trails whose
-- distance/difficulty is unknown when that filter is set (a null can't be proven
-- to fit, so we don't guess).
create or replace function match_trails(
    query_embedding  vector(1536),
    match_count      int     default 5,
    filter_region    text    default null,
    max_km           numeric default null,
    min_km           numeric default null,
    difficulty_max   int     default null,
    required_features text[]  default null
)
returns table (
    id              integer,
    name_he         text,
    subtitle        text,
    url             text,
    description_he  text,
    waze_link       text,
    lat             double precision,
    lng             double precision,
    difficulty      text,
    difficulty_level smallint,
    distance_km     numeric,
    duration        text,
    trail_map_image text,
    area_he         text,
    region_he       text,
    subregion_he    text,
    city_he         text,
    features        text[],
    similarity      real
)
language sql
stable
as $$
    select
        t.id, t.name_he, t.subtitle, t.url, t.description_he, t.waze_link,
        t.lat, t.lng, t.difficulty, t.difficulty_level, t.distance_km, t.duration,
        t.trail_map_image, t.area_he, t.region_he, t.subregion_he, t.city_he, t.features,
        (1 - (t.embedding <=> query_embedding))::real as similarity
    from trails t
    where t.embedding is not null
      and (filter_region is null
           or t.region_he    ilike '%' || filter_region || '%'
           or t.area_he      ilike '%' || filter_region || '%'
           or t.subregion_he ilike '%' || filter_region || '%'
           or t.city_he      ilike '%' || filter_region || '%'
           or t.name_he      ilike '%' || filter_region || '%')
      and (max_km is null         or (t.distance_km is not null and t.distance_km <= max_km))
      and (min_km is null         or (t.distance_km is not null and t.distance_km >= min_km))
      and (difficulty_max is null or (t.difficulty_level is not null and t.difficulty_level <= difficulty_max))
      and (required_features is null or t.features @> required_features)
    order by t.embedding <=> query_embedding
    limit greatest(1, least(match_count, 20));
$$;
