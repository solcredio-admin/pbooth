import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { currentAdmin } from "@/lib/server-api";
import { V } from "@/lib/v";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/dashboard");
  return (
    <>
      {/* Warm the cache while the admin types, so the intro starts instantly. */}
      <link rel="prefetch" href={`/logo-liquid.png?v=${V}`} />
      <div className="login"><LoginForm /></div>
      <ThemeToggle />
    </>
  );
}
