import { describe, expect, it } from "vitest";
import { fileName, mediaOf, replyFiles } from "./reply-files";

describe("files in a reply", () => {
  it("takes MEDIA lines out of the text and offers their files", () => {
    expect(replyFiles("Here's the chart.\nMEDIA:/opt/data/out/chart.png\nMEDIA: `/tmp/notes.pdf`")).toEqual({
      text: "Here's the chart.",
      files: ["/opt/data/out/chart.png", "/tmp/notes.pdf"],
    });
  });

  it("offers a path the Bot wrote out, and keeps it in the text", () => {
    const reply = [
      "Tải xong, file hợp lệ:",
      "",
      "/opt/data/profiles/marketing/downloads/x_unikornvn_1930294627682398647.mp4",
      "",
      "Also saved `/opt/data/thumbs/frame-1.jpg` and (/srv/report.v2.pdf).",
    ].join("\n");
    const { text, files } = replyFiles(reply);
    expect(text).toBe(reply);
    expect(files).toEqual([
      "/opt/data/profiles/marketing/downloads/x_unikornvn_1930294627682398647.mp4",
      "/opt/data/thumbs/frame-1.jpg",
      "/srv/report.v2.pdf",
    ]);
  });

  it("leaves URLs, folders, code blocks and sentences' full stops alone", () => {
    const reply = [
      "See https://example.com/a/b.png and the folder /opt/data/downloads/ or /usr/bin.",
      "It's in /tmp/out.csv.",
      "```",
      "ffmpeg -i /tmp/in.mp4 /tmp/out.gif",
      "```",
      "MEDIA:relative/path.png",
    ].join("\n");
    expect(replyFiles(reply).files).toEqual(["/tmp/out.csv"]);
  });

  it("offers each file once", () => {
    expect(replyFiles("MEDIA:/a/b.txt\nAlso /a/b.txt here.").files).toEqual(["/a/b.txt"]);
  });

  it("knows which files show or play in the chat", () => {
    expect(mediaOf("/out/clip.MP4")).toEqual({ kind: "video", type: "video/mp4" });
    expect(mediaOf("/out/memo.m4a")).toEqual({ kind: "audio", type: "audio/mp4" });
    expect(mediaOf("/out/chart.svg")).toEqual({ kind: "image", type: "image/svg+xml" });
    expect(mediaOf("/out/report.pdf")).toBeUndefined();
    expect(mediaOf("/out/movie.mkv")).toBeUndefined();
  });

  it("names a file by its last part", () => {
    expect(fileName("/opt/data/x.mp4")).toBe("x.mp4");
  });
});
