-- TrailMate — loosen match_trails' region gate to WORD level.
-- Run once in the Supabase SQL editor, AFTER trails-nakeb.sql. Idempotent.
--
-- Before: region filter required the whole phrase as a substring, so "נגב מערבי"
-- returned only trails whose text literally contained "נגב מערבי" (and dropped every
-- plain-"נגב" trail). Now it matches if ANY region word appears in the trail's pooled
-- geography/name — so broader matches survive as candidates, and the service re-ranks
-- them so trails matching MORE of the region words come first. Return type is
-- unchanged (still includes `source`), so CREATE OR REPLACE is fine here.

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
      and (filter_region is null or exists (
            select 1
            from unnest(regexp_split_to_array(trim(filter_region), '\s+')) as w
            where char_length(w) > 1
              and (
                coalesce(t.region_he, '') || ' ' || coalesce(t.subregion_he, '') || ' ' ||
                coalesce(t.area_he, '') || ' ' || coalesce(t.name_he, '')
              ) ilike '%' || w || '%'
          ))
      and (max_km is null         or (t.distance_km is not null and t.distance_km <= max_km))
      and (min_km is null         or (t.distance_km is not null and t.distance_km >= min_km))
      and (difficulty_max is null or (t.difficulty_level is not null and t.difficulty_level <= difficulty_max))
      and (required_features is null or t.features @> required_features)
    order by t.embedding <=> query_embedding
    limit greatest(1, least(match_count, 20));
$$;
