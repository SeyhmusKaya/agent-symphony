// Local anlamsal embedding — @huggingface/transformers MiniLM.
// API anahtari gerektirmez, ucretsiz, gizli (her sey local calisir).
// Paket kurulu degilse sessizce devre disi kalir; arama keyword'e duser.

type Pipe = (
  text: string,
  opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let pipe: Pipe | null = null;
let tried = false;

async function getPipe(): Promise<Pipe | null> {
  if (tried) return pipe;
  tried = true;
  try {
    const pkg = "@huggingface/transformers";
    const mod = (await import(pkg)) as {
      pipeline: (task: string, model: string) => Promise<Pipe>;
    };
    pipe = await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  } catch {
    pipe = null; // paket yok ya da model yuklenemedi — keyword aramaya dus
  }
  return pipe;
}

export async function embed(text: string): Promise<number[] | null> {
  const p = await getPipe();
  if (!p) return null;
  try {
    const out = await p(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch {
    return null;
  }
}

// Normalize edilmis vektorlerde dot product = kosinus benzerligi.
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}
