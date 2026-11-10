import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type CachedWeather = {
  latitude: number;
  longitude: number;
  temperature: number | null;
  weather_code: number | null;
  fetched_at: string | null;
  refresh_until: string | null;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const STALE_TTL_MS = 2 * 60 * 60 * 1000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function cachedResponse(row: CachedWeather, stale = false) {
  return json({
    temperature: row.temperature,
    weatherCode: row.weather_code,
    cached: true,
    ...(stale ? { stale: true } : {}),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let latitude: number;
  let longitude: number;
  try {
    const body = await req.json();
    latitude = Number(body?.latitude);
    longitude = Number(body?.longitude);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return json({ error: "Invalid coordinates" }, 400);
  }

  const lat = Number(latitude.toFixed(3));
  const lon = Number(longitude.toFixed(3));
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing server-side Supabase environment configuration");
    return json({ error: "Weather temporarily unavailable" }, 503);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: cached, error: readError } = await db
    .from("sector_weather_cache")
    .select("latitude,longitude,temperature,weather_code,fetched_at,refresh_until")
    .eq("latitude", lat)
    .eq("longitude", lon)
    .maybeSingle();

  if (readError) {
    console.error("Weather cache read failed:", readError.message);
    return json({ error: "Weather temporarily unavailable" }, 503);
  }

  const now = Date.now();
  const cachedAt = cached?.fetched_at ? new Date(cached.fetched_at).getTime() : 0;
  if (cached && cached.temperature !== null && cached.weather_code !== null &&
      cachedAt > 0 && now - cachedAt < CACHE_TTL_MS) {
    return cachedResponse(cached as CachedWeather);
  }

  const { data: claimed, error: claimError } = await db.rpc("claim_sector_weather_refresh", {
    p_latitude: lat,
    p_longitude: lon,
  });

  if (claimError) {
    console.error("Weather refresh claim failed:", claimError.message);
    return cached && cached.temperature !== null &&
      cachedAt > 0 && now - cachedAt < STALE_TTL_MS
      ? cachedResponse(cached as CachedWeather, true)
      : json({ error: "Weather temporarily unavailable" }, 503);
  }

  if (claimed !== true) {
    if (cached && cached.temperature !== null && cached.weather_code !== null &&
        cachedAt > 0 && now - cachedAt < STALE_TTL_MS) {
      return cachedResponse(cached as CachedWeather, true);
    }
    return json({ error: "Weather is being refreshed" }, 503);
  }

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,weather_code",
      timezone: "auto",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(7000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);

    const payload = await response.json();
    const temperature = Number(payload?.current?.temperature_2m);
    const weatherCode = Number(payload?.current?.weather_code);
    if (!Number.isFinite(temperature) || !Number.isInteger(weatherCode) || weatherCode < 0) {
      throw new Error("Weather provider returned invalid data");
    }

    const fetchedAt = new Date().toISOString();
    const { error: writeError } = await db.from("sector_weather_cache").upsert({
      latitude: lat,
      longitude: lon,
      temperature,
      weather_code: weatherCode,
      fetched_at: fetchedAt,
      refresh_until: null,
    }, { onConflict: "latitude,longitude" });

    if (writeError) throw new Error(`Weather cache write failed: ${writeError.message}`);
    return json({ temperature, weatherCode, cached: false });
  } catch (error) {
    console.error("Weather provider request failed:", error);
    await db.from("sector_weather_cache")
      .update({ refresh_until: null })
      .eq("latitude", lat)
      .eq("longitude", lon);

    if (cached && cached.temperature !== null && cached.weather_code !== null &&
        cachedAt > 0 && Date.now() - cachedAt < STALE_TTL_MS) {
      return cachedResponse(cached as CachedWeather, true);
    }
    return json({ error: "Weather temporarily unavailable" }, 502);
  }
});
