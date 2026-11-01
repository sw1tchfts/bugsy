// Messages ride along with business events but never fail them: a message that cannot be queued is logged, and the
// event (a completion, an invoice) commits without it. Inside a transaction a savepoint keeps the rest intact.
import type postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;

export async function safely<T>(tx: Sql, what: string, fn: (tx: Sql) => Promise<T>): Promise<T | null> {
  try {
    if ("savepoint" in tx && typeof tx.savepoint === "function") return (await tx.savepoint((sp) => fn(sp))) as T;
    return await fn(tx);
  } catch (err) {
    console.error(`messaging: ${what} not queued`, err);
    return null;
  }
}
