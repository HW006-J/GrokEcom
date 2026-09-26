// Share preview jobs across route bundles and development reloads.
const shared = globalThis as typeof globalThis & {
  selloutPreviews?: Map<string, string>;
  selloutPreviewJobs?: Map<string, Promise<void>>;
};
export const waitingPreviews = shared.selloutPreviews ??= new Map<string, string>();
export const previewJobs = shared.selloutPreviewJobs ??= new Map<string, Promise<void>>();
