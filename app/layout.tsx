import type { Metadata } from "next";
import "./globals.css";
import "./wind.css";
import "./route.css";
import "./dynamic.css";
export const metadata: Metadata = { title: "그늘온 | 부산 보행 환경 경로", description: "그늘과 바람을 읽는 부산 보행 최적 경로" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ko"><body>{children}</body></html>; }
