// Turns the options page's test call into a message. A wrong answer still
// proves the key works, so it is reported as working with a model warning.
export function describeTestResult({ answer, expected, error, }) {
  if (error) {
    return { ok: false, text: `Saved, but the test failed: ${error.message || error}` };
  }
  const got = String(answer ?? "").trim();
  if (got.toUpperCase().startsWith(String(expected).toUpperCase())) {
    return { ok: true, text: "Saved. Key works." };
  }
  return { ok: true, text: `Saved. Key works, but the model answered "${got}" to a test question (expected ${expected}).` };
}
