# Pronouncement Feature — Brainstorm

Add ElevenLabs text-to-speech audio pronouncements to certificate emails.

## What It Does

When a certificate is issued, generate a spoken audio clip (e.g. "A Certificate of Certified
Time Wasting is hereby awarded to Dan Revel in recognition of spectacular, world-class,
unapologetic wasting of time.") and include a hosted URL to it in the delivery email.

## Decisions Made

| Question | Decision |
|---|---|
| Audio delivery | Hosted public URL in the email (not an attachment) |
| Storage | R2, under an `audio/` prefix — public, no signed URLs |
| Voice selection | Per-site list of voice IDs in config; one picked randomly at generation time |
| Script inputs | `renderPronouncement(config, name, achievement, serial)` — same signature as `renderCertificate()` |
| Cost cap | $20 total spend; enforced via cumulative character count tracked in D1 |
| Cap / failure behavior | Graceful degradation — fall back to a pre-generated generic MP3 per site stored in R2 |

## Proposed Approach (A — recommended)

Generate audio inline in the existing queue consumer (`handleQueue`), right after the PNG render
and before the email is sent.

### New module: `src/tts.ts`
- Calls the ElevenLabs text-to-speech API
- Checks cumulative character budget (D1 `SUM`) before generating
- Returns MP3 bytes, or signals to use the fallback

### Caching
- Audio cached in R2 under `audio/{siteId}/` — same cache-key logic as PNGs
- Idempotent: if the R2 key already exists, skip the ElevenLabs call

### Budget tracking
- New D1 table `elevenlabs_usage` — one row per generation with `characters`, `voice_id`, `r2_key`, `created_at`
- Cap check: `SELECT SUM(characters) FROM elevenlabs_usage` before each call
- Configurable character limit derived from the $20 budget and the ElevenLabs plan rate

### Fallback
- One pre-generated generic MP3 per site (e.g. "A certificate from Master Time Waster has been awarded. Congratulations.")
- Stored in R2 at a well-known key (e.g. `audio/{siteId}/fallback.mp3`)
- Generated once via a one-time script; used when over budget or on API error

### Config additions (per-site JSON)
```json
{
  "elevenLabsVoiceIds": ["voice-id-1", "voice-id-2"],
  "elevenLabsFallbackR2Key": "audio/mtw/fallback.mp3"
}
```

### New secret
```
ELEVENLABS_API_KEY  (wrangler secret put, both envs)
ELEVENLABS_CHAR_LIMIT  (wrangler secret put or env var — computed from plan)
```

## Approaches Considered

| | Approach A (inline, D1 tracking) | Approach B (separate queue) | Approach C (KV budget tracking) |
|---|---|---|---|
| Infrastructure | D1 table + R2 keys | Two new queues + second email step | KV key |
| Audit trail | Yes | Yes | No |
| Consistency | Strong (D1) | Strong | Eventual (minor overage risk) |
| Complexity | Low | High | Low |
| **Chosen** | **Yes** | No | No |

## Next Steps

1. Resume this brainstorm and move into formal design + spec
2. Invoke `superpowers:writing-plans` to produce an implementation plan
3. Pre-generate fallback MP3s (needs ElevenLabs account + voice IDs chosen)
4. Add `ELEVENLABS_API_KEY` and `ELEVENLABS_CHAR_LIMIT` secrets via wrangler
