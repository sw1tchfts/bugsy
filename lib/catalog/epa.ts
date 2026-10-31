/** The marker stored for FIFRA 25(b) minimum-risk products, which carry no EPA registration number. */
export const EPA_EXEMPT = "25b-exempt";

const REG_NO = /^(\d+)-(\d+)(?:-(\d+))?$/;

/**
 * Normalizes an EPA registration number as typed ("EPA Reg. No. 7969-210", " 7969 - 210 ") to the form on the label
 * ("7969-210" or "7969-210-12345"), or the 25(b) marker. Returns null for anything else.
 */
export function normalizeEpaRegNo(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (["25b-exempt", "25b", "25(b)", "exempt", "fifra 25(b)", "minimum risk"].includes(s)) return EPA_EXEMPT;
  s = s.replace(/^epa\.?\s*(reg(istration)?\.?)?\s*(no\.?|number|#)?\s*:?\s*/, "");
  s = s.replace(/\s+/g, "");
  const match = REG_NO.exec(s);
  if (!match) return null;
  const [, company, product, distributor] = match;
  return distributor ? `${Number(company)}-${Number(product)}-${Number(distributor)}` : `${Number(company)}-${Number(product)}`;
}

export function isEpaExempt(regNo: string): boolean {
  return regNo === EPA_EXEMPT;
}
