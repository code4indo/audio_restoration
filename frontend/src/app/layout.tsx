import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Audio Archive Restoration - AI-Powered Audio Separation",
  description: "Separate any sound from audio using natural language. Remove vocals, extract instruments, eliminate background noise with state-of-the-art AI.",
  keywords: ["audio separation", "AI", "vocal removal", "stem separation", "audio editing"],
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
