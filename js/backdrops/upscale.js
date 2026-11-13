// The scene's picture drawn on fewer pixels than the screen has, then brought up to the screen's size edge by edge
// (hardware.js `scale`): where the pixels are what each frame waits on, the land, the woods and the houses drawn on
// two-thirds of them cost about half as much, and this one pass gives most of the sharpness back.
// Each screen pixel is made from the 4 x 4 of the picture's pixels round it. Where they hold an edge - the slope of
// their brightness running one way - the filter is turned to lie along it and stretched along it, so the edge comes
// out one clean line, neither stair-stepped nor blurred across; where they hold no edge it is a plain sharp cubic.
// The show pass's own light sharpening crisps the result (countryside.js SHOW_FRAG).
// The picture is in linear light with its highlights (above 1): each colour is squashed into 0..1 by its brightest
// channel while it is weighed and let out again after, so a bright sky beside a dark trunk does not ring.
import * as THREE from 'three';

const UP_FRAG = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uSrcSize; uniform vec2 uDstSize;
vec3 inSq(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 outSq(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
vec3 px(ivec2 p) { return inSq(texelFetch(uSrc, clamp(p, ivec2(0), ivec2(uSrcSize) - 1), 0).rgb); }
// (the cubic: 1 at its middle, 0 one pixel out, a dip just beyond that keeps an edge crisp - the deeper the more
// negative A - and 0 from two out)
float cub(float x, float A) {
  x = abs(x);
  return x < 1.0 ? ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0 : x < 2.0 ? (((x - 5.0) * x + 8.0) * x - 4.0) * A : 0.0;
}
void main() {
  // (where the screen pixel's middle falls among the picture's pixels: B the picture pixel below and left of it, t how
  // far past B's middle)
  vec2 p = gl_FragCoord.xy * (uSrcSize / uDstSize) - 0.5, b = floor(p), t = p - b;
  ivec2 B = ivec2(b);
  vec3 c[16]; float y[16];
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec3 v = px(B + ivec2(i - 1, j - 1));
    c[j * 4 + i] = v; y[j * 4 + i] = dot(v, vec3(0.299, 0.587, 0.114));
  }
  // the slope of the brightness at the four picture pixels nearest, each from its neighbours either side, weighed by
  // how near it is: its squares summed, the way the slope runs and how much it all runs that one way
  vec4 wq = vec4((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  vec3 J = vec3(0.0);
  for (int q = 0; q < 4; q++) {
    int k = (q < 2 ? 5 : 9) + (q == 1 || q == 3 ? 1 : 0);
    float sx = 0.5 * (y[k + 1] - y[k - 1]), sy = 0.5 * (y[k + 4] - y[k - 4]);
    J += wq[q] * vec3(sx * sx, sx * sy, sy * sy);
  }
  float tr = J.x + J.z, df = J.x - J.z, rt = sqrt(df * df + 4.0 * J.y * J.y);
  // (1 where the slope all runs one way, 0 where it runs every way; and only where it is steep enough to be an edge,
  // not the grain of grass or bark)
  float one = rt / max(tr, 1e-6), steep = smoothstep(0.004, 0.03, sqrt(0.5 * (tr + rt)));
  float a = one * one * steep;
  // (the slope's direction from its doubled angle (df, 2 J.y), halved; turned back toward the picture's own rows
  // where there is no edge to lie along)
  vec2 d2 = rt > 1e-6 ? vec2(df, 2.0 * J.y) / rt : vec2(1.0, 0.0);
  vec2 G = vec2(sqrt(max(0.5 + 0.5 * d2.x, 0.0)), (d2.y < 0.0 ? -1.0 : 1.0) * sqrt(max(0.5 - 0.5 * d2.x, 0.0)));
  G = normalize(mix(vec2(1.0, 0.0), G, smoothstep(0.0, 0.25, a)));
  vec2 E = vec2(-G.y, G.x);
  // the filter: the cubic across the edge, a little narrower and its dip a little deeper the more of an edge it is;
  // along it, up to twice as wide
  float across = 1.0 + 0.2 * a, along = 1.0 / (1.0 + a), A = -0.75 - 0.25 * a;
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i - 1), float(j - 1)) - t;
    float w = cub(dot(o, G) * across, A) * cub(dot(o, E) * along, A);
    sum += c[j * 4 + i] * w; wsum += w;
  }
  vec3 r = sum / max(wsum, 1e-4);
  // (no brighter or darker than the four picture pixels round it: the dip's ring cut off)
  vec3 lo = min(min(c[5], c[6]), min(c[9], c[10])), hi = max(max(c[5], c[6]), max(c[9], c[10]));
  gl_FragColor = vec4(outSq(clamp(r, lo, hi)), 1.0);
}`;

/** The pass: upscale(renderer, src: the picture's texture, [w, h] its size, dst: the screen-sized target). */
export function makeUpscale() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uDstSize: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: UP_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();
  return {
    material: mat,
    upscale(renderer, src, [w, h], dst) {
      mat.uniforms.uSrc.value = src; mat.uniforms.uSrcSize.value.set(w, h); mat.uniforms.uDstSize.value.set(dst.width, dst.height);
      renderer.setRenderTarget(dst);
      renderer.render(scene, cam);
    },
  };
}
