// Turns an accepted quote option into agreement prices.

export type OptionLine = { kind: "initial" | "recurring" | "one_time" | "add_on"; description: string; amount_cents: number | string | bigint };

export type AgreementPrices = {
  initialPriceCents: number;
  recurringPriceCents: number;
  /** One-time lines are not part of a recurring agreement; the office books them as separate visits. */
  oneTime: { description: string; amount_cents: number }[];
};

/**
 * Initial lines sum to the initial price; recurring lines and add-ons sum to the recurring price. An add-on line the
 * price book marked "(initial)" is a one-time extra on the first visit and joins the initial price instead; one marked
 * "(one-time)" is reported with the one-time lines.
 */
export function agreementFromOption(lines: readonly OptionLine[]): AgreementPrices {
  const prices: AgreementPrices = { initialPriceCents: 0, recurringPriceCents: 0, oneTime: [] };
  for (const line of lines) {
    const amount = Number(line.amount_cents);
    switch (line.kind) {
      case "initial":
        prices.initialPriceCents += amount;
        break;
      case "recurring":
        prices.recurringPriceCents += amount;
        break;
      case "one_time":
        prices.oneTime.push({ description: line.description, amount_cents: amount });
        break;
      case "add_on":
        if (/\(initial\)\s*$/i.test(line.description)) prices.initialPriceCents += amount;
        else if (/\(one-time\)\s*$/i.test(line.description)) prices.oneTime.push({ description: line.description, amount_cents: amount });
        else prices.recurringPriceCents += amount;
        break;
    }
  }
  return prices;
}
