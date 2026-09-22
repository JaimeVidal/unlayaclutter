#!/usr/bin/env python3
"""Local Laya decision server speaking unclutter's System One dialect.

Unclutter was built against TypeSafe's Jev, which takes the whole page as `state` and asks one
question per element. Laya's English checkpoint has a 512-token context, so that shape does not
survive contact with a real page: at 60 candidates the element list needs ~3100 tokens and only
~335 fit, leaving the model blind to the element it is being asked about.

This server keeps unclutter's wire format byte for byte and does the adaptation internally:

  * it splits the page state, giving each question only its own element;
  * it swaps the long safety-worded criteria for short ones that fit the 192-token head budget;
  * it runs every element in one batched forward pass instead of one call each.

Nothing leaves the machine.

    POST /v1/systemone   {"state": {...}, "questions": {...}}  ->  {"answers": {...}}
    GET  /health
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any, Dict, List, Tuple

import numpy as np
import torch

import laya
from laya.common import (
    QTYPES,
    build_sequence,
    collate_items,
    confidence_from_probs,
    temp_bucket,
)

log = logging.getLogger("laya-server")

MAX_ELEMENTS = 60
MAX_BODY_BYTES = 2_000_000
# Laya's head budget is 192 tokens for the instruction *and* every option. Unclutter's own
# criteria run ~28 tokens each, which crowds out the instruction; these run ~14 and measurably
# lift both accuracy and peak probability. Keys must match lib/model.ts `categories`.
SHORT_CRITERIA = {
    "keep": "real content, navigation, login, payment or paywall",
    "ad": "advertisement or empty ad slot",
    "cookie": "cookie or privacy consent banner",
    "promotion": "promotional or sales overlay",
    "newsletter": "newsletter signup invitation",
    "social": "social share or follow widget",
    "uncertain": "unclear",
}
SHORT_INSTRUCTIONS = "What kind of page element is this?"


class Decider:
    """Loads one Laya checkpoint and answers many single-element questions per forward pass."""

    def __init__(self, model_id: str, device: str | None, subfolder: str | None, chunk: int):
        self.agent = laya.load(model_id, device=device, subfolder=subfolder)
        self.chunk = max(1, chunk)
        self.lock = Lock()  # one model, many HTTP threads
        self.max_len = self.agent.cfg.get("max_len", 512)
        self.head_max_len = self.agent.cfg.get("head_max_len", 192)

    @property
    def device(self) -> str:
        return str(self.agent.device)

    def criteria(self, client_criteria: Dict[str, Any]) -> Dict[str, str]:
        """Keep the client's category keys; use short descriptions we know fit the head budget.

        An unknown key falls back to a trimmed version of whatever the client sent, so adding a
        category to lib/model.ts does not require touching this file.
        """
        out = {}
        for key, desc in client_criteria.items():
            short = SHORT_CRITERIA.get(key)
            out[key] = short if short else str(desc or key).strip()[:70]
        return out

    @torch.no_grad()
    def decide(self, states_and_criteria: List[Tuple[Any, Dict[str, str]]]) -> List[Dict[str, Any]]:
        """One choice decision per (state, criteria) pair, batched across differing states."""
        results: List[Dict[str, Any]] = []
        agent, model = self.agent, self.agent.model
        qtype = QTYPES["choice"]

        with self.lock:
            for start in range(0, len(states_and_criteria), self.chunk):
                window = states_and_criteria[start : start + self.chunk]
                items, keysets = [], []
                for state, criteria in window:
                    q = {"t": "choice", "ins": SHORT_INSTRUCTIONS, "crit": criteria}
                    seq, markers = build_sequence(agent.tok, state, q, self.max_len, self.head_max_len)
                    keys = list(criteria.keys())
                    if len(markers) != len(keys):
                        raise ValueError(
                            "criteria do not fit head_max_len=%d (%d options)"
                            % (self.head_max_len, len(keys))
                        )
                    items.append({"ids": seq, "markers": markers, "qtype": qtype})
                    keysets.append(keys)

                b = collate_items([items], agent.tok.pad_token_id)
                logits, _ = model(
                    b["input_ids"].to(agent.device),
                    b["attention_mask"].to(agent.device),
                    b["marker_pos"].to(agent.device),
                    b["marker_mask"].to(agent.device),
                    b["qtype"].to(agent.device),
                )
                logits = logits.float().cpu().numpy()

                for row, keys in enumerate(keysets):
                    k = len(keys)
                    scale = agent.temperature_by_options.get(
                        temp_bucket(qtype, k), agent.temperature[qtype]
                    )
                    z = logits[row, :k] / max(1e-3, float(scale))
                    p = np.exp(z - z.max())
                    p = p / p.sum()
                    results.append(
                        {
                            "type": "choice",
                            "choice": keys[int(p.argmax())],
                            "probabilities": {key: round(float(v), 4) for key, v in zip(keys, p)},
                            "confidence": round(confidence_from_probs(p, k), 4),
                        }
                    )
        return results


def element_state(page_type: Any, element: Dict[str, Any]) -> Dict[str, Any]:
    """The per-question state: one element, and the page kind for context."""
    state = {"pageType": str(page_type or "page")[:40]}
    for field in ("tag", "signals", "text", "position"):
        value = element.get(field)
        if value:
            state[field] = str(value)[:450]
    count = element.get("count")
    if isinstance(count, int) and count > 1:
        state["count"] = count
    return state


def evaluate(decider: Decider, payload: Dict[str, Any]) -> Dict[str, Any]:
    state = payload.get("state")
    questions = payload.get("questions")
    if not isinstance(state, dict) or not isinstance(questions, dict):
        raise ValueError("body must be {state: object, questions: object}")
    if not questions:
        return {"model": "laya-unclutter", "answers": {}, "usage": {"input_tokens": 0, "output_tokens": 0}}
    if len(questions) > MAX_ELEMENTS:
        raise ValueError("at most %d questions per request" % MAX_ELEMENTS)

    elements = state.get("elements")
    by_id = (
        {str(e.get("id")): e for e in elements if isinstance(e, dict)}
        if isinstance(elements, list)
        else {}
    )
    page_type = state.get("pageType")

    ids, batch = [], []
    for qid, question in questions.items():
        if not isinstance(question, dict) or question.get("type") != "choice":
            raise ValueError("question %r must be a choice question" % qid)
        criteria = question.get("criteria")
        if not isinstance(criteria, dict) or not criteria:
            raise ValueError("question %r has no criteria" % qid)
        # Question ids are element ids; fall back to the whole state if the client did not
        # send a matching element, so an unexpected payload degrades rather than crashes.
        element = by_id.get(str(qid))
        ids.append(qid)
        batch.append((element_state(page_type, element) if element else state, decider.criteria(criteria)))

    answers = decider.decide(batch)
    return {
        "model": "laya-unclutter",
        "answers": dict(zip(ids, answers)),
        "usage": {"input_tokens": 0, "output_tokens": 0},
    }


def make_handler(decider: Decider):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "laya-unclutter"

        def log_message(self, fmt, *args):
            log.info("%s %s", self.address_string(), fmt % args)

        def _send(self, code: int, body: Dict[str, Any]):
            raw = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            # The extension reaches us from a background service worker, which needs CORS.
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self._send(204, {})

        def do_GET(self):
            if self.path.rstrip("/") in ("/health", ""):
                self._send(200, {"ok": True, "model": "laya-unclutter", "device": decider.device,
                                 "max_elements": MAX_ELEMENTS})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path.rstrip("/") != "/v1/systemone":
                self._send(404, {"error": "not found; use POST /v1/systemone"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_BODY_BYTES:
                    raise ValueError("missing or oversized body")
                payload = json.loads(self.rfile.read(length))
            except Exception as exc:
                self._send(400, {"error": "bad request: %s" % exc})
                return
            try:
                started = time.perf_counter()
                result = evaluate(decider, payload)
                elapsed = (time.perf_counter() - started) * 1000
                log.info("%d elements in %.0f ms", len(result["answers"]), elapsed)
                self._send(200, result)
            except ValueError as exc:
                self._send(400, {"error": str(exc)})
            except Exception as exc:
                log.exception("inference failed")
                self._send(500, {"error": "inference failed: %s" % exc})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: loopback only)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="convaiinnovations/laya")
    parser.add_argument("--subfolder", default=None, help='e.g. "multilingual"')
    parser.add_argument("--device", default=None, help="mps, cpu, cuda (default: auto)")
    parser.add_argument("--chunk", type=int, default=24, help="elements per forward pass")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="[laya] %(message)s")
    log.info("loading %s ...", args.model)
    started = time.perf_counter()
    decider = Decider(args.model, args.device, args.subfolder, args.chunk)
    log.info("ready in %.1fs on %s", time.perf_counter() - started, decider.device)

    server = ThreadingHTTPServer((args.host, args.port), make_handler(decider))
    log.info("listening on http://%s:%d  (POST /v1/systemone)", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
