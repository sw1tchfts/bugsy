import { describe, expect, it } from "vitest";
import { unusualAmounts } from "@/lib/ai/amounts";
import { churnScore, soundsUnhappy } from "@/lib/ai/churn";
import { CLAUDE_MODEL, type MessagesClient, claudeAi } from "@/lib/ai/claude";
import { localAnswer, localLabelRows, localSummary } from "@/lib/ai/local";
import { buildContext, contextIds } from "@/lib/ai/portal";
import { AiUnavailable, type PortalContext } from "@/lib/ai/types";
import type { Overview } from "@/lib/portal/db";

const quiet = { reservices_90: 0, skipped_180: 0, past_due: false, price_increase_60: false, low_survey_180: null, unhappy_message_60: false, months_active: 30, overdue_visit: false };

describe("churn risk (spec 21 rule 6)", () => {
  it("scores a quiet plan low and adds each signal's points with its reason", () => {
    expect(churnScore(quiet)).toEqual({ score: 0, band: "low", reasons: [] });
    const r = churnScore({ ...quiet, reservices_90: 2, past_due: true, low_survey_180: 4, unhappy_message_60: true });
    expect(r.score).toBe(24 + 20 + 15 + 15);
    expect(r.band).toBe("high");
    expect(r.reasons[0]).toMatchObject({ code: "reservices", points: 24 });
    expect(r.reasons.map((x) => x.code)).toEqual(["reservices", "past_due", "low_survey", "unhappy_message"]);
  });

  it("caps re-services and skips, bands at 30 and 60, and never passes 100", () => {
    expect(churnScore({ ...quiet, reservices_90: 9 }).reasons[0].points).toBe(36);
    expect(churnScore({ ...quiet, skipped_180: 5 }).reasons[0].points).toBe(20);
    expect(churnScore({ ...quiet, months_active: 3, past_due: true }).band).toBe("medium");
    expect(churnScore({ ...quiet, reservices_90: 9, skipped_180: 5, past_due: true, price_increase_60: true, low_survey_180: 1, unhappy_message_60: true, months_active: 1, overdue_visit: true }).score).toBe(100);
  });

  it("hears a customer who may leave", () => {
    expect(soundsUnhappy("Still seeing ants, thinking about cancelling")).toBe(true);
    expect(soundsUnhappy("Please stop service after this month")).toBe(true);
    expect(soundsUnhappy("Thanks, see you in April!")).toBe(false);
  });
});

describe("unusual amounts (spec 21 rule 5)", () => {
  const row = (id: string, amount: number, over = false, applied_at = "2026-10-20T15:00:00Z") => ({ id, product_id: "p", product_name: "Talstar P", site: "perimeter", unit: "fl_oz", amount, over_label: over, applied_at });
  const history = [row("h1", 1), row("h2", 1.2), row("h3", 0.9), row("h4", 1.1), row("h5", 1)];
  it("flags over-label and more than three times the median, with enough history", () => {
    const flags = unusualAmounts(history, [row("a", 3.5), row("b", 2.9), row("c", 0.5, true)]);
    expect(flags.map((f) => [f.id, f.reason])).toEqual([["a", "unusual"], ["c", "over_label"]]);
    expect(flags[0].median).toBe(1);
    expect(unusualAmounts(history.slice(0, 4), [row("a", 9)])).toEqual([]);
  });
});

describe("the local provider (spec 21 rule 8)", () => {
  it("drafts a summary from the capture, in Spanish too", () => {
    const input = { service: "General pest plan", customer_first_name: "Jane", notes: ["sealed two gaps by the garage"], conditions: ["mud tubes on the north wall"], recommendations: ["keep mulch a foot from the foundation"], areas: ["perimeter"], pests: ["ants"], products: ["Talstar P"], language: "en" as const };
    const en = localSummary(input);
    expect(en).toContain("Hi Jane, we finished your general pest plan today.");
    expect(en).toContain("Sealed two gaps by the garage.");
    expect(en).toContain("We recommend: keep mulch a foot from the foundation.");
    expect(en).not.toContain("Talstar");
    expect(localSummary({ ...input, language: "es" })).toContain("Hola Jane");
  });

  it("reads rate lines it is sure of and leaves out the rest", () => {
    const rows = localLabelRows("Perimeter: 0.2 to 0.8 fl oz per gallon of water.\nIndoor crack and crevice - apply 0.5 to 1 fl oz per 1 gallon.\nLawns: 2 to 3 cups per yard.");
    expect(rows).toEqual([
      { site: "perimeter", min_rate: 0.2, max_rate: 0.8, rate_unit: "fl_oz/gal", target_pests: [] },
      { site: "indoor crack and crevice", min_rate: 0.5, max_rate: 1, rate_unit: "fl_oz/gal", target_pests: [] },
    ]);
  });

  const context: PortalContext = {
    today: "2026-11-01",
    company: "Northwind Pest Control",
    customer: "Jane Green",
    properties: [{ id: "prop", address: "412 ELM ST" }],
    upcoming: [{ id: "next", date: "2026-11-12", status: "scheduled", service: "General pest plan", address: "412 ELM ST", window: "morning" }],
    recent: [{ id: "last", date: "2026-08-10", status: "completed", service: "General pest plan", address: "412 ELM ST", window: null, products: ["Talstar P"], areas: ["perimeter"] }],
    balance_cents: 8900,
    open_invoices: [{ id: "inv", number: 1042, due_on: "2026-11-15", owed_cents: 8900 }],
    plans: [{ id: "plan", service: "General pest plan", address: "412 ELM ST", price_cents: 8900, cadence: "quarterly" }],
    requests: [],
  };

  it("answers the common asks from the records and sends the rest to the office", () => {
    expect(localAnswer("When is my next visit?", context)).toMatchObject({ needs_office: false, sources: ["next"] });
    expect(localAnswer("When is my next visit?", context).answer).toContain("Thursday, November 12");
    expect(localAnswer("What did you spray last time?", context).answer).toContain("Talstar P");
    expect(localAnswer("How much do I owe?", context).answer).toContain("$89.00");
    expect(localAnswer("Is it safe for my dog?", context)).toMatchObject({ needs_office: true, sources: [] });
  });
});

