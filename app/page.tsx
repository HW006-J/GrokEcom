import Link from "next/link";

const showId = process.env.NEXT_PUBLIC_SHOW_ID ?? "00000000-0000-0000-0000-000000000001";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">ClosetLive</h1>
        <p className="mt-2 text-zinc-400">AI avatar host that sells your wardrobe, live.</p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link href="/sell" className="rounded-xl bg-white text-black px-5 py-3 text-center font-semibold">
          Sell: list items from photos
        </Link>
        <Link href={`/stage/${showId}`} className="rounded-xl bg-zinc-800 px-5 py-3 text-center font-semibold">
          Stage: broadcast page
        </Link>
        <Link href={`/watch/${showId}`} className="rounded-xl bg-zinc-800 px-5 py-3 text-center font-semibold">
          Watch: audience page
        </Link>
      </div>
    </main>
  );
}
