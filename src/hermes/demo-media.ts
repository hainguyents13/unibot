/**
 * The demo's files, made on the spot since there's no gateway to read them from: a chart for any
 * `.svg`, a short tone for any `.wav`, and a few seconds of animation for any `.webm` (recorded from
 * a canvas, so only in a browser). Anything else isn't there.
 */
export async function demoMedia(path: string): Promise<Uint8Array | undefined> {
  if (path.endsWith(".svg")) return new TextEncoder().encode(CHART);
  if (path.endsWith(".wav")) return tone(1.6);
  if (path.endsWith(".webm") && typeof MediaRecorder !== "undefined") return animation(3);
  return undefined;
}

const CHART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" width="480" height="240">
<rect width="480" height="240" fill="#f8fafc"/>
<text x="24" y="36" font-family="Segoe UI" font-size="18" font-weight="600" fill="#0f172a">Sign-ups, launch week</text>
${[38, 64, 52, 91, 120, 104, 150].map((v, i) => `<rect x="${40 + i * 60}" y="${210 - v}" width="36" height="${v}" rx="4" fill="#2563eb"/>`).join("")}
<line x1="24" y1="210" x2="456" y2="210" stroke="#cbd5e1"/>
</svg>`;

/** A 16-bit mono WAV of a soft two-note chime. */
function tone(seconds: number): Uint8Array {
  const rate = 22_050;
  const samples = Math.floor(rate * seconds);
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const pitch = t < seconds / 2 ? 660 : 880;
    const fade = Math.exp(-3 * (t % (seconds / 2)));
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * pitch * t) * fade * 0.3 * 32_767, true);
  }
  return new Uint8Array(view.buffer);
}

/** A few seconds of a canvas animation, recorded as WebM. */
async function animation(seconds: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d")!;
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));
  const started = performance.now();
  let frame = 0;
  const draw = () => {
    const t = (performance.now() - started) / 1000;
    context.fillStyle = "#1e293b";
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = "#60a5fa";
    context.beginPath();
    context.arc(320 + Math.cos(t * 2) * 180, 180 + Math.sin(t * 3) * 90, 36, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f1f5f9";
    context.font = "600 32px Segoe UI";
    context.fillText("Your Bots, on Windows", 150, 60);
    if (t < seconds) frame = requestAnimationFrame(draw);
    else recorder.stop();
  };
  recorder.start();
  draw();
  await stopped;
  cancelAnimationFrame(frame);
  return new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
}
