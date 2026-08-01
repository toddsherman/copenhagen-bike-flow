import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Copenhagen Bike Flow — A Summer Sunday in 60 Seconds";
const description =
  "A modeled day of bicycle traffic across Copenhagen, compressed into a one-minute loop.";

export const metadata: Metadata = {
  metadataBase: new URL("https://todd.sh"),
  title,
  description,
  alternates: { canonical: "/Copenhagen" },
  openGraph: {
    title,
    description,
    type: "website",
    url: "/Copenhagen",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: "@tdd",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07283b",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
