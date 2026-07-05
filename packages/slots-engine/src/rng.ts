/**
 * RNG provably fair, seedado e auditável.
 *
 * Fluxo:
 *  1. Antes da rodada o servidor gera `serverSeed` e publica APENAS
 *     `sha256(serverSeed)` (compromisso).
 *  2. O jogador fornece (ou recebe) um `clientSeed`; `nonce` é o contador
 *     de rodadas daquele par de seeds.
 *  3. O stream de aleatoriedade é HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${block}`).
 *  4. Após a rodada o servidor revela `serverSeed`; qualquer pessoa pode
 *     reproduzir o resultado com `verifyServerSeed` + novo ProvablyFairRNG.
 *
 * Nunca usa Math.random().
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

export interface RandomSource {
  /** Uniforme em [0, 1). */
  next(): number;
}

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

export function verifyServerSeed(serverSeed: string, committedHash: string): boolean {
  return hashServerSeed(serverSeed) === committedHash;
}

export class ProvablyFairRNG implements RandomSource {
  private block = 0;
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;

  constructor(
    private readonly serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce: number
  ) {}

  private refill(): void {
    this.buffer = createHmac("sha256", this.serverSeed)
      .update(`${this.clientSeed}:${this.nonce}:${this.block}`)
      .digest();
    this.block += 1;
    this.offset = 0;
  }

  /** Uniforme em [0, 1) com 32 bits de precisão, determinístico para (seeds, nonce). */
  next(): number {
    if (this.offset + 4 > this.buffer.length) this.refill();
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value / 0x1_0000_0000;
  }
}

/** RNG não-determinístico (CSPRNG) para simulações. */
export class CryptoRNG implements RandomSource {
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;

  next(): number {
    if (this.offset + 4 > this.buffer.length) {
      this.buffer = randomBytes(65536);
      this.offset = 0;
    }
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value / 0x1_0000_0000;
  }
}
