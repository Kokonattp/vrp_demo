import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "สตูดิโอจำลอง VRP",
  description: "วางแผนและจำลองเส้นทางขนส่งบนแผนที่จริง"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
