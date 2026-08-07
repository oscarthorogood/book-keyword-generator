import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie, validatePassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    if (!validatePassword(password)) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = await createSession();
    const response = NextResponse.json({ success: true });

    // Set the auth cookie using the setSessionCookie function
    // But since we're in a route handler, we need to set it directly on the response
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
