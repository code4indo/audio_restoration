import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "SoundPrism — AI Audio Separation & Restoration",
  description: "Separate any sound from audio using natural language. Like a prism splits light into colors, SoundPrism splits audio into individual sounds with state-of-the-art AI.",
  keywords: ["audio separation", "AI", "vocal removal", "stem separation", "audio editing", "sound isolation"],
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
