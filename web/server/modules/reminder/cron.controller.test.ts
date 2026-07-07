import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cron.controller";

describe("isAuthorizedCron", () => {
  const SECRET = "s3cret";

  it("accepts the matching bearer token", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET, true)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET, false)).toBe(true);
  });

  it("rejects a wrong or missing token when a secret is configured", () => {
    expect(isAuthorizedCron("Bearer nope", SECRET, true)).toBe(false);
    expect(isAuthorizedCron(null, SECRET, true)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET, true)).toBe(false); // missing "Bearer " prefix
  });

  it("fails CLOSED in production when no secret is configured", () => {
    expect(isAuthorizedCron(null, undefined, true)).toBe(false);
    expect(isAuthorizedCron("Bearer anything", undefined, true)).toBe(false);
  });

  it("allows local dev when no secret is configured", () => {
    expect(isAuthorizedCron(null, undefined, false)).toBe(true);
  });
});
