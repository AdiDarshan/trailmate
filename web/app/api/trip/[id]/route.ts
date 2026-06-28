// GET /api/trip/[id] — load a saved itinerary for the notebook (shareable).

import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data, error } = await supabase
    .from("trips")
    .select("id,title,dates,data")
    .eq("id", id)
    .single();

  if (error || !data) {
    return Response.json({ error: "Trip not found" }, { status: 404 });
  }
  // `data.data` holds the full itinerary JSON.
  return Response.json(data.data);
}
