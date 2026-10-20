// agent-reliability pure helpers. The functions that take the engine handle ($) live in
// register.ts: the runtime follows $ only into functions declared in the hook's own file.
type Web = {
  crypto: { subtle: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(s: string): Uint8Array };
};

export async function sha256(text: string): Promise<string> {
  const g = globalThis as unknown as Web;
  const buf = await g.crypto.subtle.digest('SHA-256', new g.TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
