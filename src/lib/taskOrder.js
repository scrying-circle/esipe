/**
 * Task Ordering Configuration & Helpers
 * 
 * TO CHANGE THE ORDERING:
 * 1. Change `mode`:
 *    - 'warmup_then_random': Warmup task(s) come first, remaining tasks are shuffled deterministically per student.
 *    - 'fixed': Strict manual order as listed in `manualOrder`.
 *    - 'fully_random': All tasks shuffled deterministically per student.
 * 2. To change the warmup task(s), edit `warmupTaskIds`.
 * 3. To customize the fixed order, edit `manualOrder` and set `mode: 'fixed'`.
 */
export const TASK_ORDER_CONFIG = {
  // Options: 'warmup_then_random' | 'fixed' | 'fully_random'
  mode: 'warmup_then_random',

  // Task IDs to show first (in this exact order) before randomized tasks
  warmupTaskIds: ['2d-rotation'],

  // Manual sequence of tasks used when mode is 'fixed'
  manualOrder: [
    'ray-circle-intersection',
    'projection',
    'rotation-scaling',
    'zoom',
    'cube-folding',
    'shadow',
    'planar distance',
    'csg'
  ]
};

// 32-bit string hash for consistent PRNG seeding
function hashStringToInt(str) {
  let hash = 2166136261;
  const s = String(str || 'default_seed');
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Mulberry32 deterministic pseudo-random number generator
function createPRNG(seed) {
  let s = seed >>> 0;
  return function() {
    let t = (s += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic Fisher-Yates shuffle seeded by string (e.g. 10-char student ID)
export function seededShuffle(array, seedStr) {
  const seed = hashStringToInt(seedStr);
  const rng = createPRNG(seed);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Returns triplets ordered according to the configuration and studentId seed.
 * 
 * @param {Array} triplets - The raw array of triplet objects from triplets.json
 * @param {string} studentId - The participant ID (e.g. random 10-char string)
 * @param {object} config - Configuration object (defaults to TASK_ORDER_CONFIG)
 * @returns {Array} The ordered array of triplets
 */
export function getOrderedTriplets(triplets, studentId = '', config = TASK_ORDER_CONFIG) {
  if (!triplets || triplets.length === 0) return [];

  const tripletMap = new Map(triplets.map(t => [t.id, t]));

  // Mode: Fixed manual order
  if (config.mode === 'fixed') {
    const ordered = [];
    for (const id of config.manualOrder) {
      if (tripletMap.has(id)) {
        ordered.push(tripletMap.get(id));
      }
    }
    // Append any triplets that might not be in manualOrder
    for (const t of triplets) {
      if (!config.manualOrder.includes(t.id)) {
        ordered.push(t);
      }
    }
    return ordered;
  }

  // Mode: Fully random
  if (config.mode === 'fully_random') {
    return seededShuffle(triplets, studentId);
  }

  // Mode: Warm-up then random (default)
  const warmupTriplets = [];
  const remainingTriplets = [];
  const warmupSet = new Set(config.warmupTaskIds || []);

  // 1. Add warmup tasks in their specified order
  for (const id of (config.warmupTaskIds || [])) {
    if (tripletMap.has(id)) {
      warmupTriplets.push(tripletMap.get(id));
    }
  }

  // 2. Collect remaining non-warmup tasks
  for (const t of triplets) {
    if (!warmupSet.has(t.id)) {
      remainingTriplets.push(t);
    }
  }

  // 3. Deterministically shuffle remaining tasks using studentId as seed
  const shuffledRemaining = seededShuffle(remainingTriplets, studentId);

  return [...warmupTriplets, ...shuffledRemaining];
}
