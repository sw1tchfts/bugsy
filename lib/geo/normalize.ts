// Pure normalization helpers shared by the geo providers, duplicate matching and tests.

export type AddressInput = {
  line1: string;
  line2?: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
};

const SUFFIXES: Record<string, string> = {
  avenue: "AVE", ave: "AVE", av: "AVE",
  boulevard: "BLVD", blvd: "BLVD",
  circle: "CIR", cir: "CIR",
  court: "CT", ct: "CT",
  drive: "DR", dr: "DR",
  lane: "LN", ln: "LN",
  parkway: "PKWY", pkwy: "PKWY",
  place: "PL", pl: "PL",
  road: "RD", rd: "RD",
  street: "ST", st: "ST",
  terrace: "TER", ter: "TER",
  trail: "TRL", trl: "TRL",
  way: "WAY",
  highway: "HWY", hwy: "HWY",
};

const DIRECTIONS: Record<string, string> = {
  north: "N", south: "S", east: "E", west: "W",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
  n: "N", s: "S", e: "E", w: "W", ne: "NE", nw: "NW", se: "SE", sw: "SW",
};

const UNIT_WORDS: Record<string, string> = {
  apartment: "APT", apt: "APT", suite: "STE", ste: "STE", unit: "UNIT", "#": "UNIT", floor: "FL", fl: "FL", building: "BLDG", bldg: "BLDG",
};

function normalizeWords(line: string): string {
  return line
    .replace(/[.,]/g, " ")
    .replace(/#\s*/g, "# ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return SUFFIXES[lower] ?? DIRECTIONS[lower] ?? UNIT_WORDS[lower] ?? word.toUpperCase();
    })
    .join(" ");
}

/** USPS-style single-line form used for duplicate matching: "100 MAIN ST APT 2B, COLUMBUS OH 43215". */
export function normalizeAddress(address: AddressInput): string {
  const street = [normalizeWords(address.line1), address.line2 ? normalizeWords(address.line2) : ""].filter(Boolean).join(" ");
  const zip = address.postalCode.trim().slice(0, 5);
  return `${street}, ${address.city.trim().toUpperCase()} ${address.stateCode.trim().toUpperCase()} ${zip}`;
}

/** Digits only; the leading 1 of an 11-digit US number is dropped; anything after an extension marker is ignored. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.toLowerCase().split("x")[0].replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function normalizeStateCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim().toUpperCase();
  return trimmed && /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
