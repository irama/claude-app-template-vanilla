"""Jev classifier client — the GOLDEN Python copy.

Jev is a System One model: it returns a typed value with a calibrated confidence instead of
prose a program has to parse. Use it as the cheap first tier of a classifier cascade and send
only the low-confidence cases to an expensive model or to a person. The pattern, and when it is
the wrong tool, is in ``docs/classifier-cascade.md``.

This file is VENDORED. Every repo that uses Jev holds a byte-identical copy at ``lib/jev.py``.
There is no package. Edit the golden copy in the seed app template, copy it out again, and run
``scripts/jev-sync.py --update`` there so the checksum manifest matches. Never edit a vendored
copy in place: ``scripts/jev-sync.py`` will report it as drift.

No dependencies. Standard library ``urllib`` only.

Usage::

    result = ask_jev(
        {"subject": "Invoice 4021", "body": "..."},
        {
            "is_spam": {"type": "noul", "instructions": "The message is unsolicited bulk mail."},
            "kind": {
                "type": "choice",
                "instructions": "Classify the message.",
                "criteria": {"spam": "Unsolicited.", "work": "Professional."},
            },
        },
        app_url="https://example.tld",
        app_name="Example",
    )
    if result is None:
        pass  # Shadow mode is off. Nothing was sent. Use the existing rule.

The seven traps below were each found by a failing live call, not by reading documentation. The
client enforces the first five so a caller gets a local error instead of an HTTP 400 or, worse,
a plausible wrong answer.

 1. The field is ``instructions``, never ``question``. ``question`` returns HTTP 400.
 2. ``choice`` requires ``criteria`` as an object of option name to description.
 3. ``score`` requires ``criteria`` as an array of anchor descriptions.
 4. ``noul`` takes no ``criteria``, and its answer carries NO confidence field. Threshold a noul
    on the probability itself, with a band around 0.5 as the uncertain zone. See noul_verdict.
 5. There is no per-row iteration. An ``each`` key is silently ignored and one answer comes back
    for the whole batch, which looks like a working call and is not. Batch by emitting many
    NAMED questions over one shared state.
 6. Jev is absent from OpenRouter's public ``/api/v1/models`` list. Never probe for it there.
 7. The response carries the resolved dated model (``typesafe/jev-1.13-20260917``). Record that,
    never the request alias.

Provider routing is sent on every call. ``data_collection: "deny"`` excludes any upstream
provider that trains on or retains prompts, so retention is a decision this code makes rather
than whatever the OpenRouter account default happens to be. Pass ``provider=None`` to send no
block at all, and read ``JEV_DEFAULT_PROVIDER_ROUTING`` before you do.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random as _random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, Optional

JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
JEV_DEFAULT_MODEL = "typesafe/jev-1.13"

#: OpenRouter provider routing, sent as the request's ``provider`` block.
#:
#: Verified live against the alpha decisions endpoint on 2026-09-20: the block is accepted, and
#: a ``provider.only`` naming no serving provider comes back HTTP 404, which is how we know the
#: preference is read rather than ignored. An unknown FIELD inside the block is accepted with a
#: 200, so acceptance of ``zdr`` is not proof that zero data retention was applied.
#:
#: Deny is the default because a classifier cascade sends the app's private content to this
#: boundary, and the cheap tier sees the same text the expensive tier would.
JEV_DEFAULT_PROVIDER_ROUTING: Dict[str, Any] = {
    "data_collection": "deny",
    "allow_fallbacks": True,
}

#: Tells "the caller did not choose" apart from "the caller chose to send no provider block".
_PROVIDER_UNSET = object()

#: Statuses and words that mark a refusal of the PROVIDER BLOCK rather than of the request.
_PROVIDER_POLICY_STATUSES = (400, 404, 422, 501)
_PROVIDER_POLICY_HINTS = ("provider", "data_collection", "data collection", "zdr")

CIRCUIT_FAILURE_THRESHOLD = 5
CIRCUIT_COOLDOWN_SECONDS = 60.0


class JevError(Exception):
    """Every failure mode of the client.

    A caller catches this and falls back to the code Jev was proposed to replace. The fallback
    is never optional: this endpoint is alpha.

    ``kind`` is one of: disabled, not-configured, request-invalid, response-invalid, incomplete,
    http, provider-policy-rejected, timeout, network, circuit-open.
    """

    def __init__(
        self,
        kind: str,
        message: str,
        status: Optional[int] = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.retryable = retryable


@dataclass
class JevResult:
    #: The RESOLVED dated model from the response, never the request alias. Record this.
    model: str
    answers: Dict[str, Any]
    usage: Optional[Dict[str, Any]]
    provider: Optional[str]
    latency_ms: int


@dataclass
class _Circuit:
    failures: int = 0
    opened_at: float = 0.0


#: One breaker per credential, or per caller-supplied scope.
#:
#: A module-global breaker counted every caller's failures together, so five revoked keys
#: belonging to five different users opened it and cost everyone else a 60-second
#: ``circuit-open``. The breaker exists to stop a DEAD ENDPOINT costing a timeout per item, so it
#: is keyed by the credential and only shared failures reach it. See _is_shared_circuit_failure.
_circuits: Dict[str, _Circuit] = {}


def _circuit_key(api_key: str, scope: Optional[str] = None) -> str:
    """The key a breaker is stored under.

    A raw credential is never used as the key: a short blake2b digest plus the length tells two
    keys apart, which is all the breaker needs.
    """
    if scope:
        return "scope:%s" % scope
    digest = hashlib.blake2b(api_key.encode("utf-8"), digest_size=8).hexdigest()
    return "key:%s:%d" % (digest, len(api_key))


def _circuit_is_open(entry: Optional[_Circuit], clock: Callable[[], float]) -> bool:
    if entry is None:
        return False
    return (
        entry.failures >= CIRCUIT_FAILURE_THRESHOLD
        and clock() - entry.opened_at < CIRCUIT_COOLDOWN_SECONDS
    )


def _is_shared_circuit_failure(error: JevError) -> bool:
    """Only a failure every caller would share may open a breaker.

    A 400 is one caller's malformed request and a 401 or 403 is one caller's credential. Counting
    either one punishes every other caller for a fault they cannot see and cannot fix.
    """
    if error.kind in ("network", "timeout"):
        return True
    if error.kind != "http":
        return False
    status = error.status or 0
    return status == 429 or status >= 500


def reset_jev_circuit(scope: Optional[str] = None) -> None:
    """Tests and a deliberate manual recovery use this. Nothing in normal operation does.

    With no scope it clears every breaker. Pass the caller scope to clear just that one.
    """
    if scope is None:
        _circuits.clear()
        return
    _circuits.pop("scope:%s" % scope, None)


def jev_circuit_state(
    now: Optional[Callable[[], float]] = None,
    scope: Optional[str] = None,
) -> str:
    """The breaker state for one caller scope, or, with no scope, whether ANY breaker is open.

    The no-scope form is for monitoring: it never decides whether a call goes out.
    """
    clock = now or time.monotonic
    if scope is not None:
        return "open" if _circuit_is_open(_circuits.get("scope:%s" % scope), clock) else "closed"
    return "open" if any(_circuit_is_open(e, clock) for e in _circuits.values()) else "closed"


def jev_shadow_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    """The kill switch, deliberately independent of OPENROUTER_API_KEY.

    Several apps reach their EXISTING model through the same OpenRouter key, so removing the key
    would disable the fallback as well and prove nothing. Fault injection targets Jev alone.
    """
    source = os.environ if env is None else env
    return str(source.get("JEV_SHADOW_ENABLED", "")).strip().lower() in {"1", "true", "yes", "on"}


def noul_verdict(probability: float, band: float = 0.15) -> str:
    """A noul answers a condition with a probability and NO confidence.

    The uncertain zone is therefore a band around 0.5 rather than a confidence floor. Trap 4.
    Returns "true", "false" or "uncertain".
    """
    if probability >= 0.5 + band:
        return "true"
    if probability <= 0.5 - band:
        return "false"
    return "uncertain"


def jev_confidence(answer: Dict[str, Any]) -> Optional[float]:
    """The confidence of an answer, or None for a noul, which never carries one."""
    if answer.get("type") == "noul":
        return None
    return answer.get("confidence")


# ---------------------------------------------------------------------------
# Request validation — traps 1 to 5
# ---------------------------------------------------------------------------


def validate_jev_questions(questions: Dict[str, Any]) -> None:
    """Reject locally what the endpoint rejects with a 400, plus the one it accepts and gets wrong.

    Exported so a caller can check a question set it built at startup rather than in production.
    """
    if not isinstance(questions, dict) or not questions:
        raise JevError("request-invalid", "questions must be a non-empty mapping of name to question.")
    for name, question in questions.items():
        # Trap 5: `each` is silently ignored and yields one answer for the whole batch.
        if name == "each":
            raise JevError(
                "request-invalid",
                'There is no per-row iteration. An "each" key is ignored and returns a single '
                "answer for the whole batch. Emit one named question per row over a shared "
                "state instead.",
            )
        if not isinstance(question, dict):
            raise JevError("request-invalid", 'Question "%s" must be a mapping.' % name)
        # Trap 1: the field is `instructions`. `question` returns HTTP 400.
        if "question" in question:
            raise JevError(
                "request-invalid",
                'Question "%s" carries a "question" field. The field is "instructions"; '
                '"question" returns HTTP 400.' % name,
            )
        instructions = question.get("instructions")
        if not isinstance(instructions, str) or not instructions.strip():
            raise JevError(
                "request-invalid",
                'Question "%s" needs a non-empty "instructions" string.' % name,
            )
        kind = question.get("type")
        if kind == "noul":
            # Trap 4: noul takes no criteria.
            if "criteria" in question:
                raise JevError(
                    "request-invalid",
                    'Question "%s" is a noul and must not carry "criteria".' % name,
                )
        elif kind == "choice":
            # Trap 2: choice requires criteria as an object of option name to description.
            criteria = question.get("criteria")
            if not isinstance(criteria, dict) or len(criteria) < 2:
                raise JevError(
                    "request-invalid",
                    'Question "%s" is a choice and needs "criteria" as an object of at least '
                    "two option names to descriptions. Omitting it returns HTTP 400." % name,
                )
            for option, description in criteria.items():
                if not isinstance(description, str) or not description.strip():
                    raise JevError(
                        "request-invalid",
                        'Choice "%s" option "%s" needs a non-empty description.' % (name, option),
                    )
        elif kind == "score":
            # Trap 3: score requires criteria as an ARRAY of anchor descriptions.
            criteria = question.get("criteria")
            if not isinstance(criteria, list) or len(criteria) < 2:
                raise JevError(
                    "request-invalid",
                    'Question "%s" is a score and needs "criteria" as an array of at least two '
                    "anchor descriptions. Omitting it returns HTTP 400." % name,
                )
            for anchor in criteria:
                if not isinstance(anchor, str) or not anchor.strip():
                    raise JevError("request-invalid", 'Score "%s" has an empty anchor.' % name)
        else:
            raise JevError(
                "request-invalid",
                'Question "%s" has type "%s". Use noul, choice or score.' % (name, kind),
            )


# ---------------------------------------------------------------------------
# Response validation — completeness, and trap 7
# ---------------------------------------------------------------------------


def _finite(value: Any) -> bool:
    """A real number. `math.isfinite`, because `value == value` lets Infinity through.

    A malformed response carrying `Infinity` decodes to `float("inf")`, which equals
    itself, so the old NaN-only check accepted it where the TypeScript client rejects
    every non-finite value. The two clients now agree.
    """
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _declared_options(question: Dict[str, Any]) -> Optional[set]:
    """The option names a question declared, or None for a noul, which declares none.

    A ``choice`` declares its options as the KEYS of its criteria object. A ``score`` declares its
    anchors as an array, and the endpoint reports them back by their INDEX as a string, so "0" and
    "1" are the declared names for a two-anchor score. Both are the taxonomy the answer must stay
    inside.
    """
    kind = question.get("type")
    criteria = question.get("criteria")
    if kind == "choice" and isinstance(criteria, dict):
        return set(criteria.keys())
    if kind == "score" and isinstance(criteria, (list, tuple)):
        return {str(index) for index in range(len(criteria))}
    return None


def _number_map(name: str, field: str, value: Dict[str, Any], allowed: set) -> Dict[str, float]:
    """A map of declared option names to probabilities, or a response-validation error.

    The KEYS and the VALUES both matter, and the client is the only place that can check either,
    because it is the only place holding the question definitions the caller passed in. A key
    outside the declared option set is content the model invented, and a value that is not a
    probability is content too. Both are refused here, where the answer is still refusable, rather
    than stripped later by a downstream whitelist that may not be looking.
    """
    out: Dict[str, float] = {}
    for key, entry in value.items():
        key = str(key)
        if key not in allowed:
            raise JevError(
                "response-invalid",
                'Answer "%s" has a "%s" key "%s" that is not a declared option of that question. '
                "The declared options are: %s." % (name, field, key, ", ".join(sorted(allowed))),
            )
        if not _finite(entry) or not 0 <= entry <= 1:
            raise JevError(
                "response-invalid",
                'Answer "%s" has a "%s" value for "%s" that is not a finite number in 0 to 1. '
                "Anything else is content, and the answer is refused rather than cleaned."
                % (name, field, key),
            )
        out[key] = float(entry)
    return out


def _string_map(name: str, field: str, value: Dict[str, Any], allowed: set) -> Dict[str, str]:
    """A map of declared option names to non-empty strings, or a response-validation error."""
    out: Dict[str, str] = {}
    for key, entry in value.items():
        key = str(key)
        if key not in allowed:
            raise JevError(
                "response-invalid",
                'Answer "%s" has a "%s" key "%s" that is not a declared anchor of that question. '
                "The declared anchors are: %s." % (name, field, key, ", ".join(sorted(allowed))),
            )
        if not isinstance(entry, str) or entry == "":
            raise JevError(
                "response-invalid",
                'Answer "%s" has a "%s" value for "%s" that is not a non-empty string.'
                % (name, field, key),
            )
        out[key] = entry
    return out


def _validate_usage(value: Any) -> Optional[Dict[str, Any]]:
    """The usage block, or None. Never an unchecked read.

    Usage is metadata a caller records as cost, so a string where a number belongs must not reach
    a spend record. It is also not load-bearing, so a shape this client does not recognise reads
    as "no usage reported" rather than failing the whole call.
    """
    if not isinstance(value, dict):
        return None
    fields = ("input_tokens", "output_tokens", "cost")
    if not all(_finite(value.get(field)) for field in fields):
        return None
    return {field: float(value[field]) for field in fields}


def _validate_answer(name: str, question: Dict[str, Any], raw: Any) -> Dict[str, Any]:
    """One answer, checked against the QUESTION that asked for it, not merely against its shape.

    The client holds the question definitions because the caller passed them, so it is the one
    place that can tell a declared option from an invented one. Every choice, every probability
    key and every legend key must name something the question declared, and every probability,
    score, noul and confidence must be a finite number in 0 to 1. An answer outside the declared
    taxonomy is a ``response-invalid`` error here; it is never something a downstream whitelist
    strips after the fact.
    """
    expected = question["type"]
    if not isinstance(raw, dict):
        raise JevError("response-invalid", 'Answer "%s" is not an object.' % name)
    if raw.get("type") != expected:
        raise JevError(
            "response-invalid",
            'Answer "%s" is type "%s" but "%s" was asked.' % (name, raw.get("type"), expected),
        )
    if expected == "noul":
        probability = raw.get("noul")
        if not _finite(probability) or not 0 <= probability <= 1:
            raise JevError("response-invalid", 'Answer "%s" has no probability in 0 to 1.' % name)
        return {"type": "noul", "noul": float(probability)}

    confidence = raw.get("confidence")
    if not _finite(confidence) or not 0 <= confidence <= 1:
        raise JevError("response-invalid", 'Answer "%s" has no confidence in 0 to 1.' % name)

    allowed = _declared_options(question) or set()

    if expected == "choice":
        if not isinstance(raw.get("choice"), str) or not raw["choice"]:
            raise JevError("response-invalid", 'Answer "%s" has no choice.' % name)
        if raw["choice"] not in allowed:
            raise JevError(
                "response-invalid",
                'Answer "%s" chose "%s", which is not a declared option of that question. '
                "The declared options are: %s."
                % (name, raw["choice"], ", ".join(sorted(allowed))),
            )
        if not isinstance(raw.get("probabilities"), dict):
            raise JevError("response-invalid", 'Answer "%s" has no probabilities.' % name)
        return {
            "type": "choice",
            "choice": raw["choice"],
            "probabilities": _number_map(name, "probabilities", raw["probabilities"], allowed),
            "confidence": float(confidence),
        }

    score = raw.get("score")
    if not _finite(score) or not 0 <= score <= 1:
        raise JevError("response-invalid", 'Answer "%s" has no score in 0 to 1.' % name)
    legend = raw.get("legend")
    probabilities = raw.get("probabilities")
    return {
        "type": "score",
        "score": float(score),
        "legend": (
            _string_map(name, "legend", legend, allowed) if isinstance(legend, dict) else None
        ),
        "probabilities": (
            _number_map(name, "probabilities", probabilities, allowed)
            if isinstance(probabilities, dict)
            else None
        ),
        "confidence": float(confidence),
    }


def parse_jev_response(body: Any, questions: Dict[str, Any], latency_ms: int) -> JevResult:
    """Turn a decoded response body into a result, or raise.

    The completeness check is the load-bearing part. A missing named answer raises; it never
    returns None. That is what catches trap 5, where an ignored ``each`` key returns one answer
    for a batch of many and every other call site sees a plausible success.
    """
    if not isinstance(body, dict):
        raise JevError("response-invalid", "Response body is not an object.")
    # Trap 7: the resolved dated model, from the response.
    model = body.get("model")
    if not isinstance(model, str) or not model.strip():
        raise JevError("response-invalid", "Response carries no resolved model version.")
    raw_answers = body.get("answers")
    if not isinstance(raw_answers, dict):
        raise JevError("response-invalid", "Response carries no answers object.")
    missing = [name for name in questions if name not in raw_answers]
    if missing:
        raise JevError(
            "incomplete",
            "Response is missing %d of %d named answers: %s. A missing answer is an error, "
            "never a silent undefined." % (len(missing), len(questions), ", ".join(missing)),
        )
    # An answer NAME the caller never asked for is content too. An undeclared name used to be
    # ignored here and survived into whatever raw-answer record an app kept, because a value
    # whitelist constrains values and says nothing about keys.
    undeclared = [name for name in raw_answers if name not in questions]
    if undeclared:
        raise JevError(
            "response-invalid",
            "Response carries %d answer name(s) that were never asked: %s. An undeclared answer "
            "name is refused, never ignored." % (len(undeclared), ", ".join(map(str, undeclared))),
        )
    answers = {
        name: _validate_answer(name, question, raw_answers[name])
        for name, question in questions.items()
    }
    usage = _validate_usage(body.get("usage"))
    provider = body.get("provider") if isinstance(body.get("provider"), str) else None
    return JevResult(model=model, answers=answers, usage=usage, provider=provider, latency_ms=latency_ms)


# ---------------------------------------------------------------------------
# The call
# ---------------------------------------------------------------------------


@dataclass
class _Response:
    status: int
    headers: Dict[str, str] = field(default_factory=dict)
    body: bytes = b""


def _urllib_transport(
    url: str, headers: Dict[str, str], body: bytes, timeout: float
) -> _Response:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _Response(
                status=response.status,
                headers={k.lower(): v for k, v in response.headers.items()},
                body=response.read(),
            )
    except urllib.error.HTTPError as error:  # a 4xx or 5xx is a response, not a failure
        return _Response(
            status=error.code,
            headers={k.lower(): v for k, v in (error.headers or {}).items()},
            body=error.read(),
        )


def _rejects_provider_policy(status: int, text: str) -> bool:
    """Did the endpoint refuse the provider block, rather than the request?

    A caller has to be able to tell that apart from an ordinary failure, because the decision it
    forces is a policy one: proceed without the routing constraint, or do not send the content.
    """
    if status not in _PROVIDER_POLICY_STATUSES:
        return False
    lower = text.lower()
    return any(hint in lower for hint in _PROVIDER_POLICY_HINTS)


def _retry_after_seconds(headers: Dict[str, str]) -> Optional[float]:
    raw = headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        pass
    try:
        return max(0.0, parsedate_to_datetime(raw).timestamp() - time.time())
    except (TypeError, ValueError):
        return None


def ask_jev(
    state: Any,
    questions: Dict[str, Any],
    api_key: Optional[str] = None,
    app_url: Optional[str] = None,
    app_name: Optional[str] = None,
    model: Optional[str] = None,
    provider: Any = _PROVIDER_UNSET,
    timeout_s: float = 20.0,
    budget_s: Optional[float] = None,
    max_attempts: int = 3,
    base_delay_s: float = 0.25,
    max_delay_s: float = 8.0,
    ignore_shadow_flag: bool = False,
    circuit_scope: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    transport: Optional[Callable[[str, Dict[str, str], bytes, float], _Response]] = None,
    sleep: Optional[Callable[[float], None]] = None,
    rand: Optional[Callable[[], float]] = None,
    now: Optional[Callable[[], float]] = None,
) -> Optional[JevResult]:
    """Ask Jev.

    Returns None when JEV_SHADOW_ENABLED is off, WITHOUT touching the network. Raises JevError on
    every failure, so a call site can catch once and fall back. Retries 429 and 5xx with
    exponential backoff plus full jitter, honours retry-after within the call budget, and opens a
    circuit breaker after repeated failure so a dead endpoint costs one raised exception rather
    than a timeout per item.

    ``provider`` is the routing policy for this call and defaults to JEV_DEFAULT_PROVIDER_ROUTING,
    which denies data collection. Pass ``provider=None`` to send no provider block, which hands
    retention back to the account default: only a caller sending nothing private should do that.
    An endpoint that refuses the policy raises kind ``provider-policy-rejected`` and is never
    retried, so the caller decides whether to send the content under a weaker policy.

    ``circuit_scope`` names the circuit breaker this call belongs to. It defaults to a
    fingerprint of the API key, so one tenant's failures never open the breaker on another's.
    Name a scope when several callers share one key and you want them isolated, or when one
    caller uses several keys and you want them counted together.

    ``budget_s`` is the wall-clock budget for the whole call, retries and backoff waits included,
    and defaults to ``timeout_s * max_attempts``. Every attempt's timeout is clamped to what is
    left of the budget, an attempt with nothing left is refused, and a wait that would outlive the
    budget is refused, so a generous Retry-After or a slow provider produces a recorded Jev error
    instead of a platform timeout.
    """
    source_env = os.environ if env is None else env
    if not ignore_shadow_flag and not jev_shadow_enabled(source_env):
        return None

    # Validate before anything else, so a bad question set fails the same way with or without a key.
    validate_jev_questions(questions)

    key = api_key or source_env.get("OPENROUTER_API_KEY")
    if not key:
        raise JevError("not-configured", "OPENROUTER_API_KEY is not set.")

    clock = now or time.monotonic
    send = transport or _urllib_transport
    wait = sleep or time.sleep
    roll = rand or _random.random
    attempts = max(1, max_attempts)

    # The breaker is per credential, so one tenant's revoked key never gates another's call.
    scope_key = _circuit_key(key, circuit_scope)
    if _circuit_is_open(_circuits.get(scope_key), clock):
        raise JevError("circuit-open", "Jev circuit is open after repeated failures.")

    headers = {
        "authorization": "Bearer %s" % key,
        "content-type": "application/json",
    }
    # Attribution, so OpenRouter reports spend per app.
    referer = app_url or source_env.get("JEV_APP_URL")
    title = app_name or source_env.get("JEV_APP_NAME")
    if referer:
        headers["http-referer"] = referer
    if title:
        headers["x-title"] = title

    # Routing policy is per call and defaults to denying data collection.
    routing = JEV_DEFAULT_PROVIDER_ROUTING if provider is _PROVIDER_UNSET else provider
    request_body: Dict[str, Any] = {
        "model": model or JEV_DEFAULT_MODEL,
        "state": state,
        "questions": questions,
    }
    if routing:
        request_body["provider"] = routing
    payload = json.dumps(request_body).encode("utf-8")

    total_budget_s = timeout_s * attempts if budget_s is None else budget_s
    call_started_at = clock()

    last_error = JevError("network", "Jev was never called.", retryable=True)

    for attempt in range(1, attempts + 1):
        # The budget is wall clock for the WHOLE call, so an attempt gets whatever is left of it
        # and never the full timeout. Without this an 8 s timeout inside a 2 s budget overruns the
        # caller, and a late attempt starts with milliseconds left and no way to say so.
        remaining_before_attempt = total_budget_s - (clock() - call_started_at)
        if remaining_before_attempt <= 0:
            last_error = JevError(
                "timeout",
                "The %.3f s Jev call budget was spent before attempt %d could start, so the "
                "attempt was refused." % (total_budget_s, attempt),
                status=last_error.status,
                retryable=True,
            )
            break
        attempt_timeout_s = min(timeout_s, remaining_before_attempt)
        started_at = clock()
        retry_after: Optional[float] = None
        try:
            response = send(JEV_ENDPOINT, headers, payload, attempt_timeout_s)
            if 200 <= response.status < 300:
                decoded = json.loads(response.body.decode("utf-8"))
                result = parse_jev_response(decoded, questions, int((clock() - started_at) * 1000))
                _circuits.pop(scope_key, None)
                return result
            text = response.body.decode("utf-8", "replace")
            if routing and _rejects_provider_policy(response.status, text):
                # Named, never retried: retrying an unsatisfiable routing policy spends the budget.
                raise JevError(
                    "provider-policy-rejected",
                    "Jev refused the provider routing policy with HTTP %d: %s The caller decides "
                    "whether to proceed with a weaker policy." % (response.status, text[:400]),
                    status=response.status,
                    retryable=False,
                )
            retryable = response.status == 429 or response.status >= 500
            last_error = JevError(
                "http",
                "Jev returned HTTP %d: %s" % (response.status, text[:400]),
                status=response.status,
                retryable=retryable,
            )
            if retryable:
                retry_after = _retry_after_seconds(response.headers)
        except JevError as error:
            # A policy refusal is the caller's decision to make, so it leaves here unwrapped.
            if error.kind == "provider-policy-rejected":
                raise
            # A validation failure is deterministic. Retrying it buys nothing.
            last_error = error
        except TimeoutError as error:
            last_error = JevError(
                "timeout",
                "Jev did not answer within %s s: %s" % (attempt_timeout_s, error),
                retryable=True,
            )
        except (OSError, ValueError) as error:
            kind = "timeout" if "timed out" in str(error).lower() else "network"
            last_error = JevError(kind, "Jev call failed: %s" % error, retryable=True)

        if not last_error.retryable or attempt == attempts:
            break
        # Exponential backoff with FULL jitter. A fleet of crons retrying in lockstep is how a
        # 429 becomes an outage.
        ceiling = min(max_delay_s, base_delay_s * (2 ** (attempt - 1)))
        asked = retry_after if retry_after is not None else roll() * ceiling
        # Retry-After is a server's wish, not an instruction. A five-minute wait inside a
        # 90-second cron is a platform timeout, which records nothing; a refused wait records a
        # Jev error.
        delay = min(asked, max_delay_s)
        remaining_s = total_budget_s - (clock() - call_started_at)
        if delay >= remaining_s:
            last_error = JevError(
                last_error.kind,
                "%s The retry wait of %.3f s does not fit the remaining %.3f s of the %.3f s "
                "budget, so the retry was refused."
                % (last_error, delay, max(0.0, remaining_s), total_budget_s),
                status=last_error.status,
                retryable=last_error.retryable,
            )
            break
        wait(delay)

    # Only a shared failure counts. A 400 or 401 is this caller's own, and five of them across
    # five tenants must not open a breaker that gates a sixth.
    if _is_shared_circuit_failure(last_error):
        entry = _circuits.setdefault(scope_key, _Circuit())
        entry.failures += 1
        if entry.failures >= CIRCUIT_FAILURE_THRESHOLD:
            entry.opened_at = clock()
    raise last_error
