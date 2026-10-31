// Lead pipeline stages and the transitions allowed between them. The database trigger app.check_lead_stage
// enforces the same table; keep the two in step.

export const LEAD_STAGES = ["new", "inspection_booked", "quoted", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  inspection_booked: "Inspection booked",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

const TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new: ["inspection_booked", "quoted", "won", "lost"],
  inspection_booked: ["quoted", "won", "lost"],
  quoted: ["won", "lost"],
  won: [],
  lost: ["new"],
};

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStages(from: LeadStage): readonly LeadStage[] {
  return TRANSITIONS[from];
}

export const OPEN_STAGES: readonly LeadStage[] = ["new", "inspection_booked", "quoted"];
