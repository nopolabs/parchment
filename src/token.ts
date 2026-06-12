// Personalization tokens — unguessable capabilities identifying one
// certificate. Possession authorizes exactly two things: viewing the
// certificate PNG and buying a print of it. Tokens are minted at
// POST /parchment/issue and resolved only by GET /parchment/cert/<token>;
// nothing else (in particular the recipient's email) is resolvable from one.
//
// Format: "tok_" + 128 random bits, base64url. Serials (BBPP-0042) are
// sequential and guessable — never use them as tokens.

const TOKEN_BYTES = 16;

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64url = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `tok_${base64url}`;
}
