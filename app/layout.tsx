import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Fira_Mono } from "next/font/google";
import StyledJsxRegistry from "./registry";
import type { Metadata } from "next";
import "./globals.css";

const fira = Fira_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "I am the fold",
  description:
    "An experiment to show how designing for The Fold can be treacherous",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fira.className}>
      <body className="bg-white dark:bg-dark text-dark dark:text-white">
        <StyledJsxRegistry>{children}</StyledJsxRegistry>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
