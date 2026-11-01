import { describe, expect, it } from "vitest";
import { hashRow, mapHeaders, parseCsv, parseRegistryCsv } from "@/lib/compliance/registry";
import { normalizeAddress } from "@/lib/geo/normalize";

describe("registry CSV import (rule 9)", () => {
  it("parses quoted cells, doubled quotes and line breaks inside quotes", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "z"],
    ]);
  });

  it("finds columns by their common names and lets a mapping override them", () => {
    expect(mapHeaders(["Registrant Name", "Street Address", "City", "ST", "Zip Code", "Phone Number", "E-mail", "Comments"])).toEqual(["name", "line1", "city", "state", "postal_code", "phone", "email", "notes"]);
    expect(mapHeaders(["Addr", "Town", "Postal"], { Addr: "line1", Town: "city", Postal: "postal_code" })).toEqual(["line1", "city", "postal_code"]);
    expect(mapHeaders(["Mystery"])).toEqual([null]);
  });

  it("keeps rows with an address, reports bad rows by line, and normalizes like a property", () => {
    const text = ["name,address,city,state,zip,phone,email", "Jane Neighbor,1234 Neil Avenue,Columbus,OH,43201,614-555-0100,JANE@EXAMPLE.TEST", ",,Columbus,OH,43201,,", "Far Away,1 Elm St,Toledo,MI,48000,,", "Jane Neighbor,1234 Neil Avenue,Columbus,OH,43201,614-555-0100,jane@example.test"].join("\n");
    const result = parseRegistryCsv(text, "oh");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].normalized_address).toBe(normalizeAddress({ line1: "1234 Neil Avenue", city: "Columbus", stateCode: "OH", postalCode: "43201" }));
    expect(result.rows[0].normalized_address).toBe("1234 NEIL AVE, COLUMBUS OH 43201");
    expect(result.rows[0].email).toBe("jane@example.test");
    expect(result.errors).toEqual([
      { line: 3, message: "address, city and postal code are required" },
      { line: 4, message: "row is in MI, not OH" },
    ]);
  });

  it("refuses a file without the address columns and says which are missing", () => {
    const result = parseRegistryCsv("name,phone\nJane,614", "OH");
    expect(result.rows).toEqual([]);
    expect(result.errors.map((e) => e.message)).toEqual(["no column for line1; map it or rename the header", "no column for city; map it or rename the header", "no column for postal code; map it or rename the header"]);
    expect(parseRegistryCsv("", "OH").errors[0].message).toBe("the file is empty");
  });

  it("hashes what identifies an entry, so a re-import keeps unchanged rows", () => {
    const base = { name: "Jane", line1: "1234 Neil Ave", line2: null, city: "Columbus", postal_code: "43201", normalized_address: "1234 NEIL AVE, COLUMBUS OH 43201", contact_name: null, phone: "614", email: null, notes: null };
    expect(hashRow(base)).toBe(hashRow({ ...base, notes: "different notes do not change identity" }));
    expect(hashRow(base)).not.toBe(hashRow({ ...base, phone: "615" }));
  });
});
