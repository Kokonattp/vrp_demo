import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VRP Simulation Studio",
  description: "Plan, simulate, and export delivery routes on a real map."
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
