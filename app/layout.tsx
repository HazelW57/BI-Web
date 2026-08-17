import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Saphiant Commerce BI", description: "TikTok Shop P&L and SKU returns intelligence for Saphiant." };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
