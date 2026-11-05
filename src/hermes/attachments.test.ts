import { describe, expect, it } from "vitest";
import { attachmentKind, parseRefLine, refLine, sizeLimit, splitAttachments, toBase64 } from "./attachments";

describe("attachments", () => {
  it("sends images as images and everything else as files", () => {
    expect(attachmentKind("Photo.JPG")).toBe("image");
    expect(attachmentKind("report.pdf")).toBe("file");
    expect(attachmentKind("README")).toBe("file");
    expect(sizeLimit("a.png")).toBe(25 * 1024 * 1024);
    expect(sizeLimit("a.pdf")).toBe(50 * 1024 * 1024);
  });

  it("quotes paths with spaces the way Hermes reads them back", () => {
    expect(refLine({ kind: "file", path: "uploads/notes.txt" })).toBe("@file:uploads/notes.txt");
    expect(refLine({ kind: "image", path: "/tmp/my photo.png" })).toBe("@image:`/tmp/my photo.png`");
    expect(parseRefLine("@image:`/tmp/my photo.png`")).toEqual({ kind: "image", path: "/tmp/my photo.png" });
    expect(parseRefLine("@file:two words")).toBeUndefined();
    expect(parseRefLine("hello")).toBeUndefined();
  });

  it("splits attachment lines off the end of a message", () => {
    expect(splitAttachments("Have a look\n\n@image:/tmp/a.png\n@file:b.pdf")).toEqual({
      text: "Have a look",
      attachments: [
        { kind: "image", path: "/tmp/a.png" },
        { kind: "file", path: "b.pdf" },
      ],
    });
    expect(splitAttachments("@file:only.txt")).toEqual({ text: "", attachments: [{ kind: "file", path: "only.txt" }] });
    expect(splitAttachments("Mentions @file:x.txt mid-line")).toEqual({ text: "Mentions @file:x.txt mid-line", attachments: [] });
  });

  it("encodes large files to base64 without overflowing the stack", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
