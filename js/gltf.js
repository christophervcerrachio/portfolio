// One GLTFLoader setup for the site: the 3D assets are meshopt-compressed (EXT_meshopt_compression).
// Their pictures are shared files (assets\tex\<hash>.jpg, written by dev\tools\share_textures.py): a picture named by
// several models is fetched and decoded once for the whole site, and each model's texture is a copy of that one
// (three.js puts a picture on the card once for all its copies with the same settings). Before, every model carried its
// own copy inside it: 133.7 MB of pictures that were 39.9 MB of different ones.
// On a machine short of memory each picture is drawn down to the tier's size as it is read (texcap.js).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LoaderUtils } from 'three';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.mjs';
import { capBitmap } from './texcap.js';

const SHARED = new Map();                 // the picture's full address -> the first model's promise of its texture

class SharedPictures {
  constructor(parser) {
    this.name = 'SITE_shared_pictures';
    const own = parser.loadImageSource.bind(parser);
    parser.loadImageSource = (i, loader) => {
      const def = parser.json.images?.[i];
      if (parser.sourceCache[i] !== undefined) return own(i, loader);
      // (a picture inside the model itself: the model's own, capped as the shared ones are)
      if (!def?.uri || def.uri.startsWith('data:')) { const q = own(i, loader).then(capBitmap); parser.sourceCache[i] = q; return q; }
      const url = LoaderUtils.resolveURL(def.uri, parser.options.path);
      let p = SHARED.get(url);
      // (the capped promise is the one every later asker waits on, the parser's own cache included: none of them sees
      // the picture before it is its final size)
      if (!p) { p = own(i, loader).then(capBitmap); parser.sourceCache[i] = p; SHARED.set(url, p); p.catch(() => SHARED.delete(url)); return p; }
      const mine = p.then((t) => t.clone());
      parser.sourceCache[i] = mine;
      return mine;
    };
  }
}

// (the meshes' decoding off the page's own thread, in a few workers: a city's 27 MB of plain boxes or a tile of houses
// had been decoded in the frame it came in)
try { MeshoptDecoder.useWorkers?.(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))); } catch { /* (decoded here, then) */ }

export const gltfLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register((parser) => new SharedPictures(parser));
