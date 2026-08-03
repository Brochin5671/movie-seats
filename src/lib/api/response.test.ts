import { describe, expect, it } from "vitest";
import { json, jsonError } from "./response";

describe("json", () => {
  it("serializes the body with a JSON content-type and the given status", async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("jsonError", () => {
  const req = (headers?: Record<string, string>) =>
    new Request("http://localhost/api/x", { method: "POST", headers });

  it("returns the { error: { code, message, requestId } } envelope", async () => {
    const res = jsonError(req(), 400, "invalid_json", "Invalid JSON");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON", requestId: expect.any(String) },
    });
  });

  it("uses the cf-ray header as the requestId when present", async () => {
    const res = jsonError(req({ "cf-ray": "7f2a1b3c4d5e-YYZ" }), 500, "boom", "Boom");
    const body = (await res.json()) as { error: { requestId: string } };
    expect(body.error.requestId).toBe("7f2a1b3c4d5e-YYZ");
  });

  it("falls back to a generated uuid when cf-ray is absent", async () => {
    const res = jsonError(req(), 500, "boom", "Boom");
    const body = (await res.json()) as { error: { requestId: string } };
    // The uuid shape, not just a non-empty string: the id is a correlation handle
    // and any placeholder would satisfy a length check
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
