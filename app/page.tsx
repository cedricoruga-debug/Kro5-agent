import { isAuthenticated } from "@/lib/auth";
import { Assistant } from "./assistant";
import { Login } from "./login";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (await isAuthenticated()) ? <Assistant /> : <Login />;
}
