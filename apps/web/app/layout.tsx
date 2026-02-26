import "./styles/globals.css";
import "./styles/dashboard.css";

export const metadata = {
  title: "Smart Finance",
  description: "Finance intelligence dashboard",
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
