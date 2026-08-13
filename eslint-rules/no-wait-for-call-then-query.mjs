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

const SYNC_QUERY = /^(getBy|getAllBy|queryBy|queryAllBy)/;

/** Does this subtree contain a `screen.<query>()` / bare `getBy…()` call? */
function queriesTheDom(node, sourceCode) {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression') {
      const callee = n.callee;
      if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
        if (SYNC_QUERY.test(callee.property.name)) found = true;
      }
      if (callee?.type === 'Identifier' && SYNC_QUERY.test(callee.name)) found = true;
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

export default {
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

        const next = statements[i + 1];
        if (!next || !queriesTheDom(next, sourceCode)) return;

        context.report({ node: statement, messageId: 'raceyBarrier' });
      });
    }

    return {
      BlockStatement: (node) => checkBody(node.body),
      Program: (node) => checkBody(node.body),
    };
  },
};
