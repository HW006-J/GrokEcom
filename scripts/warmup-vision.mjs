import { warmupVision } from '../lib/grounded.mjs';
console.log('Preparing Grounding DINO and SAM2. The first run downloads model weights.');
await warmupVision();
console.log('Vision models cached and ready.');
