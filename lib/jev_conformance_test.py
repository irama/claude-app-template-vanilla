#!/usr/bin/env python3
"""Jev conformance suite — the GOLDEN Python copy.

Covers the seven API traps, the completeness check, the kill switch, retry with jitter and the
circuit breaker. Every case runs against a RECORDED response in ``lib/jev-fixtures.json``, the
same fixture file the TypeScript suite reads. No live call runs by default; set JEV_LIVE=1 and
OPENROUTER_API_KEY to opt in to the single test that talks to the endpoint.

Run it::

    python3 lib/jev_conformance_test.py

Standard library only, so it runs in any repo that vendors the client with no test framework
installed. This file is vendored alongside ``lib/jev.py``: a copy that has quietly drifted fails
here as well as in the checksum report from ``scripts/jev-sync.py``.
"""

import copy
import json
import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from jev import (  # noqa: E402
    JEV_DEFAULT_MODEL,
    JEV_DEFAULT_PROVIDER_ROUTING,
    JEV_ENDPOINT,
    JevError,
    _Response,
    ask_jev,
    jev_circuit_state,
    jev_confidence,
    jev_shadow_enabled,
    noul_verdict,
    parse_jev_response,
    reset_jev_circuit,
    validate_jev_questions,
)

FIXTURES = json.loads((HERE / "jev-fixtures.json").read_text())
QUESTIONS = FIXTURES["questions"]
STATE = FIXTURES["state"]
ON = {"OPENROUTER_API_KEY": "test-key", "JEV_SHADOW_ENABLED": "1"}


def replay(*recorded):
    """A transport stand-in that replays recorded responses in order and records its calls."""
    calls = []

    def transport(url, headers, body, timeout):
        calls.append({"url": url, "headers": headers, "body": body, "timeout": timeout})
        nxt = recorded[min(len(calls) - 1, len(recorded) - 1)]
        if isinstance(nxt, Exception):
            raise nxt
        status = nxt.get("status", 200)
        return _Response(
            status=status,
            headers=nxt.get("headers", {}),
            body=json.dumps(nxt.get("body", {})).encode("utf-8"),
        )

    return transport, calls


def no_wait():
    """Deterministic timing knobs, so the suite never actually waits."""
    return {"sleep": lambda _s: None, "rand": lambda: 0.5}


