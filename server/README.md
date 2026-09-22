# Local Laya server

Runs [Laya](https://laya.convaiinnovations.com/) on this machine and answers unclutter's
classification requests. Nothing leaves the computer and there is no API key.

## Setup

```sh
npm run server:setup     # python3 -m venv server/.venv && pip install -r server/requirements.txt
npm run server           # first start downloads ~808 MB of weights to ~/.cache/huggingface
```

The server prints `listening on http://127.0.0.1:8765` when it is ready. Leave it running while
you browse; the extension only contacts it during **Analyze page**.

Useful flags: `--port`, `--device cpu|mps|cuda`, `--chunk N` (elements per forward pass),
`--model` / `--subfolder` to load a different checkpoint.

## Why this exists

Unclutter was written against TypeSafe's Jev, which takes the whole page as `state` and asks one
question per element. Laya's English checkpoint has a **512-token context**, and that shape does
not survive a real page: at 60 candidates the element list needs ~3,100 tokens and only ~335 fit,
so the model goes blind to the very element it is being asked about. Sent unmodified, every
element came back `ad` at ~0.55 probability and the extension produced zero rules.

The wire format is unchanged — unclutter still sends `{state, questions}` and still receives
`{answers}`. The adaptation happens inside this server:

|                            |                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Split the state**        | each question sees only its own element, plus `pageType`                                                                             |
| **Shorten the criteria**   | the shipped 7 categories run ~28 tokens each and crowd out the instruction in Laya's 192-token head budget; the replacements run ~14 |
| **Batch the forward pass** | all elements go through the encoder together, not one call each                                                                      |

Category _keys_ come from the request, so adding a category to `lib/model.ts` needs no change
here — only the descriptions are substituted, and unknown keys fall back to the client's own text.

## Measured on an M1 Pro (MPS)

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| throughput | ~44 ms/element batched (~2.5 s for a 60-element page)                  |
| accuracy   | 18/22 on a hand-labelled element set                                   |
| real pages | TechCrunch 36 candidates → 28 rules in 1.9 s; BBC News 10 → 7 in 0.5 s |

## API

```
POST /v1/systemone   {"state": {"pageType", "elements": [...]}, "questions": {id: {...}}}
                  -> {"model", "answers": {id: {type, choice, probabilities, confidence}}, "usage"}
GET  /health
```

Binds to loopback only by default. `--host 0.0.0.0` exposes unauthenticated inference to your
network; don't, unless you mean it.
