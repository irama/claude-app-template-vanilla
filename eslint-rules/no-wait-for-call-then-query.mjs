// GENERATED FILE — DO NOT EDIT.
// Source: status.peakstate.global/packages/eslint-rules/no-wait-for-call-then-query.mjs
// Update there, then run: node scripts/sync-eslint-rules.mjs
/**
 * Ban the barrier that produced two separate flaky tests in mindful-app, and
 * that a fleet-wide scan found ~100 more instances of (2026-08-13):
 *
 *     await waitFor(() => expect(someMock).toHaveBeenCalled());
 *     expect(screen.getByRole('alert')).toHaveTextContent(/…/);
 *
 * Waiting on a CALL and then reading the DOM asserts on the start of the work
 * and then immediately inspects the end of it. Whether that passes depends on
 * whether the state update landed in the same tick, so it fails a few runs in
 * a hundred — under parallel load, in CI, on the pre-push hook, never when you
 * re-run it alone.
 *
 * The fix is always the same: wait for the thing being asserted.
 *
 *     expect(await screen.findByRole('alert')).toHaveTextContent(/…/);
 *
 * `testing-library/prefer-find-by` does NOT cover this. That rule fires on
 * `waitFor(() => screen.getBy…)` — a waitFor that already queries the DOM. The
 * case here is the opposite: the waitFor never touches the DOM, so nothing in
 * the plugin can see that the next line does.
 *
 * ponytail: deliberately narrow. It looks at one waitFor and the statement
 * directly after it, and says nothing about anything else. Widening it to
 * "somewhere later in the test" would need flow analysis and would start
 * guessing; two real defects had this exact adjacent shape.
 *
 * The canonical copy lives in status.peakstate.global/packages/eslint-rules and
 * is vendored out by scripts/sync-eslint-rules.mjs — edit it there, then run
 * that script.
 */

/**
 * Testing Library's eight query suffixes, spelt out and anchored. A prefix test
 * alone (`/^getBy/`) also matches `repository.getById(…)` — "getBy" + "Id" — and
 * an error-level rule then blocks a build over a repository call, recommending
 * `findBy` at something that has no DOM (found by review, 2026-08-14, before this
 * rule reached a repo that had one).
 *
 * A repo with a CUSTOM query (`getByDataCy`) drops out of the rule's sight here.
 * That is the deliberate trade: a missed racy barrier is one flaky test, an error
 * on a non-DOM call is a blocked build in every repo that vendors this.
 */
const TL_SUFFIX = '(Role|Text|TestId|LabelText|PlaceholderText|AltText|Title|DisplayValue)';
const SYNC_QUERY = new RegExp(`^(get|query)(All)?By${TL_SUFFIX}$`);
/** Queries that THROW when absent. A `queryBy*` on the next line is normally a
 *  negative assertion ("nothing appeared"), which has no element to wait for —
 *  waiting on the call is then the only barrier available, so it is left alone. */
const THROWING_QUERY = new RegExp(`^get(All)?By${TL_SUFFIX}$`);
/**
 * Matchers that only make sense against a DOM node. If the waitFor uses one, it
 * IS waiting on the DOM — through an element handle (`expect(header).toHaveClass`)
 * or a one-line query helper (`const chord = () => screen.queryByText('Ctrl⏎')`)
 * that this rule cannot see through. Those barriers are correct; flagging them
 * would push people to rewrite working tests.
 */
/**
 * Properties that only exist on a DOM node. Reading one inside the barrier —
 * `expect(header.className).toContain('z-[70]')` — makes it a DOM wait just as
 * much as a matcher does, whatever assertion follows. Dropped once by accident
 * on 2026-08-14 while two threads edited this file; zero.peakstate.global's
 * header tests depend on it, which is why the suite now pins it.
 */
const DOM_PROPERTIES = new Set([
  'className',
  'textContent',
  'innerHTML',
  'checked',
  'selectionStart',
  'getAttribute',
]);
const DOM_MATCHERS = new Set([
  'toBeInTheDocument',
  'toBeVisible',
  'toHaveAttribute',
  'toHaveTextContent',
  'toHaveValue',
  'toHaveClass',
  'toHaveFocus',
  'toBeDisabled',
  'toBeEnabled',
  'toBeChecked',
  'toHaveStyle',
  'toContainElement',
]);

/** Does this subtree use a matcher that only applies to a DOM node? */
function assertsOnTheDom(node, sourceCode) {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (
      n.type === 'MemberExpression' &&
      n.property?.type === 'Identifier' &&
      (DOM_MATCHERS.has(n.property.name) || DOM_PROPERTIES.has(n.property.name))
    ) {
      found = true;
    }
    for (const key of sourceCode.visitorKeys[n.type] ?? []) {
      const child = n[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(node);
  return found;
}

/** Does this subtree contain a `screen.<query>()` / bare `getBy…()` call? */
function queriesTheDom(node, sourceCode, pattern = SYNC_QUERY) {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression') {
      const callee = n.callee;
      if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
        if (pattern.test(callee.property.name)) found = true;
      }
      if (callee?.type === 'Identifier' && pattern.test(callee.name)) found = true;
    }
    for (const key of sourceCode.visitorKeys[n.type] ?? []) {
      const child = n[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(node);
  return found;
}

/** The `waitFor(...)` call inside `await waitFor(...)`, or null. */
function waitForCall(statement) {
  if (statement?.type !== 'ExpressionStatement') return null;
  const expr = statement.expression;
  const call = expr?.type === 'AwaitExpression' ? expr.argument : expr;
  if (call?.type !== 'CallExpression') return null;
  const name = call.callee?.type === 'Identifier' ? call.callee.name : null;
  return name === 'waitFor' ? call : null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not wait on a mock call and then synchronously query the DOM — wait for the element instead (findBy*).',
    },
    schema: [],
    messages: {
      raceyBarrier:
        'This waits for a call, then reads the DOM on the next line — a race that flakes under load. Await the element itself instead: `await screen.findBy…`.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function checkBody(statements) {
      statements.forEach((statement, i) => {
        const call = waitForCall(statement);
        if (!call) return;
        // A waitFor that already queries the DOM is the correct shape (and
        // prefer-find-by will nudge it further). Only the non-DOM barrier races.
        if (queriesTheDom(call, sourceCode)) return;
        // …and neither is a wait on an element handle or a query helper, both of
        // which show up as a DOM matcher inside the callback.
        if (assertsOnTheDom(call, sourceCode)) return;

        const next = statements[i + 1];
        // Only a THROWING query races. A queryBy* is a negative assertion with
        // nothing to await.
        if (!next || !queriesTheDom(next, sourceCode, THROWING_QUERY)) return;
        // If the next statement is ITSELF an awaited waitFor, the real barrier is
        // right there and the query inside it retries — this waitFor is merely
        // redundant, not racy. (Common shape: wait for the call, then wait for
        // what it rendered.)
        if (waitForCall(next)) return;

        context.report({ node: statement, messageId: 'raceyBarrier' });
      });
    }

    return {
      BlockStatement: (node) => checkBody(node.body),
      Program: (node) => checkBody(node.body),
    };
  },
};

// Named, not an anonymous default: `import/no-anonymous-default-export` warns
// on the latter, and this file is vendored into repos that treat lint as a gate.
export default rule;
