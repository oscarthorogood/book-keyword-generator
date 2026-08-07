import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST() {
  // signOut clears the Supabase session cookies through the SSR client.
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
