import type { Metadata } from "next";
import "./globals.css";
import "./excel-dashboard.css";
export const metadata: Metadata = {
  title: "Saphiant Commerce BI",
  description: "TikTok Shop P&L and SKU returns intelligence for Saphiant.",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }], shortcut: "/favicon.svg", apple: "/favicon.svg" },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
