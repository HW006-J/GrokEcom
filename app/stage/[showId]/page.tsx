import StageClient from "./StageClient";

export default async function StagePage({
  params, searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { showId } = await params;
  const sp = await searchParams;
  return <StageClient showId={showId} mock={sp.mock === "1"} />;
}
