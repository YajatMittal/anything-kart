// Runs MediaPipe hand tracking on a background thread so it can never stall the race.
self.module = { exports: {} };
self.exports = self.module.exports;
importScripts('/mediapipe/vision_bundle_worker.js');   // served as-is from public/mediapipe/
const { FilesetResolver, HandLandmarker } = self.module.exports;

const base = new URL('/mediapipe/', self.location.href).href;
let tracker = null, clock = 0, hands = 2, restarting = false, delegate = 'GPU';

async function init(numHands) {
  hands = numHands;
  const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
  const make = (d) => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: base + 'hand_landmarker.task', delegate: d },
    runningMode: 'VIDEO', numHands,
    // Hands partly hidden behind a held object score lower, so these are fairly relaxed. Faces or
    // clothes the detector fires on are filtered later: only the player's original pair is followed.
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
  });
  try { tracker = await make('GPU'); delegate = 'GPU'; } catch { tracker = await make('CPU'); delegate = 'CPU'; }
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