describe("the portal context (spec 21 rule 7)", () => {
  it("holds only the customer's own records, and only those ids may be cited", () => {
    const o = {
      properties: [{ id: "p1", name: null, address: "412 ELM ST", has_site: false, agreement_id: "g1", agreement_number: 1 }],
      upcoming: [{ id: "v1", property_id: "p1", address: "412 ELM ST", service: "General pest plan", kind: "recurring", status: "scheduled", due_start: "2026-11-01", due_end: "2026-11-30", scheduled_for: "2026-11-12", arrival_window: "any", completed_at: null, step_label: null }],
      recent: [],
      open: [],
      paid: [],
      balance_cents: 0,
      methods: [{ id: "card", kind: "card", brand: "visa", last4: "4242", exp_month: 1, exp_year: 2030, autopay: true, is_default: true }],
      notices: [],
      requests: [],
      settings: { allow_reschedule: true, reschedule_notice_hours: 24, max_stops_per_day: 18, allow_requests: true, requestable: [] },
    } as unknown as Overview;
    const c = buildContext({ tenant_name: "Northwind", account_name: "Jane Green", tenant_timezone: "America/New_York" }, o, [], []);
    expect(JSON.stringify(c)).not.toContain("4242");
    expect([...contextIds(c)].sort()).toEqual(["p1", "v1"]);
  });
});

describe("the Claude provider (spec 21)", () => {
  const stub = (reply: { stop_reason?: string; text?: string }) => {
    const calls: unknown[] = [];
    const client: MessagesClient = {
      beta: {
        messages: {
          create: async (body) => {
            calls.push(body);
            return { id: "m", type: "message", role: "assistant", model: CLAUDE_MODEL, stop_reason: reply.stop_reason ?? "end_turn", content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }], usage: { input_tokens: 120, output_tokens: 40 } } as never;
          },
        },
      },
    };
    return { client, calls };
  };

  it("asks for structured JSON at low effort with fallbacks, and returns the summary with its usage", async () => {
    const { client, calls } = stub({ text: JSON.stringify({ summary: "We treated the perimeter." }) });
    const r = await claudeAi(client).draftSummary({ service: "General pest plan", customer_first_name: null, notes: [], conditions: [], recommendations: [], areas: ["perimeter"], pests: [], products: [], language: "en" });
    expect(r).toEqual({ text: "We treated the perimeter.", usage: { model: CLAUDE_MODEL, input_tokens: 120, output_tokens: 40 } });
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
  });

  it("turns a refusal or an unusable answer into a hand-off to the person", async () => {
    await expect(claudeAi(stub({ stop_reason: "refusal" }).client).answerQuestion("?", {} as PortalContext)).rejects.toMatchObject({ outcome: "refused" });
    await expect(claudeAi(stub({ text: "not json" }).client).answerQuestion("?", {} as PortalContext)).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("offers label rows only when the catalog's own check accepts them", async () => {
    const good = await claudeAi(stub({ text: JSON.stringify({ rows: [{ site: "perimeter", min_rate: 0.2, max_rate: 0.8, rate_unit: "fl_oz/gal", target_pests: ["ants"] }], note: null }) }).client).readLabel("label");
    expect(good.rows).toHaveLength(1);
    const bad = await claudeAi(stub({ text: JSON.stringify({ rows: [{ site: "lawn", min_rate: 2, max_rate: 3, rate_unit: "cups/yard", target_pests: [] }], note: null }) }).client).readLabel("label");
    expect(bad.rows).toEqual([]);
    expect(bad.note).toContain("did not check out");
  });
});
