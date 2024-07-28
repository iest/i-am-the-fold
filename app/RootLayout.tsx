import { Analytics } from "@vercel/analytics/react";
import { Fira_Mono } from "next/font/google";
import StyledJsxRegistry from "./registry";

const fira = Fira_Mono({
  weight: ["400", "700"],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fira.className}>
      <body>
        <StyledJsxRegistry>{children}</StyledJsxRegistry>
      </body>
      <Analytics />
    </html>
  );
}
