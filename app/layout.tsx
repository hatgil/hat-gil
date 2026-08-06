import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "바닷길 | 부산 해안 산책", description: "날씨와 해풍을 읽는 부산 해안 산책 경로" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ko"><body>{children}</body></html>; }
