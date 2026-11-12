// The depth buffer drawn reversed (near 1, far 0) in floating point: its precision even from the feet to the horizon,
// where the ordinary one lost it with the square of the distance (24 bits from 0.1 m: 6 mm at 100 m, 5 cm at 300 m, 60
// cm at 1 km - the yards' gravel, lawns and beds, 3 cm apart, and the pavements fought with what lay under them from a
// few hundred metres).
// three.js turns the cameras' projections itself (WebGLRenderer reverseDepthBuffer); its r170 sets the clip range the
// wrong way round when it switches, so the switch here sets the range and the depth's clear value itself.
// The sun's shadow pictures stay in the ordinary depth (their passes switch it off and on: sunshadow.js), so what reads
// them is unchanged; what reads the view's depth turns it back (countryside.js uRevZ); polygon offsets point the other
// way (wayribbons.js).
export const DEPTH = { reversed: false, ext: null };

/** Turn the reversed depth on for this renderer, if the browser can (EXT_clip_control). */
export function initDepth(renderer) {
  if (!renderer.capabilities.reverseDepthBuffer) return false;
  DEPTH.ext = renderer.getContext().getExtension('EXT_clip_control');
  if (!DEPTH.ext) return false;
  DEPTH.reversed = true;
  depthMode(renderer, true);
  return true;
}

/** Reversed (the view) or ordinary (the sun's shadow pictures) depth from here on. */
export function depthMode(renderer, reversed) {
  if (!DEPTH.reversed) return;
  const d = renderer.state.buffers.depth, ext = DEPTH.ext, gl = renderer.getContext();
  if (d.getReversed() !== reversed) d.setReversed(reversed);
  ext.clipControlEXT(ext.LOWER_LEFT_EXT, reversed ? ext.ZERO_TO_ONE_EXT : ext.NEGATIVE_ONE_TO_ONE_EXT);
  gl.clearDepth(reversed ? 0 : 1);
}

/** A polygon offset toward the camera, in either depth. */
export const towardCamera = (v) => (DEPTH.reversed ? -v : v);
