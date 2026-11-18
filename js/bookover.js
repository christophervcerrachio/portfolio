// The book at the screen's own resolution in every look, the glove in the look's own (18 Nov 2026). The book the walker
// holds (book.js) is drawn into the scene's picture with everything else, at the picture's size: an older machine's
// picture is a few hundred lines (retro.js), and a slower machine's full picture is drawn smaller and brought up
// (upscale.js) - the book's type came out as a few coarse pixels. Now:
//   - an older machine's look: its picture drawn at its own lines into the corner of the screen and taken as a texture,
//     then brought up to the whole screen here as the browser had brought its small canvas up (each pixel a hard
//     square, or blended with its neighbours, as the look has it); the book drawn at the screen's resolution and laid
//     over it, the glove's pixels kept where the look drew the glove in front of the book. In the scene's picture the
//     book is drawn as depth alone, so the glove behind it is hidden as before and nothing of a coarse book shows round
//     the sharp one; the glove's own cover is the picture's alpha, and the glove behind the book is drawn under it
//     without cover, so round the sharp book's edge the glove goes on behind it (book.js render)
//   - the full look drawn smaller: the book drawn at the screen's resolution over the picture brought up, under the glove
//   - the full look at the screen's own size: nothing here - the book is in the picture at its full resolution already
// The book is finished as the full look finishes its picture whatever the look (countryside.js SHOW_FRAG): sharpened,
// the sun's shafts where the look has them, the neutral tone, the evening's grade and the full look's darkened corners,
// a fine grain.
import * as THREE from 'three';
import { FULL_SHOW } from './backdrops/countryside.js';
import { EVE_GRADE } from './backdrops/evening.js';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */`
uniform sampler2D uBook; uniform vec2 uBookTexel; uniform float uHasBook; uniform float uFade;
uniform sampler2D uMask;
uniform vec4 uGrade; uniform vec3 uShadowTint; uniform vec3 uLightTint; uniform float uSharp;
uniform sampler2D uPic; uniform vec2 uSunUV; uniform float uSunVis; uniform float uRays; uniform vec3 uRayTint; uniform float uAspect;
#ifdef LOW
uniform sampler2D uLow; uniform vec2 uLowSize; uniform float uSmooth;
#endif
varying vec2 vUv;
// (three's own neutral tone, as the show pass has it: exposure 1)
vec3 neutralTone(vec3 color) {
  const float StartCompression = 0.8 - 0.04; const float Desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < StartCompression) return color;
  float d = 1. - StartCompression;
  float newPeak = 1. - d * d / (peak + d - StartCompression);
  color *= newPeak / peak;
  float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
// the book's pixel finished as the full look finishes its picture (countryside.js SHOW_FRAG, its own steps in order)
vec3 finishBook(vec4 B) {
  vec3 cC = B.rgb / B.a, sharp = cC;
  if (uSharp > 0.0 && B.a > 0.999) {
    vec4 N = texture2D(uBook, vUv + vec2(0.0, uBookTexel.y)), S = texture2D(uBook, vUv - vec2(0.0, uBookTexel.y));
    vec4 E = texture2D(uBook, vUv + vec2(uBookTexel.x, 0.0)), W = texture2D(uBook, vUv - vec2(uBookTexel.x, 0.0));
    // (only inside the book: at its edge its neighbours are what lies behind it, which this picture has not got)
    if (min(min(N.a, S.a), min(E.a, W.a)) > 0.999) {
      vec3 cN = N.rgb, cS = S.rgb, cE = E.rgb, cW = W.rgb;
      vec3 mn = min(cC, min(min(cN, cS), min(cE, cW))), mx = max(cC, max(max(cN, cS), max(cE, cW)));
      vec3 amp = sqrt(clamp(mn / max(mx, vec3(1e-4)), 0.0, 1.0));
      vec3 w = -uSharp * amp;
      sharp = clamp((cC + w * (cN + cS + cE + cW)) / (1.0 + 4.0 * w), mn, mx);
    }
  }
  float nearR = 1.0 - smoothstep(0.0, 0.9, length((vUv - uSunUV) * vec2(uAspect, 1.0)));
  if (uRays > 0.0 && uSunVis > 0.001 && nearR > 0.001) {
    vec2 st = (uSunUV - vUv) / 24.0;
    vec2 p = vUv + st * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float acc = 0.0, dec = 1.0;
    for (int i = 0; i < 24; i++) {
      p += st;
      vec2 pc = clamp(p, vec2(0.0), vec2(1.0));
      float l = dot(texture2D(uPic, pc).rgb, vec3(0.2126, 0.7152, 0.0722));
      float nearSun = 1.0 - smoothstep(0.04, 0.3, length((pc - uSunUV) * vec2(uAspect, 1.0)));
      acc += smoothstep(0.75, 1.8, l) * nearSun * dec; dec *= 0.97;
    }
    sharp += uRayTint * (acc / 24.0) * nearR * uSunVis * uRays;
  }
  vec3 c = toSRGB(neutralTone(sharp));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGrade.x);
  c = (c - 0.5) * uGrade.y + 0.5;
  c += uShadowTint * (1.0 - l) * (1.0 - l) + uLightTint * l * l;
  c = uGrade.z + c * (1.0 - uGrade.z);
  vec2 q = (vUv - 0.5) * vec2(1.0, 0.75);
  c *= 1.0 - uGrade.w * dot(q, q) * 2.2;
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return clamp(c, 0.0, 1.0);
}
void main() {
  vec4 B = uHasBook > 0.5 ? texture2D(uBook, vUv) : vec4(0.0);
  float a = clamp(B.a, 0.0, 1.0) * uFade;
  vec3 cb = a > 0.0 ? finishBook(B) : vec3(0.0);
#ifdef LOW
  // (each pixel of the look's picture: the glove where the look drew it in front of the book - its cover, m - else the
  // book over what lies behind it; the pixels taken as the browser took them, the nearest or the four round, weighed)
  vec3 hand = vec3(0.0), land = vec3(0.0); float under = 0.0;
  ivec2 last = ivec2(uLowSize) - 1;
  if (uSmooth > 0.5) {
    vec2 p = vUv * uLowSize - 0.5, f = fract(p); ivec2 i0 = ivec2(floor(p));
    for (int k = 0; k < 4; k++) {
      ivec2 o = ivec2(k & 1, k >> 1), t = clamp(i0 + o, ivec2(0), last);
      float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
      vec3 c = texelFetch(uLow, t, 0).rgb; float m = clamp(texelFetch(uMask, t, 0).a, 0.0, 1.0);
      hand += w * m * c; land += w * (1.0 - m) * c; under += w * (1.0 - m);
    }
  } else {
    ivec2 t = clamp(ivec2(floor(vUv * uLowSize)), ivec2(0), last);
    vec3 c = texelFetch(uLow, t, 0).rgb; float m = clamp(texelFetch(uMask, t, 0).a, 0.0, 1.0);
    hand = m * c; land = (1.0 - m) * c; under = 1.0 - m;
  }
  gl_FragColor = vec4(hand + under * a * cb + (1.0 - a) * land, 1.0);
#else
  // (over the picture already shown: the book where the glove is not, by the glove's cover in the scene's picture)
  float k = a * (1.0 - clamp(texture2D(uMask, vUv).a, 0.0, 1.0));
  gl_FragColor = vec4(cb * k, k);
#endif
}`;

