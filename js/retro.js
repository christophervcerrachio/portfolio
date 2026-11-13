// The walk drawn the way an older machine drew (hardware.js STYLES). A style is not a filter laid over the full
// picture: the picture itself is made small, the way those machines made theirs, which is also what lets a weak
// computer draw it -
//   - its lines: the picture is `lines` high whatever the window (its width follows the window's shape), and the
//     browser scales it up, each pixel a hard square ('pixel') or blended ('smooth');
//   - its textures: no longer than the tier's texMax, and filtered as the machine filtered them ('nearest': hard
//     texels; 'nearest-mip': hard texels, their smaller copies far off; 'linear': smeared, with no smaller copies;
//     'trilinear');
//   - its corners (snap): each corner of every model moved to the nearest pixel of the picture, so models shiver as
//     they move across it;
//   - its textures' perspective (affine, 0-1): how far a texture is drawn straight across a triangle on the screen
//     rather than in depth, so it swims on a wall seen at a slant;
//   - its colours are the show pass's (backdrops/countryside.js SHOW_FRAG: uRetro, uRetroLv, uRetroFx): their levels and
//     dither, a 360's bloom and film-like tone, a Game Boy Advance's bright light.
// No fog: the land is seen as far as in the full look; what makes the picture light to draw is what is drawn far off -
// hardware.js TIERS. Everything here is set once, before any material is made: the shader pieces every material is
// built from are changed in place (three's ShaderChunk), so the land, the houses, the trees and the furniture all
// follow.
import * as THREE from 'three';

let active = null;
/** The style in force (hardware.js STYLES entry), or null: the full look. */
export const styleNow = () => active;

/** Every picture's filtering as the style has it, whatever the file or the loader asks for: read where the renderer
 *  reads it (the texture's own properties), so a texture made at any time, by any loader, follows. The world's maps
 *  (numbers: data textures), the renderer's own pictures (render targets, depth) and anything marked
 *  userData.keepFilter are left as they are. */
function forceFilters(kind) {
  const P = THREE.Texture.prototype;
  const pic = (t) => !(t.isDataTexture || t.isRenderTargetTexture || t.isDepthTexture || t.isCubeTexture || t.isData3DTexture || t.isDataArrayTexture
    || t.isCompressedTexture || t.isVideoTexture || t.isFramebufferTexture || t.userData?.keepFilter);
  const F = kind === 'linear' ? THREE.LinearFilter : THREE.NearestFilter;
  // ('nearest-mip': each texel hard, as 'nearest', but read from the texture's smaller copies where it is seen small -
  // a picture of 160 lines otherwise glitters wherever a far field or wall has more texels than it has pixels)
  const mip = kind === 'nearest-mip';
  for (const [key, forced] of [['magFilter', F], ['minFilter', mip ? THREE.NearestMipmapNearestFilter : F], ['generateMipmaps', mip], ['anisotropy', 1]]) {
    Object.defineProperty(P, key, {
      configurable: true,
      get() { return pic(this) ? forced : this['_' + key]; },
      set(v) { this['_' + key] = v; },
    });
  }
}

/** The corners snapped to the picture's pixels and the textures drawn straight across: three's own shader pieces,
 *  changed before any material is made. grid: half the picture's size in pixels (clip space runs -1 to 1). */
function patchChunks(style, grid) {
  const C = THREE.ShaderChunk, f = (v) => v.toFixed(4);
  let end = '';
  if (style.snap) {
    // (only what is before the eye, and only in a view with depth: a shadow's flat picture keeps its own places)
    end += `
if ( gl_Position.w > 0.0 && projectionMatrix[ 3 ][ 3 ] == 0.0 ) {
	gl_Position.xy = floor( gl_Position.xy / gl_Position.w * vec2( ${f(grid[0])}, ${f(grid[1])} ) + 0.5 ) / vec2( ${f(grid[0])}, ${f(grid[1])} ) * gl_Position.w;
}`;
  }
  if (style.affine > 0) {
    // (a varying is always carried in depth; one multiplied by w and divided again by a w carried the same way comes out
    // straight across the screen: w to a power between gives a part of each)
    end += `
#ifdef RETRO_UV
	{ float retroW = pow( max( gl_Position.w, 1e-4 ), ${f(style.affine)} ); vRetroUv = vec3( vMapUv * retroW, retroW ); }
#endif`;
    // (RETRO_UV: only a shader that has the texture's own place declared - one that draws points has not)
    C.uv_pars_vertex += '\n#ifdef USE_MAP\n\t#define RETRO_UV\n\tvarying vec3 vRetroUv;\n#endif\n';
    // (in depth until the projection says otherwise: a material with its own projection - the trees', swayed by the
    // wind - never reaches the lines above, and draws its textures as it always did)
    C.uv_vertex += '\n#ifdef RETRO_UV\n\tvRetroUv = vec3( vMapUv, 1.0 );\n#endif\n';
    C.uv_pars_fragment += '\n#ifdef USE_MAP\n\tvarying vec3 vRetroUv;\n#endif\n';
    C.map_fragment = C.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vRetroUv.xy / vRetroUv.z )');
  }
  if (end) C.project_vertex += end;
}

/**
 * Put a style in force. Call once, before any material or texture is made. Returns what the page needs of it:
 *   size(w, h)  the picture's size in pixels for a window w by h;
 *   show        what the show pass is told: { lines, levels (red, green, blue), dither (0 none, 1 a PlayStation's 4 x 4,
 *               2 fine noise, 3 the regular 4 x 4 cross-hatch of a 16-bit picture), sat, bloom (0: none), gamma (0: the
 *               picture's own light; below 1: brighter) };
 *   tone        'filmic' where the style finishes its picture with the film-like curve, else null.
 */
export function useStyle(style, canvas) {
  if (!style) return null;
  active = style;
  if (style.filter !== 'trilinear') forceFilters(style.filter);
  const w0 = canvas.clientWidth || innerWidth, h0 = canvas.clientHeight || innerHeight;
  const size = (w, h) => [Math.max(2, Math.round(style.lines * w / Math.max(1, h) / 2) * 2), style.lines];
  const [W, H] = size(w0, h0);
  if (style.snap || style.affine > 0) patchChunks(style, [W / 2, H / 2]);
  canvas.style.imageRendering = style.scaleUp === 'pixel' ? 'pixelated' : 'auto';
  return {
    size,
    show: { lines: style.lines, levels: (Array.isArray(style.bits) ? style.bits : [style.bits, style.bits, style.bits]).map((b) => 2 ** b - 1),
      dither: { bayer: 1, noise: 2, ordered: 3 }[style.dither] ?? 0, sat: style.sat ?? 1, bloom: style.bloom ?? 0, gamma: style.gamma ?? 0 },
    tone: style.tone ?? null,
  };
}
