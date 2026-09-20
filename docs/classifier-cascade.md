# Classifier cascade — decide cheaply first, escalate only the doubt

**When this app makes a decision from text, ask first whether a System One model can make it,
and route only the low-confidence cases to an expensive model or to a person.**

A System One model returns a typed value the program branches on, rather than prose the program
has to parse. As of September 2026 the first one available is Jev (TypeSafe), served by
OpenRouter on a dedicated endpoint. It prices at **$0.042 per million input tokens with output
free** and answers in **70 to 500 ms**, against roughly $1.00 and $5.00 for a small chat model.
Measured in practice: about **$0.000004 a decision**.

    every item ──▶ cheap classifier ──┬── high confidence ──▶ act automatically
                                      ├── low confidence  ──▶ escalate to the big model
                                      └── high + risky    ──▶ ask a person

## The confidence is the point, not the price

The cheap tier returns a calibrated confidence with every answer. That is what makes the cascade
safe: it flags its own hard cases, so the expensive tier only sees the items worth paying for.
Without a trustworthy confidence a cheap tier is just a worse classifier.

## Three questions to ask of any decision in this codebase

- **Is it a judgement about text?** A date comparison, a schema check or an access rule stays
  deterministic. Determinism is cheaper and correct, and a model is the wrong tool for it.
- **Is it a hand-written rule that is quietly wrong?** A regex over known names, a fixed
  similarity threshold, a keyword list. These cost nothing and give bad answers, which is worse
  than costing money. They are the highest-value targets, ahead of the metered calls.
- **Is it a decision the app skips because it was too dear?** A monthly call cap, a
  cache-forever policy, a cron batching to save calls, a "new records only" rule. **A rationing
  mechanism is the tell.** At this price the ration has no reason to exist, and the thing being
  rationed can usually run over everything, retroactively, for cents.

## Rules

- **Shadow mode first.** The classifier runs on live traffic and logs its answer and confidence
  while the existing rule still drives behaviour. Promote when the log shows agreement on the
  easy cases and the classifier winning the disagreements. Never on the strength of a demo.
- **Keep what you replaced as the fallback.** The endpoint is young and the code being replaced
  already works, so the fallback costs nothing. Never a hard dependency.
- **A safety check still fails closed.** Where the decision guards something outward-facing,
  uncertain must block, exactly as the rule it replaced did.
- **Log the confidence, not just the answer.** The distribution sets the threshold and cannot be
  recovered later.
- **Batch by naming many questions over one shared state**, in a single request. There is no
  per-row iteration parameter.

## Request shape

    POST https://openrouter.ai/api/alpha/decisions
    { "model": "typesafe/jev-1.13",
      "state": { ...your data... },
      "questions": {
        "is_spam": { "type": "noul",   "instructions": "The message is unsolicited bulk mail." },
        "kind":    { "type": "choice", "instructions": "Classify the message.",
                     "criteria": { "spam": "Unsolicited.", "work": "Professional." } },
        "urgency": { "type": "score",  "instructions": "How urgent for the recipient.",
                     "criteria": ["Not urgent.", "Today."] } } }

`noul` answers a condition with a probability. `choice` picks one of up to 255 named options and
returns a probability per option plus a confidence. `score` returns a position along the anchors
supplied. The field is `instructions`, never `question`, and `choice` and `score` both require
`criteria`. Send `http-referer` and `x-title` so spend stays attributable.
