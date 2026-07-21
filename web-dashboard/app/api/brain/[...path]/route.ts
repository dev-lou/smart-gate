import { NextRequest, NextResponse } from "next/server";

const BRAIN_API_URL = process.env.BRAIN_API_URL || "http://localhost:8088";

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname.replace("/api/brain", "");
  const targetUrl = `${BRAIN_API_URL}${path}`;

  try {
    const body = await request.text();
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body,
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect to Brain API" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname.replace("/api/brain", "");
  const targetUrl = `${BRAIN_API_URL}${path}`;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to connect to Brain API" },
      { status: 500 }
    );
  }
}
