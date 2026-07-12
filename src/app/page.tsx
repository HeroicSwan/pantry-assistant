import { redirect } from "next/navigation";
import { getCurrentUser, resolveLandingPath } from "@/lib/auth/access";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? await resolveLandingPath() : "/sign-in");
}
