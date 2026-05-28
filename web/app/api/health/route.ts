import { json } from "@/lib/http";

export async function GET(): Promise<Response> {
  return json({ status: "ok" });
}
