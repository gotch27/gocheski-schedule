export async function labelsRequest<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/schedule/api/labels${path}`, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok || !body.ok || !body.data) {
    throw new Error(
      body.errors?.[0]?.publicMessage ?? body.errors?.[0]?.message ?? "Labels could not be loaded."
    );
  }
  return body.data as T;
}
