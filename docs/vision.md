# Photo selection architecture

The previous scanner asked a chat model to invent coordinates, checked them with
another chat-model call, priced every result, and generated a replacement product
image. A clean-room test passed while a crowded camera scene still produced wall,
face and clothing crops. That is not adequate localization validation.

## Options reviewed

| Option | Useful for | Limitation for this app |
| --- | --- | --- |
| [Ultralytics YOLO segmentation](https://docs.ultralytics.com/tasks/segment/) | Fast detection and masks in one pass | Standard pretrained models use COCO classes, which omit useful resale categories such as framed artwork. |
| [MediaPipe interactive segmentation](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter/web_js) | User-directed object selection in the browser | Needs a user prompt; not an automatic household-item identifier. |
| [Grounding DINO + SAM2](https://github.com/IDEA-Research/Grounded-SAM-2) | Text-conditioned localization followed by actual pixel masks | More compute than a small closed-class detector; small or occluded objects can still be missed. |
| [Transformers.js / ONNX Runtime](https://huggingface.co/docs/transformers.js/tutorials/node) | Run these models in the existing Node server, without a new hosted service or API key | Model weights must be downloaded and cached, and the server needs adequate memory. |

We use Grounding DINO Tiny and SAM2.1 Hiera Tiny via Transformers.js 4.3.0 / native
ONNX Runtime, with quantized weights. No model is universally best: this choice
supports the existing Node app, text-conditioned household classes and box-guided
segmentation. The benchmark and regression scene—not an advertised benchmark—
are the acceptance criteria here.

## Data flow

1. Normalize EXIF orientation and bound the image to 1280px. Keep this exact image
   as the source for every coordinate, mask, crop and browser overlay.
2. Grounding DINO searches a documented household vocabulary. Discard people,
   tiny regions, duplicates, and suggestions substantially covered by people.
3. SAM2 receives detector boxes. Encode the photo once, decode each object mask,
   and discard low-quality or empty masks. Bounds come from the accepted pixels.
4. Apply the alpha mask to the original RGB pixels, clear hidden background RGB,
   and export a lossless WebP crop. No image-generation API is used.
5. Return masks, images and unselected suggestions. No pricing or database writes
   happen while scanning. The auction API persists the items when a sale starts.
6. The user inspects the highlighted mask, chooses items, edits names or draws a
   replacement box. Manual additions must be named before selection. Selected
   items alone trigger price estimates.

The full-resolution mask lives in photo coordinates; its preview is resized
proportionally and rendered over the full, uncropped photo. Cutouts are capped
at 600px. The review is a scrollable vertical list with a fixed action footer.
The sale preview is a stable grid rather than moving objects.

## Runtime and limits

Run `npm run vision:warmup` once before testing. Downloads are cached in
`.cache/vision` (ignored by git); set `VISION_CACHE_DIR` to a persistent directory
on another host. Models initialize lazily in a server process. Cold downloads
can take substantially longer than warm scans. Native inference runs server-side;
no model bundle or GPU requirement is imposed on the phone.

Models are retained across development reloads, inference is serialized to avoid
CPU contention, and at most two photo contexts are retained. Cancel immediately
restores the camera and ignores any late response; already-started native
inference may finish in the server. The system does not promise real-time video
detection. Photos larger than 15 MB or 40 megapixels are rejected.

The vocabulary is deliberately limited and automatic detection is conservative.
A small lamp or obscured item may be missed. “Add missed item” and “Fix outline”
run the same segmenter on a user-supplied box, rather than falling back to guessed
LLM coordinates. A mask is a suggestion, and the user confirms what is sold.

## Verification

`node scripts/verify-vision.mjs /path/to/room.jpg /path/to/crowded-scene.jpg`

The test uses real local inference, real pricing for one selected item, and browser
interaction. It checks EXIF orientation, source-pixel fidelity in unscaled
cutouts, no automatic selection or pricing, selection and reload, manual region
segmentation, the crowded-scene regression, and cancellation of a delayed
response. It does not start an auction. Screenshots and timings are written to
`/tmp/grokecom-grounded-e2e` (override `OUTPUT`). The optional crowded fixture is
expected to contain no clearly saleable suggestions; it is not a generic test of
all photos containing people.
