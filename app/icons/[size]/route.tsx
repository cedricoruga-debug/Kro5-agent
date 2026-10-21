import { ImageResponse } from "next/og";

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === "512" ? 512 : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0d12",
          color: "#7cf0c8",
          fontSize: size * 0.3,
          fontWeight: 800,
          letterSpacing: -size * 0.01,
        }}
      >
        KRO5
      </div>
    ),
    { width: size, height: size },
  );
}
