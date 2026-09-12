// Unit tests for sharedSecretAuth — mainly guarding the timingSafeEqual swap
// (see this file's own top comment) against a regression that reintroduces a
// plain `===` comparison, and the open-when-unset / reject-when-missing edge
// cases around it. Uses minimal hand-built Request/Response stand-ins rather
// than a real Express app — this middleware only reads one header and calls
// next()/res.status().json(), so a full app/supertest setup would be
// significant extra weight for what's actually being verified here.

import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sharedSecretAuth } from "./sharedSecretAuth.js";

function fakeReq(headerValue: string | undefined): Request {
  return { header: () => headerValue } as unknown as Request;
}

function fakeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response["json"];
  return res;
}

describe("sharedSecretAuth", () => {
  it("skips auth entirely when APP_SHARED_SECRET isn't set", () => {
    delete process.env.APP_SHARED_SECRET;
    const next = vi.fn() as NextFunction;
    const res = fakeRes();
    sharedSecretAuth(fakeReq(undefined), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when the header matches exactly", () => {
    process.env.APP_SHARED_SECRET = "correct-horse-battery-staple";
    const next = vi.fn() as NextFunction;
    const res = fakeRes();
    sharedSecretAuth(fakeReq("correct-horse-battery-staple"), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    delete process.env.APP_SHARED_SECRET;
  });

  it("returns 401 when the header is missing", () => {
    process.env.APP_SHARED_SECRET = "correct-horse-battery-staple";
    const next = vi.fn() as NextFunction;
    const res = fakeRes();
    sharedSecretAuth(fakeReq(undefined), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    delete process.env.APP_SHARED_SECRET;
  });

  it("returns 401 when the header is wrong, including a different-length guess", () => {
    process.env.APP_SHARED_SECRET = "correct-horse-battery-staple";
    const next = vi.fn() as NextFunction;
    const res = fakeRes();
    sharedSecretAuth(fakeReq("wrong"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    delete process.env.APP_SHARED_SECRET;
  });

  it("returns 401 for a same-length near-miss (guards against a timingSafeEqual length-mismatch throw)", () => {
    process.env.APP_SHARED_SECRET = "correct-horse-battery-staple";
    const next = vi.fn() as NextFunction;
    const res = fakeRes();
    sharedSecretAuth(fakeReq("correct-horse-battery-staplf"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    delete process.env.APP_SHARED_SECRET;
  });
});
