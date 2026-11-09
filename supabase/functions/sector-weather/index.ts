import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Weather = { temperature: number; weatherCode: number; fetchedAt: number };

const cache = new Map<string, Weather>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const STALE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
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

  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) {
    return json({ error: "Invalid coordinates" }, 400);
  }

  const lat = Number(latitude.toFixed(3));
  const lon = Number(longitude.toFixed(3));
  const key = `${lat},${lon}`;
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return json({ temperature: cached.temperature, weatherCode: cached.weatherCode, cached: true });
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
      headers: { "Accept": "application/json" },
    });
    if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);

    const payload = await response.json();
    const temperature = Number(payload?.current?.temperature_2m);
    const weatherCode = Number(payload?.current?.weather_code);
    if (
      !Number.isFinite(temperature) ||
      !Number.isInteger(weatherCode) || weatherCode < 0
    ) {
      throw new Error("Weather provider returned invalid data");
    }

    const value = { temperature, weatherCode, fetchedAt: now };
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, value);
    return json({ temperature, weatherCode, cached: false });
  } catch (error) {
    if (cached && now - cached.fetchedAt < STALE_TTL_MS) {
      return json({
        temperature: cached.temperature,
        weatherCode: cached.weatherCode,
        cached: true,
        stale: true,
      });
    }
    console.error("Weather provider request failed:", error);
    return json({ error: "Weather temporarily unavailable" }, 502);
  }
});
