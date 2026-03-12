import { describe, it, expect } from "vitest";
import { verifyWebhookSecret, parseCommand } from "./telegram";

describe("verifyWebhookSecret", () => {
  it("returns true for matching secret", () => {
    expect(verifyWebhookSecret("my-secret", "my-secret")).toBe(true);
  });
  it("returns false for mismatched secret", () => {
    expect(verifyWebhookSecret("my-secret", "wrong")).toBe(false);
  });
  it("returns false for missing header", () => {
    expect(verifyWebhookSecret("my-secret", null)).toBe(false);
  });
});

describe("parseCommand", () => {
  it("parses /start with arg", () => {
    expect(parseCommand("/start abc123")).toEqual({ command: "start", args: "abc123" });
  });
  it("parses /topics without arg", () => {
    expect(parseCommand("/topics")).toEqual({ command: "topics", args: "" });
  });
  it("parses /time with arg", () => {
    expect(parseCommand("/time 9")).toEqual({ command: "time", args: "9" });
  });
  it("returns null for non-command text", () => {
    expect(parseCommand("hello")).toBeNull();
  });
  it("handles bot username suffix", () => {
    expect(parseCommand("/start@my_bot abc")).toEqual({ command: "start", args: "abc" });
  });
});
