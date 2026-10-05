import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FX Rate Speaker v78",
  description: "最新FXレートを一定時間ごとに日本語で読み上げます。",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
