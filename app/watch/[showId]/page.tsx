import WatchClient from "./WatchClient";

export default async function WatchPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  return <WatchClient showId={showId} />;
}
