import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Saphiant BI Control Room", description: "Internal commerce intelligence for returns, sales, P&L and price verification." };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
