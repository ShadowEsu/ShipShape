import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShipShape: launch and compliance checks for small teams",
  description:
    "Connect your code and your live site. ShipShape finds what will get you rejected, sued or fined, writes documents that match, and keeps checking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
