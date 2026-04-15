import type { Metadata } from "next";
import { Syne, Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import WalletHydrator from "@/components/wallet/WalletHydrator";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap"
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"],
  display: "swap"
});

export const metadata: Metadata = {
  title: "Punt",
  description: "15-minute CBTC prediction markets on Canton Network"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}
    >
      <body>
        <WalletHydrator />
        <Navbar />
        <main className="pt-16 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
