import { describe, expect, it } from "vitest";
import { type Definition, buildQuery, checkDefinition, coerce } from "@/lib/reports/builder";
import { DATASETS, datasetFor } from "@/lib/reports/datasets";
import { definitionFromFields, definitionFromJson, fieldsFromDefinition } from "@/lib/reports/form";

const visits = datasetFor("visits")!;
const base: Definition = { columns: [], filters: [], group_by: [], aggregates: [] };

describe("the custom report grammar (spec 12 rule 9)", () => {
  it("refuses columns, operators and totals the dataset does not declare", () => {
    expect(checkDefinition({ ...base, columns: ["password"] }, visits)).toEqual(['column: Visits has no column "password"']);
    expect(checkDefinition({ ...base, columns: ["status"], filters: [{ column: "status", op: "like" as never, value: "x" }] }, visits)[0]).toMatch(/unknown operator/);
    expect(checkDefinition({ ...base, aggregates: [{ fn: "sum", column: "status" }] }, visits)).toEqual(["total: sum needs a number or money column"]);
    expect(checkDefinition({ ...base, columns: ["price"], filters: [{ column: "price", op: "gt", value: "lots" }] }, visits)).toEqual(['filter on price: "lots" is not a money']);
    expect(checkDefinition({ ...base, columns: ["price"], sort: { column: "status", dir: "asc" } }, visits)).toEqual(['sort: "status" is not in the report']);
    expect(checkDefinition(base, visits)).toEqual(["pick at least one column"]);
  });

  it("compiles to SQL whose identifiers come from the dataset and whose values are parameters", () => {
    const q = buildQuery(
      { ...base, group_by: ["technician"], aggregates: [{ fn: "count" }, { fn: "sum", column: "price" }], filters: [{ column: "status", op: "eq", value: "completed" }, { column: "price", op: "gte", value: "50.00" }, { column: "account", op: "contains", value: "50%_off'; drop table x" }] },
      visits,
      "t1",
      5000,
    );
    expect(q.params).toEqual(["t1", "completed", 5000, "%50\\%\\_off'; drop table x%"]);
    expect(q.text).toContain('select d."technician", count(*) as "count", sum(d."price") as "sum_price" from (');
    expect(q.text).toContain('where d."status" = $2 and d."price" >= $3 and d."account"::text ilike $4 group by d."technician" order by "technician" limit 5000');
    expect(q.text).not.toContain("drop table");
    expect(q.columns).toEqual(["technician", "count", "sum_price"]);
  });

  it("coerces filter values by column type and caps the rows", () => {
    expect(coerce("money", "1,250.50")).toBe(125050);
    expect(coerce("money", "-5")).toBe(-500);
    expect(coerce("date", "2027-01-31")).toBe("2027-01-31");
    expect(coerce("date", "1/31/2027")).toBeUndefined();
    expect(coerce("boolean", "Yes")).toBe(true);
    expect(buildQuery({ ...base, columns: ["status"], limit: 50_000 }, visits, "t", 5000).text).toMatch(/limit 5000$/);
    expect(checkDefinition({ ...base, columns: ["status"], limit: 999_999 }, visits)).toEqual(["limit: 1 to 100000"]);
  });

  it("declares every dataset with $1 as its company and a permission", () => {
    for (const d of DATASETS) {
      expect(d.sql, d.key).toContain("tenant_id = $1");
      expect(d.permission, d.key).toMatch(/\.read$/);
      expect(new Set(d.columns.map((x) => x.name)).size).toBe(d.columns.length);
    }
  });

  it("reads a definition from form fields and writes it back to the same fields", () => {
    const def: Definition = {
      columns: [],
      filters: [{ column: "status", op: "eq", value: "completed" }, { column: "technician", op: "not_empty" }],
      group_by: ["technician"],
      aggregates: [{ fn: "count" }, { fn: "sum", column: "price" }],
      sort: { column: "count", dir: "desc" },
      limit: 20,
    };
    const q = fieldsFromDefinition("visits", def);
    expect(q.get("dataset")).toBe("visits");
    expect(definitionFromFields(q)).toEqual(def);
    expect(checkDefinition(definitionFromFields(q), visits)).toEqual([]);
    expect(definitionFromJson(JSON.parse(JSON.stringify(def)))).toEqual(def);
    // A bad limit or a stored definition from nowhere is refused rather than run.
    expect(checkDefinition(definitionFromFields(new URLSearchParams("col=status&limit=ten")), visits)).toEqual(["limit: 1 to 100000"]);
    expect(checkDefinition(definitionFromJson({ columns: ["status; drop"] }), visits)).toEqual(['column: Visits has no column "status; drop"']);
  });
});
