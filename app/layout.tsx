import type { Metadata } from "next";
import "./styles/personal-board.css";

export const metadata: Metadata = {
  title: "My tasks",
  description: "A personal task board with Jira, notes and reminders.",
  icons: { icon: { url: "/favicon.png", type: "image/png" } },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
