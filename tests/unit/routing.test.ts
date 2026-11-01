import { describe, expect, it } from "vitest";
import { driveMinutes, miles } from "@/lib/routing/geo";
import { type Stop, assignDay, bestInsertion, estimates, optimizeDay, rankFillIns, routeBox, routeMiles } from "@/lib/routing/optimize";

const branch = { lat: 39.96, lng: -83.0 };
const stop = (id: string, lat: number | null, lng: number | null, over: Partial<Stop> = {}): Stop => ({ id, lat, lng, window: "any", duration_minutes: 30, started: false, position: 1, ...over });
const settings = { mph: 25, day_start: "08:00", morning_ends: "12:00", afternoon_ends: "17:00" };

describe("distance (spec 19 rule 1)", () => {
  it("measures great-circle miles and rounds drive time up", () => {
    expect(miles({ lat: 39.96, lng: -83 }, { lat: 39.96, lng: -83 })).toBe(0);
    expect(miles({ lat: 40, lng: -83 }, { lat: 41, lng: -83 })).toBeCloseTo(69.1, 1);
    expect(driveMinutes(10, 25)).toBe(24);
    expect(driveMinutes(10.01, 25)).toBe(25);
  });
});

describe("optimizing a day (spec 19 rules 2 and 3)", () => {
  // A zigzag: east, west, east, west along one street.
  const zig = [stop("a", 39.96, -82.9, { position: 1 }), stop("b", 39.96, -83.08, { position: 2 }), stop("c", 39.96, -82.94, { position: 3 }), stop("d", 39.96, -83.04, { position: 4 })];

  it("cuts the miles of a crossed route", () => {
    const before = routeMiles(branch, zig);
    const after = optimizeDay(branch, zig);
    expect(routeMiles(branch, after)).toBeLessThan(before);
    expect(after.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it("keeps morning stops first and evening last, and started stops where they are", () => {
    const day = [
      stop("pm", 39.96, -82.95, { window: "afternoon", position: 1 }),
      stop("am", 39.96, -83.07, { window: "morning", position: 2 }),
      stop("eve", 39.96, -83.01, { window: "evening", position: 3 }),
      stop("any", 39.96, -82.99, { position: 4 }),
    ];
    const order = optimizeDay(branch, day).map((s) => s.id);
    expect(order[0]).toBe("am");
    expect(order[order.length - 1]).toBe("eve");
    const started = optimizeDay(branch, [stop("done", 39.96, -82.9, { started: true, position: 1 }), ...day.map((s) => ({ ...s, position: s.position + 1 }))]);
    expect(started[0].id).toBe("done");
  });

  it("places a stop without coordinates last in its group and still estimates the day", () => {
    const order = optimizeDay(branch, [stop("x", null, null, { position: 1 }), stop("y", 39.97, -83.0, { position: 2 })]).map((s) => s.id);
    expect(order).toEqual(["y", "x"]);
    const eta = estimates(branch, optimizeDay(branch, [stop("y", 39.97, -83.0), stop("x", null, null)]), settings);
    expect(eta[0].arrive).toBe("08:02");
    expect(eta[1]).toMatchObject({ no_location: true, arrive: "08:32" });
  });

  it("flags a morning stop the estimate reaches after noon, and an afternoon stop reached after its close", () => {
    const long = [stop("a", 39.96, -83.0, { duration_minutes: 240 }), stop("b", 39.97, -83.0, { window: "morning" })];
    const eta = estimates(branch, long, settings);
    expect(eta[1].missed).toBe(true);
    const late = estimates(branch, [stop("a", 39.96, -83.0, { duration_minutes: 560 }), stop("pm", 39.97, -83.0, { window: "afternoon" })], settings);
    expect(late[1]).toMatchObject({ missed: true });
  });

  it("waits for a window that has not opened: an afternoon stop is never estimated before noon", () => {
    const eta = estimates(branch, [stop("pm", 39.97, -83.0, { window: "afternoon" }), stop("eve", 39.98, -83.0, { window: "evening" })], settings);
    expect(eta[0]).toMatchObject({ arrive: "12:00", missed: false });
    expect(eta[0].wait_minutes).toBeGreaterThan(200);
    expect(eta[1]).toMatchObject({ arrive: "17:00", missed: false });
  });

  it("starts the estimate from the last stop the technician reached (rule 3)", () => {
    const day = [
      stop("done", 39.96, -83.0, { started: true, position: 1, arrived_min: 13 * 60, departed_min: 15 * 60 + 20 }),
      stop("next", 39.97, -83.0, { position: 2 }),
    ];
    const eta = estimates(branch, day, settings);
    expect(eta[0].arrive).toBe("13:00");
    expect(eta[1].arrive).toBe("15:22");
    // A stop the technician is on now: the next one follows its real arrival plus the service time.
    const onSite = estimates(branch, [{ ...day[0], departed_min: null }, day[1]], settings);
    expect(onSite[1].arrive).toBe("13:32");
  });

  it("never brings an afternoon stop into the morning to save miles (edge case: a window is never moved out)", () => {
    // Six "any" stops to the east, an afternoon stop beside the branch: the short path visits it first, but it opens at noon.
    const east = Array.from({ length: 6 }, (_, i) => stop(`e${i}`, 39.96 + 0.002 * i, -82.95 + 0.004 * i, { position: i + 2 }));
    const day = [stop("pm", 39.961, -83.0, { window: "afternoon", position: 1 }), ...east];
    const order = optimizeDay(branch, day, settings);
    const eta = estimates(branch, order, settings);
    const pm = eta.find((e) => e.id === "pm");
    expect((pm?.arrive ?? "") >= "12:00").toBe(true);
    expect(order[order.length - 1].id).toBe("pm");
    expect(eta.every((e) => !e.missed)).toBe(true);
  });

  it("still cuts the miles before an afternoon stop that has to wait for noon", () => {
    // The seeded demo day: far east (morning), far west, near east, near west (afternoon).
    const day = [
      stop("eastgate", 39.96, -82.91, { window: "morning", position: 1 }),
      stop("westgate", 39.963, -83.08, { position: 2 }),
      stop("eastview", 39.966, -82.96, { position: 3 }),
      stop("westview", 39.969, -83.035, { window: "afternoon", position: 4 }),
    ];
    const order = optimizeDay(branch, day, settings);
    expect(routeMiles(branch, order)).toBeLessThan(routeMiles(branch, day));
    expect(order[0].id).toBe("eastgate");
    expect(order[order.length - 1].id).toBe("westview");
  });

  it("leaves a one-stop day as it is, does nothing with an empty day, and starts from the first stop without branch coordinates", () => {
    expect(optimizeDay(branch, [stop("only", 39.97, -83.0, { position: 1 })]).map((s) => s.id)).toEqual(["only"]);
    expect(optimizeDay(branch, [])).toEqual([]);
    const noBranch = optimizeDay(null, [stop("a", 39.96, -82.9, { position: 1 }), stop("b", 39.96, -83.08, { position: 2 }), stop("c", 39.96, -82.94, { position: 3 })]);
    expect(routeMiles(null, noBranch)).toBeLessThanOrEqual(routeMiles(null, [stop("a", 39.96, -82.9), stop("b", 39.96, -83.08), stop("c", 39.96, -82.94)]));
    expect(estimates(null, noBranch, settings)[0].arrive).toBe("08:00");
  });
});

describe("assigning and filling a day (spec 19 rules 4 and 5)", () => {
  const techs = [
    { id: "east", start: { lat: 39.96, lng: -82.9 }, stops: [] as Stop[] },
    { id: "west", start: { lat: 39.96, lng: -83.1 }, stops: [] as Stop[] },
  ];
  const visit = (id: string, lng: number) => ({ ...stop(id, 39.96, lng), visit_id: id });

  it("puts each visit with the technician it adds the fewest miles for, within what the check allows", () => {
    const { placements, unplaced } = assignDay(techs, [visit("v1", -82.91), visit("v2", -83.09), visit("v3", -82.92)], () => true, settings);
    const byVisit = Object.fromEntries(placements.map((p) => [p.visit_id, p.technician_id]));
    expect(byVisit).toMatchObject({ v1: "east", v2: "west", v3: "east" });
    expect(unplaced).toEqual([]);
  });

  it("balances a heavy day and lists what no one may take", () => {
    const loaded = [{ ...techs[0], stops: [stop("busy", 39.96, -82.9, { duration_minutes: 480 })] }, techs[1]];
    const { placements } = assignDay(loaded, [visit("v1", -82.95)], () => true, settings);
    expect(placements[0].technician_id).toBe("west");
    const refused = assignDay(techs, [visit("v1", -82.91)], (_v, t) => t !== "east" && t !== "west", settings);
    expect(refused.unplaced).toEqual(["v1"]);
  });

  it("inserts a visit without reordering the day, after started stops and inside its window group", () => {
    const day = [
      stop("done", 39.96, -82.95, { started: true, position: 1, arrived_min: 480, departed_min: 510 }),
      stop("am", 39.96, -83.05, { window: "morning", position: 2 }),
      stop("pm", 39.96, -82.96, { window: "afternoon", position: 3 }),
    ];
    // Beside the started stop, but the morning stop cannot be pushed after it: it goes after the morning group.
    const ins = bestInsertion(branch, day, stop("new", 39.96, -82.951), settings);
    expect(ins?.index).toBe(2);
    const { placements } = assignDay([{ id: "t", start: branch, stops: day }], [{ ...stop("new", 39.96, -82.951), visit_id: "new" }], () => true, settings);
    expect(placements[0]).toMatchObject({ technician_id: "t", position: 3 });
  });

  it("gives no technician more than the day's stop limit, and keeps a full window unmoved", () => {
    const full = [{ ...techs[0], stops: [stop("s1", 39.96, -82.9), stop("s2", 39.96, -82.91, { position: 2 })] }];
    const r = assignDay(full, [visit("v1", -82.91)], () => true, settings, 4, 2);
    expect(r.unplaced).toEqual(["v1"]);
    expect(r.blocked.v1).toBe("full");
    // A morning stop that runs to 11:55 leaves no room for a four-hour morning visit before or after it.
    const tight = [{ ...techs[0], stops: [stop("m", 39.96, -82.9, { window: "morning", duration_minutes: 235 })] }];
    const w = assignDay(tight, [{ ...visit("v2", -82.95), window: "morning" as const, duration_minutes: 240 }], () => true, settings);
    expect(w.blocked.v2).toBe("window");
  });

  it("ranks due visits before pull-forwards, by detour, and drops far pull-forwards", () => {
    const day = [stop("a", 39.96, -83.0)];
    const ranked = rankFillIns(branch, day, [
      { ...visit("far-due", -82.5), kind: "due" as const },
      { ...visit("near-due", -83.01), kind: "due" as const },
      { ...visit("near-pull", -83.02), kind: "pull_forward" as const },
      { ...visit("far-pull", -82.0), kind: "pull_forward" as const },
    ], 5);
    expect(ranked.map((r) => r.visit_id)).toEqual(["near-due", "far-due", "near-pull"]);
  });
});

describe("the fill-in prefilter (spec 19 rule 5)", () => {
  it("holds every point within the radius of the route", () => {
    const box = routeBox(branch, [stop("a", 40.0, -83.1)], 5);
    expect(box).not.toBeNull();
    const north = { lat: 40.0 + 4.9 / 69, lng: -83.1 };
    expect(north.lat).toBeLessThan(box?.maxLat ?? 0);
    expect(miles({ lat: 40, lng: (box?.minLng ?? 0) }, { lat: 40, lng: -83.1 })).toBeGreaterThanOrEqual(5 - 0.01);
    expect(routeBox(null, [stop("x", null, null)], 5)).toBeNull();
  });
});
