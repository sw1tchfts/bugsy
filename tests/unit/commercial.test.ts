import { strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { binderFiles, esc } from "@/lib/commercial/binder";
import type { BinderData } from "@/lib/commercial/db";
import { checkProblems, devicesAsOf, hasActivity, hotDevices, trend, uncheckedDevices, validPosition } from "@/lib/commercial/devices";
import { floorPlan, imageInfo } from "@/lib/commercial/image";
import { devicesLeft, gapsFor } from "@/lib/tech/gaps";
import type { RouteVisit } from "@/lib/tech/route-types";

const check = (device_id: string, checked_at: string, extra: Partial<{ status: string; activity: string | null; count: number | null; bait_consumed_pct: number | null }> = {}) => ({
  device_id,
  checked_at,
  status: "checked",
  activity: "none",
  count: 0,
  bait_consumed_pct: null,
  ...extra,
});

describe("device activity and hot devices (spec 14 rule 5)", () => {
  it("counts activity seen, something caught or bait eaten, and only on a checked device", () => {
    expect(hasActivity(check("a", "2027-01-01"))).toBe(false);
    expect(hasActivity(check("a", "2027-01-01", { activity: "low" }))).toBe(true);
    expect(hasActivity(check("a", "2027-01-01", { count: 2 }))).toBe(true);
    expect(hasActivity(check("a", "2027-01-01", { bait_consumed_pct: 25 }))).toBe(true);
    expect(hasActivity(check("a", "2027-01-01", { status: "missing", activity: "high" }))).toBe(false);
  });

  it("marks a device hot with activity on two of its last three checks, whatever came before", () => {
    const checks = [
      check("a", "2027-01-10", { count: 1 }),
      check("a", "2027-02-10"),
      check("a", "2027-03-10", { activity: "medium" }),
      check("a", "2027-04-10", { count: 3 }),
      check("b", "2027-01-10", { count: 1 }),
      check("b", "2027-02-10", { count: 1 }),
      check("b", "2027-03-10"),
      check("b", "2027-04-10"),
      check("c", "2027-04-10", { count: 1 }),
    ];
    expect([...hotDevices(checks)].sort()).toEqual(["a"]);
    // The last three checks count however far apart they are.
    const sparse = [
      { device_id: "z", checked_at: "2027-03-01T10:00:00Z", status: "checked", activity: "low", count: null, bait_consumed_pct: null },
      { device_id: "z", checked_at: "2026-12-01T10:00:00Z", status: "checked", activity: "none", count: null, bait_consumed_pct: null },
      { device_id: "z", checked_at: "2026-08-01T10:00:00Z", status: "checked", activity: "none", count: 3, bait_consumed_pct: null },
    ];
    expect(hotDevices(sparse).has("z")).toBe(true);
  });
});

describe("the device gate (spec 14 rule 4)", () => {
  const devices = [
    { id: "1", kind: "bait_station", status: "active" },
    { id: "2", kind: "multi_catch", status: "active" },
    { id: "3", kind: "termite_station", status: "active" },
    { id: "4", kind: "bait_station", status: "removed" },
  ];
  it("asks for every active device of the visit's kinds, and nothing when the type checks no devices", () => {
    expect(uncheckedDevices(devices, new Set(), ["bait_station", "multi_catch"]).map((d) => d.id)).toEqual(["1", "2"]);
    expect(uncheckedDevices(devices, new Set(["1"]), ["bait_station", "multi_catch"]).map((d) => d.id)).toEqual(["2"]);
    expect(uncheckedDevices(devices, new Set(), [])).toEqual([]);
  });

  it("needs a note when a device was not checked, and sane numbers", () => {
    expect(checkProblems({ status: "checked", notes: null, count: 2, bait_consumed_pct: 50 })).toEqual([]);
    expect(checkProblems({ status: "inaccessible", notes: " ", count: null, bait_consumed_pct: null })).toEqual(["Say why the device was not checked."]);
    expect(checkProblems({ status: "checked", notes: null, count: -1, bait_consumed_pct: 120 })).toHaveLength(2);
  });

  it("puts the devices gap on a stop until every device has an answer, counting one added at the stop", () => {
    const visit = {
      job_kind: "device_service",
      captured: { device_checks: [{ device_id: "1" }], products: [], notes: [], photos: [], arrived_at: "2027-01-01T10:00:00Z" },
      site: {
        kinds: ["bait_station", "multi_catch"],
        devices: [
          { id: "1", kind: "bait_station", status: "active" },
          { id: "new", kind: "multi_catch", status: "active" },
          { id: "4", kind: "bait_station", status: "removed" },
        ],
      },
    } as unknown as RouteVisit;
    expect(devicesLeft(visit).map((d) => d.id)).toEqual(["new"]);
    const crew = [{ user_id: "u", name: "Sam", role: "lead", credential: { cert_number: "1", categories: [], trainee: false, cert_expires_on: null } }];
    const full = { ...visit, crew, treatment_areas: [], property: { address: "x", state: "OH" }, service_type: { name: "s" }, required_fields: [], scheduled_for: "2027-01-01", captured: { ...visit.captured, departed_at: null, conditions: null, areas_treated: [], target_pests: [], signature: null } } as unknown as RouteVisit;
    expect(gapsFor(full)).toContain("devices");
    expect(gapsFor({ ...full, captured: { ...full.captured, device_checks: [{ device_id: "1" }, { device_id: "new" }] } } as unknown as RouteVisit)).not.toContain("devices");
  });

  it("takes a map position as a pair of fractions or none", () => {
    expect(validPosition(null, null)).toBe(true);
    expect(validPosition(0.5, 0.25)).toBe(true);
    expect(validPosition(0.5, null)).toBe(false);
    expect(validPosition(1.2, 0.5)).toBe(false);
  });
});

describe("the trend (spec 14 rule 6)", () => {
  it("counts devices checked and devices with activity per month and kind, with the captures", () => {
    const rows = trend([
      { month: "2027-01", kind: "multi_catch", device_id: "a", status: "checked", activity: "none", count: 0, bait_consumed_pct: null },
      { month: "2027-01", kind: "multi_catch", device_id: "b", status: "checked", activity: "low", count: 2, bait_consumed_pct: null },
      { month: "2027-01", kind: "multi_catch", device_id: "c", status: "inaccessible", activity: null, count: null, bait_consumed_pct: null },
      { month: "2027-02", kind: "insect_light_trap", device_id: "i", status: "checked", activity: "none", count: 7, bait_consumed_pct: null },
    ]);
    expect(rows).toEqual([
      { month: "2027-01", kind: "multi_catch", checked: 2, active: 1, rate: 0.5, captures: 2 },
      { month: "2027-02", kind: "insect_light_trap", checked: 1, active: 1, rate: 1, captures: 7 },
    ]);
  });

  it("counts a device checked every week once in its month", () => {
    const weekly = (device_id: string, active: number[]) =>
      [0, 1, 2, 3].map((w) => ({ month: "2027-03", kind: "multi_catch", device_id, status: "checked", activity: active.includes(w) ? "low" : "none", count: active.includes(w) ? 1 : 0, bait_consumed_pct: null }));
    const [row] = trend([...weekly("a", [2]), ...weekly("b", [])]);
    expect(row).toEqual({ month: "2027-03", kind: "multi_catch", checked: 2, active: 1, rate: 0.5, captures: 1 });
  });
});

describe("devices as they stood on a date (spec 14 rule 2)", () => {
  const base = { barcode: null, kind: "bait_station", zone: "exterior", removed_reason: null };
  const devices = [
    { ...base, id: "s1", number: "1", location: "North fence", map_id: "m", x: 0.9, y: 0.1, status: "active", installed_on: "2026-01-05", removed_on: null },
    { ...base, id: "s7", number: "7", location: "Dock", map_id: "m", x: 0.5, y: 0.5, status: "removed", installed_on: "2026-01-05", removed_on: "2026-06-10", removed_reason: "Dock rebuilt" },
    { ...base, id: "s9", number: "9", location: "Gate", map_id: "m", x: 0.2, y: 0.2, status: "active", installed_on: "2026-07-01", removed_on: null },
  ];
  const events = [
    { device_id: "s1", kind: "installed", on: "2026-11-01", after: { number: "1", location: "West wall", zone: "exterior", map_id: "m", x: 0.1, y: 0.4 } },
    { device_id: "s7", kind: "installed", on: "2026-11-01", after: { number: "7", location: "Dock", zone: "exterior", map_id: "m", x: 0.5, y: 0.5 } },
    { device_id: "s1", kind: "moved", on: "2026-04-02", after: { number: "1", location: "North fence", zone: "exterior", map_id: "m", x: 0.9, y: 0.1 } },
    { device_id: "s7", kind: "removed", on: "2026-06-10", after: { status: "removed" } },
    { device_id: "s9", kind: "installed", on: "2026-11-01", after: { number: "9", location: "Gate", zone: "exterior", map_id: "m", x: 0.2, y: 0.2 } },
  ].sort((a, b) => (a.kind === "installed" ? -1 : 1) - (b.kind === "installed" ? -1 : 1));

  it("shows the first quarter's stations at their first-quarter places, before later changes", () => {
    const q1 = devicesAsOf(devices, events, "2026-01-01", "2026-03-31");
    expect(q1.map((d) => d.id)).toEqual(["s1", "s7"]);
    expect(q1.find((d) => d.id === "s1")).toMatchObject({ location: "West wall", x: 0.1, y: 0.4, status: "active" });
    expect(q1.find((d) => d.id === "s7")).toMatchObject({ status: "active", removed_on: null });
  });

  it("marks a device removed in the range and leaves out one removed before it", () => {
    const q2 = devicesAsOf(devices, events, "2026-04-01", "2026-06-30");
    expect(q2.find((d) => d.id === "s7")).toMatchObject({ status: "removed", removed_on: "2026-06-10" });
    expect(q2.find((d) => d.id === "s1")).toMatchObject({ location: "North fence" });
    expect(devicesAsOf(devices, events, "2026-07-01", "2026-09-30").map((d) => d.id)).toEqual(["s1", "s9"]);
  });
});

describe("floor plans are raster images read from their bytes (spec 14 rule 12)", () => {
  it("reads a PNG's size and refuses an SVG or HTML file", async () => {
    const png = await floorPlan(120, 80);
    expect(imageInfo(png)).toEqual({ type: "image/png", width: 120, height: 80 });
    expect(imageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(imageInfo(new TextEncoder().encode("<html><body>hi</body></html>"))).toBeNull();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0, 0, 0, 0]);
    expect(imageInfo(jpeg)).toEqual({ type: "image/jpeg", width: 600, height: 300 });
  });
});

