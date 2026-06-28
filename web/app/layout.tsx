import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrailMate",
  description: "Your AI travel companion for Israel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
