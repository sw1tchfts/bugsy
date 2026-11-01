import { describe, expect, it } from "vitest";
import { driveMinutes, miles } from "@/lib/routing/geo";
import { type Stop, assignDay, estimates, optimizeDay, rankFillIns, routeMiles } from "@/lib/routing/optimize";

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

  it("flags a morning stop the estimate reaches after noon", () => {
    const long = [stop("a", 39.96, -83.0, { duration_minutes: 240 }), stop("b", 39.97, -83.0, { window: "morning" })];
    const eta = estimates(branch, long, settings);
    expect(eta[1].missed).toBe(true);
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
