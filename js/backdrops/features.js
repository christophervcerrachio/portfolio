// What this build draws. As of 8 November 2026: no trees, no canopy masses, no rivers.
//
// Each of these is geometry, so each is switched off here rather than cut out: flip a flag back to true and the thing
// returns exactly as it was, at the same places, with the same seeds.
//
// What this does NOT reach: water baked into a picture. The ring round the hill and the valley of my painting carry
// their rivers as painted pixels (valley.js's uWater mask over plate.webp), so no flag can take them away without
// repainting the picture. Only the walkable region's own river, the estate's ponds and every tree are geometry.
export const FEATURES = {
  trees: false,   // every tree model: the hill's birches, each city's trees, the spa towns' and the estate's park trees
  canopy: false,  // the canopy masses laid over each city's forests (the green lumps sitting on the map's green)
  rivers: false,  // the region's river between the cities: its water, the channel cut for it, the banks blocking the walker
  ponds: false,   // the estate's two ponds (the Big Pond and the Lower Pond)
  copses: false,  // the plain's darker-green patches, which stand for masses of trees too far off to model
};
