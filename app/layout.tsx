import type { Metadata } from "next";
import { FX_RATE_SPEAKER_TITLE } from "@/lib/version";
import "./globals.css";

export const metadata: Metadata = {
  title: FX_RATE_SPEAKER_TITLE,
  description: "最新FXレートを一定時間ごとに日本語で読み上げます。",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
