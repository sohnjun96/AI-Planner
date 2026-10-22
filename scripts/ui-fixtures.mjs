// Existing feature tests start after the first-run guide; onboarding has its own suite.
export async function skipFirstRunGuide(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("planai_onboarding_v1", JSON.stringify({ step: "completed", paused: false }));
    } catch {
      // The extension tests also navigate opaque documents with no app storage.
    }
  });
}
