import { redirect } from "next/navigation";

/**
 * Root page — redirects to dashboard or login.
 */
export default function Home() {
  redirect("/auth/login");
}