/**
 * renderer: the walk's; scene: the countryside (its picture s.rt, its show pass's uniforms s.showU, its evening);
 * low: an older machine's look, its picture brought up here (retro.js); smooth: that look's pixels blended up, not
 * hard squares. Returns { low, showLow(draw), book(bookApi) }.
 */
export function makeBookOver({ renderer, scene: s, low = false, smooth = false }) {
  const U = s.showU;
  const grade = new THREE.Vector4();
  const uniforms = {
    uBook: { value: null }, uBookTexel: { value: new THREE.Vector2() }, uHasBook: { value: 0 }, uFade: U.uAlpha,
    uMask: { value: null },
    uGrade: { value: grade }, uShadowTint: U.uShadowTint, uLightTint: U.uLightTint, uSharp: { value: FULL_SHOW.sharp },
    uPic: U.uPic, uSunUV: U.uSunUV, uSunVis: U.uSunVis, uRays: U.uRays, uRayTint: U.uRayTint, uAspect: U.uAspect,
    uLow: { value: null }, uLowSize: { value: new THREE.Vector2(1, 1) }, uSmooth: { value: smooth ? 1 : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: low ? { LOW: 1 } : {},
    depthTest: false, depthWrite: false, toneMapped: false,
    ...(low ? { blending: THREE.NoBlending } : { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }),
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const pass = new THREE.Scene(); pass.add(quad);
  const cam = new THREE.Camera();
  let rt = null, lowTex = null;
  const size = new THREE.Vector2(), full = new THREE.Vector2();

  // (the book's own picture at the screen's resolution: linear light with its highlights, as the scene's picture is)
  function bookTarget() {
    renderer.getDrawingBufferSize(size);
    if (!rt) {
      const samples = Math.min(4, renderer.capabilities.maxSamples ?? 4);
      rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples, depthBuffer: true, type: s.rt?.texture.type ?? THREE.HalfFloatType });
      rt.texture.colorSpace = s.rt?.texture.colorSpace ?? THREE.LinearSRGBColorSpace;
    } else if (rt.width !== size.x || rt.height !== size.y) rt.setSize(size.x, size.y);
    return rt;
  }
  // (the full look's grade as the evening has it now - in an older machine's look its picture has no darkened corners,
  // the book has the full look's)
  function gradeNow() {
    grade.copy(U.uGrade.value);
    const k = s.evening?.k ?? 0, w0 = FULL_SHOW.grade[3];
    grade.w = w0 + (EVE_GRADE.w - w0) * k;
  }

  return {
    low,
    /** (an older machine's look) the show pass drawn into the screen's corner at the look's own size, and taken */
    showLow(draw) {
      const [W, H] = s.size, pr = renderer.getPixelRatio();
      if (!lowTex || lowTex.image.width !== W || lowTex.image.height !== H) {
        lowTex?.dispose();
        lowTex = new THREE.FramebufferTexture(W, H);
        uniforms.uLow.value = lowTex; uniforms.uLowSize.value.set(W, H);
      }
      renderer.setRenderTarget(null);
      renderer.getSize(full);
      renderer.setViewport(0, 0, W / pr, H / pr);
      draw();
      renderer.copyFramebufferToTexture(lowTex);
      renderer.setViewport(0, 0, full.x, full.y);
    },
    /** The book over the picture on the screen, at the screen's resolution (book: book.js's api, or null) - in an older
     *  machine's look the look's picture brought up with it, book or none */
    book(book) {
      const over = low || !!s.up;
      if (!over) return false;
      const drawn = !!book && book.renderFull(renderer, bookTarget());
      uniforms.uHasBook.value = drawn ? 1 : 0;
      if (drawn) { uniforms.uBook.value = rt.texture; uniforms.uBookTexel.value.set(1 / rt.width, 1 / rt.height); }
      uniforms.uMask.value = s.rt?.texture ?? null;
      if (!low && !drawn) return false;
      gradeNow();
      const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
      renderer.setRenderTarget(null); renderer.autoClear = false;
      renderer.render(pass, cam);
      renderer.autoClear = auto; renderer.setRenderTarget(prev);
      return drawn;
    },
    /** (dev) the book's own picture */
    get target() { return rt; },
    /** (prime: its programs made under the loading picture) */
    compile() { return renderer.compileAsync ? renderer.compileAsync(pass, cam) : Promise.resolve(); },
  };
}
