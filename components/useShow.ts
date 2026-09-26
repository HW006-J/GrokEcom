"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import type { Bid, Item, Message, Show } from "@/lib/types";

export type ShowState = {
  show: Show | null;
  item: Item | null;
  items: Item[];
  bids: Bid[];
  messages: Message[];
  error: string | null;
  loaded: boolean;
  lastEvent: number; // increments on any realtime insert (bids/messages)
};

// Loads a show + its items, keeps everything live via Supabase Realtime.
export function useShow(showId: string): ShowState {
  const [state, setState] = useState<ShowState>({
    show: null, item: null, items: [], bids: [], messages: [], error: null, loaded: false, lastEvent: 0,
  });
  const sbRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    let sb: SupabaseClient;
    try {
      sb = supabaseBrowser();
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, loaded: true }));
      return;
    }
    sbRef.current = sb;

    async function load() {
      const [showRes, itemsRes, bidsRes, msgRes] = await Promise.all([
        sb.from("shows").select("*").eq("id", showId).single(),
        sb.from("items").select("*").eq("show_id", showId).order("sort_order"),
        sb.from("bids").select("*").eq("show_id", showId).order("created_at", { ascending: false }).limit(20),
        sb.from("messages").select("*").eq("show_id", showId).order("created_at", { ascending: false }).limit(20),
      ]);
      if (showRes.error) {
        setState((s) => ({ ...s, error: showRes.error.message, loaded: true }));
        return;
      }
      const show = showRes.data as Show;
      const items = (itemsRes.data ?? []) as Item[];
      setState({
        show,
        items,
        item: items.find((i) => i.id === show.current_item_id) ?? null,
        bids: (bidsRes.data ?? []) as Bid[],
        messages: (msgRes.data ?? []) as Message[],
        error: null,
        loaded: true,
        lastEvent: 0,
      });
    }
    load();

    const channel = sb
      .channel(`show-${showId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shows", filter: `id=eq.${showId}` }, (p) => {
        const show = p.new as Show;
        setState((s) => ({ ...s, show, item: s.items.find((i) => i.id === show.current_item_id) ?? null }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `show_id=eq.${showId}` }, (p) => {
        setState((s) => {
          let items = s.items;
          if (p.eventType === "INSERT") items = [...items, p.new as Item].sort((a, b) => a.sort_order - b.sort_order);
          else if (p.eventType === "UPDATE") items = items.map((i) => (i.id === (p.new as Item).id ? (p.new as Item) : i));
          return { ...s, items, item: items.find((i) => i.id === s.show?.current_item_id) ?? null };
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bids", filter: `show_id=eq.${showId}` }, (p) => {
        setState((s) => ({ ...s, bids: [p.new as Bid, ...s.bids].slice(0, 20), lastEvent: s.lastEvent + 1 }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `show_id=eq.${showId}` }, (p) => {
        setState((s) => ({ ...s, messages: [p.new as Message, ...s.messages].slice(0, 20), lastEvent: s.lastEvent + 1 }));
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [showId]);

  return state;
}

export function useCountdown(endsAt: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

export const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${Math.round(Number(n))}`);
