import { describe, expect, it } from "vitest";
import { intakeProblems, readIntake } from "@/lib/portal/intake";
import { rescheduleDays, rescheduleProblems } from "@/lib/portal/rules";

const settings = { allow_reschedule: true, reschedule_notice_hours: 24, max_stops_per_day: 3 };
const visit = { status: "scheduled", scheduled_for: "2027-03-10", due_start: "2027-03-08", due_end: "2027-03-14", technician_id: "t" };
const now = new Date("2027-03-07T15:00:00Z"); // 9:00 in Chicago on the 7th

describe("the self-service reschedule (spec 16 rule 5)", () => {
  const check = (date: string, over: Partial<Parameters<typeof rescheduleProblems>[0]> = {}) =>
    rescheduleProblems({ visit, date, settings, stops: { "2027-03-12": 3 }, now, timeZone: "America/Chicago", ...over });

  it("allows a day in the window with notice and room on the technician's day", () => {
    expect(check("2027-03-11")).toEqual([]);
  });

  it("refuses outside the window, without notice, onto a full day, or when the company takes moves by request", () => {
    expect(check("2027-03-15")).toEqual(["Pick a day from 2027-03-08 to 2027-03-14."]);
    expect(check("2027-03-08")).toEqual(["Moves need 24 hours notice."]);
    expect(check("2027-03-12")).toEqual(["That day is full."]);
    expect(check("2027-03-11", { settings: { ...settings, allow_reschedule: false } })).toEqual(["The company takes reschedules by request."]);
    expect(check("2027-03-11", { visit: { ...visit, status: "planned" } })).toEqual(["Only a scheduled visit can be moved."]);
    // The old day needs notice too: a visit tomorrow morning cannot be moved tonight.
    expect(check("2027-03-12", { visit: { ...visit, scheduled_for: "2027-03-08" }, stops: {} })).toEqual(["Moves need 24 hours notice."]);
  });

  it("offers every other day of the window from today, with its problems", () => {
    const days = rescheduleDays({ visit, settings, stops: { "2027-03-12": 3 }, now, timeZone: "America/Chicago" });
    expect(days.map((d) => d.date)).toEqual(["2027-03-08", "2027-03-09", "2027-03-11", "2027-03-12", "2027-03-13", "2027-03-14"]);
    expect(days.find((d) => d.date === "2027-03-12")?.problems).toEqual(["That day is full."]);
  });
});

describe("the booking form's intake (spec 16 rule 8)", () => {
  const form = { services: [{ id: "11111111-1111-1111-1111-111111111111" }], ask_preferred_date: true };
  const good = { name: " Pat Doe ", email: "PAT@Example.com", line1: "1 Main St", state_code: "oh", service_type_id: form.services[0].id, preferred_date: "2027-03-12", sms_consent: "on" };

  it("trims, lowercases the email, uppercases the state and reads the consent box", () => {
    const p = readIntake(good);
    expect(p).toMatchObject({ name: "Pat Doe", email: "pat@example.com", state_code: "OH", arrival_window: "any", sms_consent: true });
    expect(intakeProblems(p, form, "2027-03-07")).toEqual([]);
  });

  it("needs a name, a way to reach the person, an address and a listed service", () => {
    expect(intakeProblems(readIntake({}), form, "2027-03-07")).toEqual(["Your name is needed.", "An email or a phone number is needed.", "The service address is needed.", "Pick a service from the list."]);
    expect(intakeProblems(readIntake({ ...good, email: "not-an-email" }), form, "2027-03-07")).toContain("That email does not look right.");
    expect(intakeProblems(readIntake({ ...good, preferred_date: "2027-03-01" }), form, "2027-03-07")).toContain("The preferred day has passed.");
    expect(intakeProblems(readIntake({ ...good, service_type_id: "22222222-2222-2222-2222-222222222222" }), form, "2027-03-07")).toContain("Pick a service from the list.");
    expect(intakeProblems(readIntake({ ...good, email: "", phone: "555-0100" }), form, "2027-03-07")).toEqual([]);
  });

  it("caps every field so nothing oversized reaches the database", () => {
    const p = readIntake({ ...good, message: "x".repeat(5000), name: "y".repeat(500) });
    expect(p.message.length).toBe(2000);
    expect(p.name.length).toBe(200);
  });
});
