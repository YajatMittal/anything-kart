// Runs MediaPipe hand tracking on a background thread so it can never stall the race.
self.module = { exports: {} };
self.exports = self.module.exports;
importScripts('/mediapipe/vision_bundle_worker.js');   // served as-is from public/mediapipe/
const { FilesetResolver, HandLandmarker } = self.module.exports;

const base = new URL('/mediapipe/', self.location.href).href;
let tracker = null, clock = 0, hands = 2, restarting = false, delegate = 'GPU';

// The two big downloads, fetched here (rather than by MediaPipe) so the game can show progress.
// Sizes are only a fallback for when the server compresses them and doesn't say how big they are.
const SIZES = { 'vision_wasm_internal.wasm': 14466654, 'vision_wasm_nosimd_internal.wasm': 12915401, 'hand_landmarker.task': 7819105 };
let files = null;   // { fileset, model } once downloaded (kept, so a restart doesn't download again)

async function download() {
  const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
  const urls = [fileset.wasmBinaryPath, base + 'hand_landmarker.task'];
  const got = [0, 0], size = urls.map((u) => SIZES[u.split('/').pop()] || 0);
  const report = () => self.postMessage({ type: 'progress', loaded: got[0] + got[1], total: size[0] + size[1] });
  const fetchOne = async (url, k) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download ${url.split('/').pop()} (${res.status})`);
    const len = +res.headers.get('content-length');
    if (len && !res.headers.get('content-encoding')) size[k] = len;
    const reader = res.body.getReader(), parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got[k] += value.length; report();
    }
    return new Blob(parts);
  };
  const [wasm, model] = await Promise.all(urls.map(fetchOne));
  fileset.wasmBinaryPath = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
  return { fileset, model: new Uint8Array(await model.arrayBuffer()) };
}

async function init(numHands) {
  hands = numHands;
  if (!files) files = await download();
  self.postMessage({ type: 'progress', starting: true });
  const make = (d) => HandLandmarker.createFromOptions(files.fileset, {
    baseOptions: { modelAssetBuffer: files.model, delegate: d },
    runningMode: 'VIDEO', numHands,
    // Hands partly hidden behind a held object score lower, so these are fairly relaxed. Faces or
    // clothes the detector fires on are filtered later: only the player's original pair is followed.
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
  });
  try { tracker = await make('GPU'); delegate = 'GPU'; } catch { tracker = await make('CPU'); delegate = 'CPU'; }
  // the number of players may have changed while it was loading (it starts loading early)
  if (hands !== numHands) await tracker.setOptions({ numHands: hands });
  // Warm up: the first few frames are very slow while the graphics card gets ready, so do them now
  // on blank pictures, not on the player's hands (which made the first seconds laggy).
  const blank = new OffscreenCanvas(320, 240), g = blank.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 320, 240);
  for (let k = 0; k < 3; k++) { clock += 33; tracker.detectForVideo(blank, clock); }
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(m.numHands); self.postMessage({ type: 'ready', delegate }); return; }
    if (m.type === 'hands') { hands = m.numHands; await tracker?.setOptions({ numHands: hands }); return; }
    if (m.type === 'frame') {
      // MediaPipe dies for good if timestamps ever go backwards, so keep our own clock
      clock += 33;
      const res = tracker ? tracker.detectForVideo(m.bitmap, clock) : null;
      m.bitmap.close();
      const out = (res?.landmarks || []).map((pts, i) => ({
        score: res.handedness?.[i]?.[0]?.score ?? 0,
        side: res.handedness?.[i]?.[0]?.categoryName || '',
        // all 21 landmarks, normalised 0..1 in the (un-mirrored) camera picture
        pts: pts.map((p) => [p.x, p.y]),
      }));
      self.postMessage({ type: 'result', hands: out, id: m.id });
    }
  } catch (err) {
    m.bitmap?.close?.();
    self.postMessage({ type: m.type === 'init' ? 'failed' : 'result', hands: [], id: m.id, error: String(err) });
    // a failed frame can leave the tracker broken, so build a fresh one
    if (m.type === 'frame' && !restarting) {
      restarting = true; tracker = null;
      init(hands).catch(() => {}).finally(() => { restarting = false; });
    }
  }
};
