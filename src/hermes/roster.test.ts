import { describe, expect, it } from "vitest";
import { botsFromProfiles, friendlyName, plainPreview } from "./roster";

describe("botsFromProfiles", () => {
  it("reads names, previews and activity, most recent first", () => {
    const bots = botsFromProfiles({
      profiles: [
        { name: "default", description: "General help", canonical_session: { preview: "**Done**", last_active: 100 } },
        {
          name: "job-scout",
          display_name: "Scout",
          ui_meta: { "hermes-bots": { title: "Job Scout" } },
          canonical_session: { preview: "Found 3 roles", last_active: 200 },
        },
        { name: "notes", description: "Keeps notes" },
      ],
    });
    expect(bots).toEqual([
      { id: "job-scout", name: "Job Scout", about: "", preview: "Found 3 roles", lastActivity: 200_000, status: "idle" },
      { id: "default", name: "Hermes", about: "General help", preview: "Done", lastActivity: 100_000, status: "idle" },
      { id: "notes", name: "Notes", about: "Keeps notes", preview: "Keeps notes", lastActivity: 0, status: "idle" },
    ]);
  });

  it("leaves out hidden Bots and rows it can't read, keeping the rest", () => {
    const bots = botsFromProfiles({
      profiles: [
        { name: "secret", ui_meta: { "hermes-bots": { hidden: true } } },
        { display_name: "No name" },
        null,
        { name: "ops", canonical_session: { last_active: "yesterday" } },
      ],
    });
    expect(bots.map((b) => b.id)).toEqual(["ops"]);
  });

  it("gives an empty roster for a result it doesn't recognise", () => {
    expect(botsFromProfiles(null)).toEqual([]);
    expect(botsFromProfiles({ profiles: "x" })).toEqual([]);
  });
});

describe("friendlyName", () => {
  it.each([
    ["default", "Hermes"],
    ["job-scout", "Job Scout"],
    ["ops_bot", "Ops Bot"],
    ["---", "---"],
  ])("%s reads as %s", (profile, expected) => {
    expect(friendlyName(profile)).toBe(expected);
  });
});

describe("plainPreview", () => {
  it.each([
    ["**Bold** and `code`", "Bold and code"],
    ["## Heading", "Heading"],
    ["> quoted\nline", "quoted line"],
    ["See [the doc](https://example.com)", "See the doc"],
    ["**unclosed bold", "unclosed bold"],
    ["1. *Your Bots, on Windows* 2. _A messenger_", "1. Your Bots, on Windows 2. A messenger"],
    ["snake_case_name and 2 * 3", "snake_case_name and 2 * 3"],
  ])("%j becomes %j", (text, expected) => {
    expect(plainPreview(text)).toBe(expected);
  });
});
