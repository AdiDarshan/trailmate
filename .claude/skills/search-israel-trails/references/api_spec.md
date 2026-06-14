# API Reference — Search Israel Trails

## 1. Israel Hiking Map (IHM) Search
**No API key required.**

```
GET https://israelhiking.osm.org.il/api/search/{term}?language={en|he}
```

**Response:** JSON array of POI objects.
**Filter:** Keep only items where `icon` contains `"hike"`. Discard hotels, cities, bus stops, etc.
**ID format:** `"relation_282071"` | `"way_12345"` | `"node_99999"`
- Only `relation_` IDs have full geometry and should proceed to Overpass enrichment.

**Key fields:**
| Field | Description |
|---|---|
| `id` | OSM type + numeric ID |
| `title` | Trail name |
| `displayName` | Name + region |
| `location` | `{lat, lng, alt}` |
| `icon` | `"icon-hike"` for trails |

---

## 2. Overpass API (OSM tag enrichment)
**No API key required. Timeout: 20s.**

```
POST https://overpass-api.de/api/interpreter
body: [out:json];relation({OSM_ID});out tags;
```

**Key tags for Israeli trails (ITC-managed):**

| Tag | Example | Notes |
|---|---|---|
| `osmc:symbol` | `"blue:white:blue_stripe"` | Parse first known color word |
| `network` | `"lwn"` / `"rwn"` / `"nwn"` | local / regional / national |
| `ref` | `"42"` | ITC trail number |
| `description` | `"נחל כידוד מסלול מעגלי"` | Often Hebrew only |
| `distance` | `"8.5"` or `"8.5 km"` | Strip "km", parse float |
| `operator` | `"itc"` | Israel Trail Committee |

**Color parsing from `osmc:symbol`:**
Format is `foreground:background:overlay[:text]`.
Split on `:`, check each segment's first `_`-delimited word against known colors.
Known colors: `red`, `blue`, `green`, `black`, `orange`, `white`, `yellow`.

---

## 3. Overpass API (geometry)
**Run only when `distance` tag is absent.**

```
POST https://overpass-api.de/api/interpreter
body: [out:json];relation({OSM_ID});way(r);out geom;
```

Collect all `geometry` nodes across all ways → flat list of `(lat, lon)`.

**Distance:** Haversine sum across consecutive pairs.
```
R = 6,371,000 m
a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2)
d = R · 2 · arcsin(√a)
```

---

## 4. IHM Elevation API
**No API key required.**

```
GET https://israelhiking.osm.org.il/api/elevation?points={lat,lng|lat,lng|...}
```

- Pipe-separated `lat,lng` pairs (URL-encode the `|`)
- Max ~20 points per call
- Response: JSON array of elevation values in metres

**Elevation gain:** Sum of positive consecutive deltas only.

**Difficulty scoring:**
```
score = distance_km + elevation_gain_m / 100
score < 5   → easy
score < 15  → moderate
score ≥ 15  → hard
```
