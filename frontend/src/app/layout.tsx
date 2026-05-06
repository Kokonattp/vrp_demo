import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VRP Simulation Studio",
  description: "Simulate vehicle routing scenarios over real map data."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
