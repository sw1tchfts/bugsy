// Current conditions at a location for the application record. Open-Meteo needs no key; a failure returns null and
// the technician types the conditions instead. Which conditions a state requires is the pack's business (spec 06 rule 7).

export type Conditions = {
  temperature_f: number | null;
  wind_mph: number | null;
  wind_direction: string | null;
  sky: string | null;
  captured_at: string;
  source: "weather" | "manual";
};

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compassDirection(degrees: number): string {
  return DIRECTIONS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/** WMO weather interpretation codes, as Open-Meteo reports them, in plain words. */
export function skyFromCode(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

type OpenMeteo = { current?: { temperature_2m?: number; wind_speed_10m?: number; wind_direction_10m?: number; weather_code?: number; time?: string } };

/** Turns an Open-Meteo answer into conditions; exported so the parsing is testable without the network. */
export function parseOpenMeteo(body: unknown, capturedAt: string): Conditions | null {
  const current = (body as OpenMeteo)?.current;
  if (!current || typeof current.temperature_2m !== "number") return null;
  return {
    temperature_f: Math.round(current.temperature_2m * 10) / 10,
    wind_mph: typeof current.wind_speed_10m === "number" ? Math.round(current.wind_speed_10m * 10) / 10 : null,
    wind_direction: typeof current.wind_direction_10m === "number" ? compassDirection(current.wind_direction_10m) : null,
    sky: skyFromCode(current.weather_code),
    captured_at: capturedAt,
    source: "weather",
  };
}

export async function currentConditions(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<Conditions | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("current", "temperature_2m,wind_speed_10m,wind_direction_10m,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return parseOpenMeteo(await res.json(), new Date().toISOString());
  } catch {
    return null;
  }
}
