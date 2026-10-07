export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** The caller's IP as reported by the hosting proxy. Stored with signatures as evidence. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
