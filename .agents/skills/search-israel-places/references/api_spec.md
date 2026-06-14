# Google Places API (New) — Reference

## Endpoint
`POST https://places.googleapis.com/v1/places:searchText`

## Authentication
Pass the API key via the `X-Goog-Api-Key` header. The key must have the **Places API (New)** enabled in Google Cloud Console.

## Request body fields

| Field | Type | Notes |
|---|---|---|
| `textQuery` | string | Full-text search query, e.g. "restaurants in Golan Heights" |
| `pageSize` | int | Max results (1–20, default 20) |
| `languageCode` | string | `"en"` for English results |
| `regionCode` | string | `"IL"` biases results toward Israel |
| `locationBias.circle` | object | Optional: center `{latitude, longitude}` + `radius` in meters |

## Field mask
Control which fields are returned via the `X-Goog-FieldMask` header. Only request what you need — each field costs quota.

The script requests:
```
places.displayName, places.formattedAddress, places.rating,
places.userRatingCount, places.regularOpeningHours, places.types,
places.location, places.priceLevel, places.websiteUri,
places.editorialSummary, places.internationalPhoneNumber, places.googleMapsUri
```

## Price levels
| API value | Meaning |
|---|---|
| `PRICE_LEVEL_FREE` | Free |
| `PRICE_LEVEL_INEXPENSIVE` | ₪ (budget) |
| `PRICE_LEVEL_MODERATE` | ₪₪ (mid-range) |
| `PRICE_LEVEL_EXPENSIVE` | ₪₪₪ (upscale) |
| `PRICE_LEVEL_VERY_EXPENSIVE` | ₪₪₪₪ (luxury) |

## Manual API call (if script fails)
```python
import json, urllib.request

api_key = "YOUR_KEY"
body = {"textQuery": "restaurants in Katzrin", "pageSize": 5, "languageCode": "en", "regionCode": "IL"}
req = urllib.request.Request(
    "https://places.googleapis.com/v1/places:searchText",
    data=json.dumps(body).encode(),
    method="POST",
    headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.formattedAddress",
    }
)
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
```

## Common errors
| HTTP | Meaning |
|---|---|
| 400 | Bad request — check field mask syntax |
| 403 | API key invalid or Places API not enabled |
| 429 | Quota exceeded |

## Getting an API key
1. Go to https://console.cloud.google.com/
2. Enable "Places API (New)"
3. Create credentials → API key
4. Add to `.env` as `GOOGLE_PLACES_API_KEY=...`
