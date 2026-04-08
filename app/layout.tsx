import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LouPlug Event Finder",
  description: "Louisville newsletter automation tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