describe("the audit binder (spec 14 rule 10)", () => {
  const data = {
    property: { id: "p", address: "250 HIGH ST", state_code: "OH", account_id: "a", account_name: "Riverside <Grill> & Bar" },
    maps: [{ id: "m", name: "Ground floor", file_id: "f", width: 800, height: 500, position: 1 }],
    devices: [
      { id: "d1", number: "6", barcode: "NW-0006", kind: "multi_catch", zone: "interior", location: "Under the dish machine", map_id: "m", x: 0.4, y: 0.7, status: "active", installed_on: "2027-01-01", removed_on: null, removed_reason: null },
      { id: "d2", number: "9", barcode: null, kind: "bait_station", zone: "exterior", location: "Dock", map_id: null, x: null, y: null, status: "removed", installed_on: "2027-01-01", removed_on: "2027-03-01", removed_reason: "Dock rebuilt" },
    ],
    checks: [{ id: "c1", device_id: "d1", number: "6", kind: "multi_catch", visit_id: "v", checked_at: new Date("2027-03-10T15:00:00Z"), checked_by_name: "Sam Rivera", source: "technician", status: "checked", activity: "medium", count: 2, bait_consumed_pct: null, pest: "house mouse", actions: ["cleaned"], notes: "<b>droppings</b>" }],
    events: [],
    sightings: [],
    recommendations: [{ id: "r", created_at: new Date("2027-03-10T15:00:00Z"), category: "exclusion", description: "Seal the dock gap", responsibility: "customer", priority: "high", owner_name: "Facilities", due_on: "2027-04-01", status: "open", closed_on: null, closed_note: null, visit_id: null }],
    documents: [],
    hot: new Set(["d1"]),
    trend: [{ month: "2027-03", kind: "multi_catch", checked: 1, active: 1, rate: 1, captures: 2 }],
    company: { name: "Northwind", legal_name: "Northwind Pest Control LLC", licenses: [{ branch: "Main", number: "BL-1", expires: null }] },
    applicators: [{ name: "Sam Rivera", cert_number: "OH-1042", categories: ["7A"], expires: "2028-01-01" }],
    applications: [{ business_date: "2027-03-10", product: "Bait block", epa_reg_no: "12455-1", amount: "2", unit: "oz", site_treated: "bait stations", target_pests: ["house mouse"], applicator: "Sam Rivera" }],
    visits: [{ id: "v", date: "2027-03-10", service: "Commercial device service", technician: "Sam Rivera" }],
    range: { from: "2027-01-01", to: "2027-03-31" },
    time_zone: "America/Chicago",
    made_at: new Date("2027-04-01T12:00:00Z"),
  } as unknown as BinderData;

  it("escapes every value and holds the sections an auditor asks for", () => {
    const files = binderFiles(data, new Map([["f", { type: "image/png", base64: "AAAA" }]]));
    const html = strFromU8(files["binder.html"]);
    expect(html).toContain("Riverside &lt;Grill&gt; &amp; Bar");
    expect(html).not.toContain("<b>droppings</b>");
    expect(html).toContain("&lt;b&gt;droppings&lt;/b&gt;");
    for (const section of ["Device maps", "Devices (1 active)", "Device checks", "Activity trend", "Recommendations and corrective actions", "Pesticide applications", "Applicators who serviced the site"]) expect(html).toContain(section);
    expect(html).toContain('href="data:image/png;base64,AAAA"');
    expect(html).toContain("#d03b3b");
    expect(strFromU8(files["devices.csv"]).split("\r\n")[2]).toContain("Dock rebuilt");
    expect(strFromU8(files["device_checks.csv"])).toContain("house mouse");
    expect(strFromU8(files["applications.csv"])).toContain("12455-1");
    // Times print in the company's zone: 15:00 UTC on March 10, 2027 is 09:00 in Chicago (standard time until March 14).
    expect(strFromU8(files["device_checks.csv"])).toContain("2027-03-10 09:00 CST");
    expect(esc(`"'`)).toBe("&quot;&#39;");
  });
});