class JevConformance(unittest.TestCase):
    def setUp(self):
        reset_jev_circuit()

    # --- trap 1 -----------------------------------------------------------
    def test_trap1_question_field_is_refused_locally(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        bad = {"is_spam": {"type": "noul", "question": "Is it spam?"}}
        with self.assertRaises(JevError) as caught:
            ask_jev(STATE, bad, env=ON, transport=transport, **no_wait())
        self.assertEqual(caught.exception.kind, "request-invalid")
        self.assertIn("instructions", str(caught.exception))
        self.assertEqual(calls, [])

    # --- trap 2 -----------------------------------------------------------
    def test_trap2_choice_needs_object_criteria(self):
        with self.assertRaises(JevError):
            validate_jev_questions({"kind": {"type": "choice", "instructions": "Classify it."}})
        with self.assertRaises(JevError):
            validate_jev_questions(
                {"kind": {"type": "choice", "instructions": "Classify it.", "criteria": ["a", "b"]}}
            )

    # --- trap 3 -----------------------------------------------------------
    def test_trap3_score_needs_array_criteria(self):
        with self.assertRaises(JevError):
            validate_jev_questions({"urgency": {"type": "score", "instructions": "How urgent."}})
        with self.assertRaises(JevError):
            validate_jev_questions(
                {
                    "urgency": {
                        "type": "score",
                        "instructions": "How urgent.",
                        "criteria": {"low": "a", "high": "b"},
                    }
                }
            )

    # --- trap 4 -----------------------------------------------------------
    def test_trap4_noul_takes_no_criteria(self):
        with self.assertRaises(JevError):
            validate_jev_questions(
                {"is_spam": {"type": "noul", "instructions": "It is spam.", "criteria": ["n", "y"]}}
            )

    def test_trap4_noul_answer_has_no_confidence(self):
        only = {"is_spam": QUESTIONS["is_spam"]}
        result = parse_jev_response(FIXTURES["responses"]["noulOnly"], only, 1)
        self.assertIsNone(jev_confidence(result.answers["is_spam"]))
        self.assertEqual(noul_verdict(0.52), "uncertain")
        self.assertEqual(noul_verdict(0.97), "true")
        self.assertEqual(noul_verdict(0.03), "false")

    # --- trap 5 -----------------------------------------------------------
    def test_trap5_each_key_is_refused(self):
        with self.assertRaises(JevError) as caught:
            validate_jev_questions(
                {
                    "each": {"type": "noul", "instructions": "For every row."},
                    "is_spam": QUESTIONS["is_spam"],
                }
            )
        self.assertIn("per-row iteration", str(caught.exception))

    def test_trap5_missing_named_answer_raises(self):
        transport, _calls = replay({"body": FIXTURES["responses"]["eachIgnored"]})
        with self.assertRaises(JevError) as caught:
            ask_jev(STATE, QUESTIONS, env=ON, transport=transport, **no_wait())
        self.assertEqual(caught.exception.kind, "incomplete")
        self.assertIn("kind", str(caught.exception))
        self.assertIn("urgency", str(caught.exception))

    # --- trap 6 -----------------------------------------------------------
    def test_trap6_never_probes_the_public_model_list(self):
        source = (HERE / "jev.py").read_text().splitlines()
        probes = [line for line in source if "/api/v1/models" in line]
        # The only mention allowed is the docstring saying not to probe there.
        self.assertTrue(all(line.strip().startswith(("#", "1.", "6.")) for line in probes), probes)
        self.assertEqual(JEV_ENDPOINT, "https://openrouter.ai/api/alpha/decisions")

    # --- trap 7 -----------------------------------------------------------
    def test_trap7_records_the_resolved_dated_model(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        result = ask_jev(
            STATE,
            QUESTIONS,
            env=ON,
            transport=transport,
            app_url="https://example.tld",
            app_name="Example",
            **no_wait(),
        )
        self.assertEqual(json.loads(calls[0]["body"])["model"], JEV_DEFAULT_MODEL)
        self.assertEqual(result.model, FIXTURES["resolvedModel"])
        self.assertNotEqual(result.model, FIXTURES["aliasModel"])

    # --- the kill switch --------------------------------------------------
    def test_shadow_flag_is_independent_of_the_api_key(self):
        self.assertTrue(jev_shadow_enabled({"JEV_SHADOW_ENABLED": "1"}))
        self.assertTrue(jev_shadow_enabled({"JEV_SHADOW_ENABLED": "true"}))
        self.assertFalse(jev_shadow_enabled({"JEV_SHADOW_ENABLED": "0", "OPENROUTER_API_KEY": "k"}))
        self.assertFalse(jev_shadow_enabled({"OPENROUTER_API_KEY": "k"}))

    def test_disabled_shadow_short_circuits_without_the_network(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        result = ask_jev(
            STATE,
            QUESTIONS,
            env={"OPENROUTER_API_KEY": "test-key", "JEV_SHADOW_ENABLED": "0"},
            transport=transport,
            **no_wait(),
        )
        self.assertIsNone(result)
        self.assertEqual(calls, [])

    # --- transport --------------------------------------------------------
    def test_sends_the_attribution_headers(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        ask_jev(
            STATE,
            QUESTIONS,
            env=ON,
            transport=transport,
            app_url="https://example.tld",
            app_name="Example",
            **no_wait(),
        )
        headers = calls[0]["headers"]
        self.assertEqual(headers["http-referer"], "https://example.tld")
        self.assertEqual(headers["x-title"], "Example")
        self.assertEqual(headers["authorization"], "Bearer test-key")

    def test_retries_a_429_and_honours_retry_after(self):
        waits = []
        transport, calls = replay(
            {"status": 429, "headers": {"retry-after": "2"}, "body": {"error": "slow down"}},
            {"body": FIXTURES["responses"]["complete"]},
        )
        result = ask_jev(
            STATE,
            QUESTIONS,
            env=ON,
            transport=transport,
            sleep=waits.append,
            rand=lambda: 0.5,
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(waits, [2.0])
        self.assertEqual(result.model, FIXTURES["resolvedModel"])

    def test_backs_off_with_jitter_when_there_is_no_retry_after(self):
        waits = []
        transport, _calls = replay({"status": 503, "body": {"error": "unavailable"}})
        with self.assertRaises(JevError) as caught:
            ask_jev(
                STATE,
                QUESTIONS,
                env=ON,
                transport=transport,
                max_attempts=3,
                base_delay_s=0.1,
                sleep=waits.append,
                rand=lambda: 0.5,
            )
        self.assertEqual(caught.exception.kind, "http")
        # Full jitter: half of the 0.1 s and 0.2 s ceilings.
        self.assertEqual([round(w, 4) for w in waits], [0.05, 0.1])

    def test_does_not_retry_a_400(self):
        transport, calls = replay({"status": 400, "body": {"error": "bad request"}})
        with self.assertRaises(JevError):
            ask_jev(STATE, QUESTIONS, env=ON, transport=transport, **no_wait())
        self.assertEqual(len(calls), 1)

    def test_caps_a_generous_retry_after_at_max_delay(self):
        waits = []
        transport, _calls = replay(
            {"status": 429, "headers": {"retry-after": "300"}, "body": {"error": "slow down"}},
            {"body": FIXTURES["responses"]["complete"]},
        )
        ask_jev(
            STATE,
            QUESTIONS,
            env=ON,
            transport=transport,
            max_attempts=2,
            max_delay_s=5.0,
            budget_s=60.0,
            sleep=waits.append,
            rand=lambda: 0.5,
        )
        self.assertEqual(waits, [5.0])

    def test_refuses_a_wait_that_does_not_fit_the_budget(self):
        waits = []
        transport, calls = replay(
            {"status": 429, "headers": {"retry-after": "300"}, "body": {"error": "slow down"}}
        )
        with self.assertRaises(JevError) as caught:
            ask_jev(
                STATE,
                QUESTIONS,
                env=ON,
                transport=transport,
                max_attempts=3,
                max_delay_s=300.0,
                # A 90-second cron cannot afford the five-minute wait the header asks for.
                budget_s=90.0,
                sleep=waits.append,
                rand=lambda: 0.5,
            )
        self.assertEqual(caught.exception.kind, "http")
        self.assertIn("retry was refused", str(caught.exception))
        self.assertEqual(waits, [])
        self.assertEqual(len(calls), 1)

    def test_clamps_an_attempt_timeout_to_the_remaining_budget(self):
        # A 2 s budget must not hand an 8 s timeout to the attempt inside it.
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        ask_jev(
            STATE,
            QUESTIONS,
            env=ON,
            transport=transport,
            timeout_s=8.0,
            budget_s=2.0,
            **no_wait(),
        )
        self.assertLessEqual(calls[0]["timeout"], 2.0)
        self.assertGreater(calls[0]["timeout"], 0.0)

    def test_refuses_an_attempt_that_does_not_fit_the_budget(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        with self.assertRaises(JevError) as caught:
            ask_jev(STATE, QUESTIONS, env=ON, transport=transport, budget_s=0.0, **no_wait())
        self.assertEqual(caught.exception.kind, "timeout")
        self.assertIn("attempt was refused", str(caught.exception))
        self.assertEqual(calls, [])

    # --- provider routing -------------------------------------------------
    def test_sends_the_deny_retention_policy_by_default(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        ask_jev(STATE, QUESTIONS, env=ON, transport=transport, **no_wait())
        sent = json.loads(calls[0]["body"].decode("utf-8"))
        self.assertEqual(sent["provider"], JEV_DEFAULT_PROVIDER_ROUTING)
        self.assertEqual(sent["provider"]["data_collection"], "deny")
        self.assertEqual(FIXTURES["providerRouting"]["data_collection"], "deny")

    def test_carries_zdr_through_when_a_caller_opts_in(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        ask_jev(
            STATE,
            QUESTIONS,
            env=ON,
            transport=transport,
            provider={"data_collection": "deny", "allow_fallbacks": True, "zdr": True},
            **no_wait(),
        )
        sent = json.loads(calls[0]["body"].decode("utf-8"))
        self.assertIs(sent["provider"]["zdr"], True)

    def test_sends_no_provider_block_when_the_caller_passes_none(self):
        transport, calls = replay({"body": FIXTURES["responses"]["complete"]})
        ask_jev(STATE, QUESTIONS, env=ON, transport=transport, provider=None, **no_wait())
        self.assertNotIn("provider", json.loads(calls[0]["body"].decode("utf-8")))

    def test_names_a_refused_policy_and_does_not_retry_it(self):
        transport, calls = replay(
            {"status": 404, "body": FIXTURES["responses"]["providerRejected"]}
        )
        with self.assertRaises(JevError) as caught:
            ask_jev(
                STATE,
                QUESTIONS,
                env=ON,
                transport=transport,
                provider={"only": ["no-such-provider-xyz"]},
                max_attempts=3,
                **no_wait(),
            )
        self.assertEqual(caught.exception.kind, "provider-policy-rejected")
        self.assertEqual(caught.exception.status, 404)
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(len(calls), 1)

    def test_an_ordinary_404_is_still_an_http_error(self):
        transport, _calls = replay({"status": 404, "body": {"error": "no such route"}})
        with self.assertRaises(JevError) as caught:
            ask_jev(STATE, QUESTIONS, env=ON, transport=transport, provider=None, **no_wait())
        self.assertEqual(caught.exception.kind, "http")

    def test_opens_the_circuit_after_repeated_failure(self):
        transport, calls = replay(TimeoutError("timed out"))
        for _ in range(5):
            with self.assertRaises(JevError):
                ask_jev(STATE, QUESTIONS, env=ON, transport=transport, max_attempts=1, **no_wait())
        self.assertEqual(jev_circuit_state(), "open")
        before = len(calls)
        with self.assertRaises(JevError) as caught:
            ask_jev(STATE, QUESTIONS, env=ON, transport=transport, **no_wait())
        self.assertEqual(caught.exception.kind, "circuit-open")
        self.assertEqual(len(calls), before)

    def test_one_credential_failures_stay_off_another_credentials_breaker(self):
        transport, calls = replay(TimeoutError("timed out"))
        for _ in range(5):
            with self.assertRaises(JevError):
                ask_jev(
                    STATE,
                    QUESTIONS,
                    env=ON,
                    api_key="key-alice",
                    transport=transport,
                    max_attempts=1,
                    **no_wait(),
                )
        with self.assertRaises(JevError) as caught:
            ask_jev(STATE, QUESTIONS, env=ON, api_key="key-alice", transport=transport, **no_wait())
        self.assertEqual(caught.exception.kind, "circuit-open")
        # Alice is shut out, and Bob is not: the breaker is keyed by credential.
        before = len(calls)
        with self.assertRaises(JevError) as caught:
            ask_jev(
                STATE,
                QUESTIONS,
                env=ON,
                api_key="key-bob",
                transport=transport,
                max_attempts=1,
                **no_wait(),
            )
        self.assertEqual(caught.exception.kind, "timeout")
        self.assertEqual(len(calls), before + 1)

    def test_a_401_never_opens_the_circuit(self):
        transport, calls = replay({"status": 401, "body": {"error": "revoked key"}})
        for _ in range(6):
            with self.assertRaises(JevError) as caught:
                ask_jev(STATE, QUESTIONS, env=ON, transport=transport, max_attempts=1, **no_wait())
            self.assertEqual(caught.exception.kind, "http")
        self.assertEqual(jev_circuit_state(), "closed")
        # Every one of the six went out. A non-retryable status never becomes everyone's outage.
        self.assertEqual(len(calls), 6)

    def test_a_named_scope_isolates_two_callers_sharing_one_key(self):
        transport, _calls = replay(TimeoutError("timed out"))
        for _ in range(5):
            with self.assertRaises(JevError):
                ask_jev(
                    STATE,
                    QUESTIONS,
                    env=ON,
                    circuit_scope="tenant-a",
                    transport=transport,
                    max_attempts=1,
                    **no_wait(),
                )
        self.assertEqual(jev_circuit_state(scope="tenant-a"), "open")
        self.assertEqual(jev_circuit_state(scope="tenant-b"), "closed")

    # --- response validation ---------------------------------------------
    def test_rejects_a_response_with_no_resolved_model(self):
        with self.assertRaises(JevError) as caught:
            parse_jev_response({"answers": {}}, QUESTIONS, 1)
        self.assertIn("resolved model", str(caught.exception))

    def test_rejects_an_answer_of_the_wrong_type(self):
        body = {
            "model": FIXTURES["resolvedModel"],
            "answers": {
                "is_spam": {"type": "choice", "choice": "x", "probabilities": {}, "confidence": 1}
            },
        }
        with self.assertRaises(JevError):
            parse_jev_response(body, {"is_spam": QUESTIONS["is_spam"]}, 1)

    def test_rejects_a_non_finite_probability_like_the_typescript_client(self):
        """`Infinity` decodes to `float("inf")`, which equals itself. isfinite catches it."""
        body = json.loads(
            '{"model": "m", "answers": {"is_spam": {"type": "noul", "noul": Infinity}}}'
        )
        body["model"] = FIXTURES["resolvedModel"]
        with self.assertRaises(JevError):
            parse_jev_response(body, {"is_spam": QUESTIONS["is_spam"]}, 1)
        body["answers"]["is_spam"]["noul"] = float("-inf")
        with self.assertRaises(JevError):
            parse_jev_response(body, {"is_spam": QUESTIONS["is_spam"]}, 1)

    def test_rejects_a_choice_answer_with_no_confidence(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        del body["answers"]["kind"]["confidence"]
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("confidence", str(caught.exception))

    def test_rejects_a_probability_value_that_is_not_a_number(self):
        """A declared option name carrying a sentence of the caller's own input as its value.

        A filter that drops unknown KEYS keeps this, because the key is declared. The answer is
        refused here instead, so the value never reaches anything that records raw answers.
        """
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["kind"]["probabilities"]["work"] = "the manuscript excerpt"
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn('"probabilities" value for "work"', str(caught.exception))
        self.assertEqual(caught.exception.kind, "response-invalid")

    def test_rejects_a_non_finite_probability_value_inside_the_map(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["kind"]["probabilities"]["work"] = float("inf")
        with self.assertRaises(JevError):
            parse_jev_response(body, QUESTIONS, 1)

    def test_rejects_a_score_probability_value_that_is_not_a_number(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["urgency"]["probabilities"]["1"] = {"nested": "content"}
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("probabilities", str(caught.exception))

    def test_rejects_a_legend_value_that_is_not_a_non_empty_string(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["urgency"]["legend"]["0"] = 12
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("legend", str(caught.exception))

    # --- The declared taxonomy is enforced at the client (review finding C1) ---

    def test_rejects_an_answer_name_that_was_never_asked(self):
        """An undeclared answer NAME is content, and it used to be ignored rather than refused."""
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["PRIVATE INPUT ECHO"] = {"type": "noul", "noul": 0.5}
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertEqual(caught.exception.kind, "response-invalid")
        self.assertIn("PRIVATE INPUT ECHO", str(caught.exception))

    def test_rejects_a_choice_outside_the_declared_criteria(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["kind"]["choice"] = "PRIVATE INPUT ECHO"
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertEqual(caught.exception.kind, "response-invalid")
        self.assertIn("not a declared option", str(caught.exception))

    def test_rejects_a_probability_key_outside_the_declared_criteria(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["kind"]["probabilities"]["PRIVATE INPUT ECHO"] = 0.1
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("not a declared option", str(caught.exception))

    def test_rejects_a_probability_outside_zero_to_one(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["kind"]["probabilities"]["work"] = 2.5
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("0 to 1", str(caught.exception))

    def test_rejects_a_legend_key_that_is_not_a_declared_anchor(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["urgency"]["legend"]["9"] = "an anchor nobody declared"
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("not a declared anchor", str(caught.exception))

    def test_rejects_a_score_outside_zero_to_one(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["answers"]["urgency"]["score"] = 4.0
        with self.assertRaises(JevError) as caught:
            parse_jev_response(body, QUESTIONS, 1)
        self.assertIn("score in 0 to 1", str(caught.exception))

    def test_keeps_a_well_formed_answer_intact_values_and_all(self):
        result = parse_jev_response(FIXTURES["responses"]["complete"], QUESTIONS, 1)
        self.assertEqual(result.answers["kind"]["probabilities"]["work"], 0.95)
        self.assertEqual(result.usage["input_tokens"], 573)

    def test_reports_no_usage_rather_than_a_bad_shape(self):
        body = copy.deepcopy(FIXTURES["responses"]["complete"])
        body["usage"]["cost"] = "free"
        self.assertIsNone(parse_jev_response(body, QUESTIONS, 1).usage)


# Opt-in only. It costs money and needs the network, so it never runs in the default suite.
LIVE = os.environ.get("JEV_LIVE") == "1" and bool(os.environ.get("OPENROUTER_API_KEY"))


@unittest.skipUnless(LIVE, "set JEV_LIVE=1 and OPENROUTER_API_KEY to run the live call")
class JevLive(unittest.TestCase):
    def test_answers_a_real_batch(self):
        result = ask_jev(
            STATE,
            QUESTIONS,
            ignore_shadow_flag=True,
            app_url="https://example.tld",
            app_name="Jev conformance",
            timeout_s=30.0,
        )
        self.assertRegex(result.model, r"^typesafe/jev-.+-\d{8}$")
        self.assertEqual(len(result.answers), len(QUESTIONS))


if __name__ == "__main__":
    unittest.main(verbosity=2)
