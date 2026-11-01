import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EXPORT_FILES, csvCell, toCsv, zipFiles } from "@/lib/compliance/export";

describe("inspector export files (rule 13)", () => {
  it("quotes cells that hold commas, quotes or line breaks and joins lists", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(["ants", "spiders"])).toBe("ants; spiders");
    expect(csvCell({ wind_mph: 4 })).toBe('"{""wind_mph"":4}"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("writes a header row and CRLF line ends", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it("zips every file under its own name", () => {
    const files = EXPORT_FILES.map((name) => ({ name, bytes: new TextEncoder().encode(`${name} body`) }));
    const zip = zipFiles(files);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([...EXPORT_FILES].sort());
    expect(strFromU8(entries["binder.html"])).toBe("binder.html body");
  });
});
