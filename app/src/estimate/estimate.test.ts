// SPDX-License-Identifier: GPL-3.0-or-later
// The reference numbers come from the engine's own script (skills/cfd-results/scripts/size_estimate.py) run with
// the same inputs; the page words some of them more precisely (cents, tenths of a core hour).
import { describe, expect, it } from "vitest";
import { DEFAULTS, coreHours, duration, estimate, gigabytes, money, parseField } from "./estimate";

const gb = (e: ReturnType<typeof estimate>) => e.memory.map((s) => gigabytes(s.gb));

describe("size estimate", () => {
  it("matches the engine's script for a 5.1 M-cell case, 1500 iterations", () => {
    const e = estimate({ ...DEFAULTS, cells: 5.1, iterations: 1500 });
    expect(gb(e)).toEqual(["10.7 GB", "8.9 GB", "9.7 GB", "3.4 GB", "8.1 GB"]);
    expect(e.memory.every((s) => s.fits)).toBe(true);
    expect(e.peak.key).toBe("snappy");
    expect(duration(e.local.seconds)).toBe("3.4 h");
    expect(duration(e.cloud.seconds)).toBe("4.9 h");
    expect(money(e.cloud.cost)).toBe("$4.08"); // the script: "$4"
    expect(coreHours(e.simscale.coreHours)).toBe("21");
  });

  it("matches it for a 31.1 M-cell car, which only the cloud can solve", () => {
    const e = estimate({ ...DEFAULTS, cells: 31.1 });
    expect(gb(e)).toEqual(["65.3 GB", "54.4 GB", "59.1 GB", "20.8 GB", "47.2 GB"]);
    expect(e.memory.map((s) => s.fits)).toEqual([false, false, false, true, false]);
    expect(e.local.fits).toBe(false);
    expect(duration(e.local.seconds)).toBe("13.7 h");
    expect(duration(e.cloud.seconds)).toBe("19.0 h");
    expect(money(e.cloud.cost)).toBe("$16");
    expect(e.cloud.decomposeFits).toBe(true); // 59 GB of the machine's 96
    expect(coreHours(e.simscale.coreHours)).toBe("90");
    expect(e.simscale.tooBig).toBe(true);
    expect(estimate({ ...DEFAULTS, cells: 50 }).cloud.decomposeFits).toBe(false); // 95 GB
  });

  it("matches it for a small Ahmed body on 4 ranks", () => {
    const e = estimate({ ...DEFAULTS, cells: 0.84, iterations: 300, cores: 4 });
    expect(gb(e)).toEqual(["1.8 GB", "1.5 GB", "1.6 GB", "0.6 GB", "1.8 GB"]);
    expect(duration(e.local.seconds)).toBe("10 min");
    expect(duration(e.cloud.seconds)).toBe("24 min");
    expect(money(e.cloud.cost)).toBe("$0.34"); // the script: "$0"
    expect(coreHours(e.simscale.coreHours)).toBe("0.9"); // the script: "1"
  });

  it("words times, sizes and money", () => {
    expect(duration(10)).toBe("under 1 min");
    expect(duration(5399)).toBe("90 min");
    expect(duration(5400)).toBe("1.5 h");
    expect(gigabytes(1234.56)).toBe("1,234.6 GB");
    expect(money(1234.4)).toBe("$1,234");
    expect(coreHours(12345.6)).toBe("12,346");
  });

  it("accepts only sensible numbers", () => {
    expect(parseField("cells", " 5.1 ")).toBe(5.1);
    expect(parseField("cells", "")).toBeNull();
    expect(parseField("cells", "0")).toBeNull();
    expect(parseField("cells", "abc")).toBeNull();
    expect(parseField("cores", "6.5")).toBeNull();
    expect(parseField("iterations", "1e3")).toBe(1000);
    expect(parseField("price", "0")).toBe(0);
    expect(parseField("ram", "100000")).toBeNull();
  });
});
