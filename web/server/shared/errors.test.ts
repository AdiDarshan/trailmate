import { describe, expect, it } from "vitest";
import { AppError, GENERIC_USER_ERROR, NotFoundError, toPublicMessage } from "./errors";

describe("error taxonomy", () => {
  it("AppError separates internal detail from the public message", () => {
    const e = new AppError("supabase insert failed: duplicate key", {
      publicMessage: "Could not save the trip.",
    });
    expect(e.message).toContain("duplicate key");
    expect(toPublicMessage(e)).toBe("Could not save the trip.");
  });

  it("non-AppError values fall back to the generic message", () => {
    expect(toPublicMessage(new Error("stack detail"))).toBe(GENERIC_USER_ERROR);
    expect(toPublicMessage("string throw")).toBe(GENERIC_USER_ERROR);
  });

  it("NotFoundError is a typed AppError usable with instanceof", () => {
    const e = new NotFoundError("session abc not found");
    expect(e).toBeInstanceOf(NotFoundError);
    expect(e).toBeInstanceOf(AppError);
    expect(e.name).toBe("NotFoundError");
  });
});
