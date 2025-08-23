import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: "AI Chat App",
  description: "Simple chat app with OpenAI GPT-3.5 Turbo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
