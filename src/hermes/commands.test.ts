import { describe, expect, it } from "vitest";
import { commandIn, commandsFromCatalog, matchingCommands } from "./commands";

const catalog = {
  pairs: [
    ["/web-research", "Search the web and summarise"],
    ["/status", "Show session status"],
    ["/new", "Start a new session"],
    ["/skin", "Change the terminal skin"],
    ["/config", "Edit configuration"],
    ["/btw", "Ask on the side"],
    ["/deploy", "Quick command: deploy"],
    ["/status", "duplicate"],
    ["no-slash", "ignored"],
  ],
  skills: { "/web-research": {} },
  commands: { "/status": {}, "/new": {}, "/skin": {}, "/config": { desktop: "settings" }, "/btw": {} },
};

describe("commandsFromCatalog", () => {
  it("keeps skills, quick commands and built-ins that fit a messenger", () => {
    expect(commandsFromCatalog(catalog)).toEqual([
      { name: "/web-research", description: "Search the web and summarise", kind: "skill" },
      { name: "/status", description: "Show session status", kind: "command" },
      { name: "/deploy", description: "Quick command: deploy", kind: "command" },
    ]);
  });

  it("gives an empty menu for a catalog it can't read", () => {
    expect(commandsFromCatalog(null)).toEqual([]);
    expect(commandsFromCatalog({ pairs: "x" })).toEqual([]);
  });
});

describe("commandIn / matchingCommands", () => {
  const commands = commandsFromCatalog(catalog);

  it("finds the command a message starts with, ignoring case", () => {
    expect(commandIn("/STATUS now", commands)?.name).toBe("/status");
    expect(commandIn("status", commands)).toBeUndefined();
    expect(commandIn("/unknown", commands)).toBeUndefined();
  });

  it("lists names that start with what you typed first, then ones that contain it", () => {
    expect(matchingCommands("/de", commands).map((c) => c.name)).toEqual(["/deploy"]);
    expect(matchingCommands("/s", commands).map((c) => c.name)).toEqual(["/status", "/web-research"]);
    expect(matchingCommands("/", commands)).toHaveLength(3);
  });

  it("closes the menu once you type past the command", () => {
    expect(matchingCommands("/status ", commands)).toEqual([]);
    expect(matchingCommands("hello", commands)).toEqual([]);
  });
});
