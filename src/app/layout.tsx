import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Work_Sans } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
});

const workSans = Work_Sans({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["500", "600", "700"],
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "8 Ball Pool — Salão Clássico",
  description:
    "Salão de sinuca 8-Ball em 2.5D com física realista, efeito no taco, mira assistida e mesas públicas ou privadas.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0e0805",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${fraunces.variable} ${workSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0e0805] text-[#f3e8d2]">
        {children}
      </body>
    </html>
  );
}
