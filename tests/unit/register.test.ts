import { describe, expect, it } from "vitest";
import { forgetFace, registerFace } from "../../src/face/register";

describe("defining the face element", () => {
  it("loads the package once however many faces mount", async () => {
    forgetFace();
    let loads = 0;
    const load = () => {
      loads += 1;
      return Promise.resolve({});
    };
    await Promise.all([registerFace(load), registerFace(load)]);
    await registerFace(load);
    expect(loads).toBe(1);
    forgetFace();
  });
});
