-- TrailMate — multi-source trails catalog (add Nakeb alongside Tiuli).
-- Run once in the Supabase SQL editor, AFTER trails-enrich.sql. Idempotent.
--
-- Purely additive: existing Tiuli rows are untouched (they default to source
-- 'tiuli'). Nakeb rows are inserted with source 'nakeb' and offset integer ids
-- (100000 + hike id), so the primary key stays integer and nothing else changes.

alter table trails add column if not exists source text not null default 'tiuli';
create index if not exists trails_source on trails (source);

-- Re-declare match_trails to also return `source`, so the UI can show the correct
-- "guide" link (Tiuli vs Nakeb). Body is otherwise identical to trails-enrich.sql.
-- Adding a column to the RETURNS TABLEa changes the return type, so Postgres requires
-- dropping the old function first (CREATE OR REPLACE can't change return type).
drop function if exists match_trails(vector, int, text, numeric, numeric, int, text[]);

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
    source          text,
    similarity      real
)
language sql
stable
as $$
    select
        t.id, t.name_he, t.subtitle, t.url, t.description_he, t.waze_link,
        t.lat, t.lng, t.difficulty, t.difficulty_level, t.distance_km, t.duration,
        t.trail_map_image, t.area_he, t.region_he, t.subregion_he, t.city_he, t.features,
        t.source,
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
